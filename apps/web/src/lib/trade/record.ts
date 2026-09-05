import "server-only";

/**
 * Recording a fill.
 *
 * NOTHING financial in the stored row comes from the browser. The economics are
 * re-derived from the mined transaction itself:
 *
 *  1. `OrderFilled` from the OptionBook, with this wallet as buyer (taker BUY)
 *     or seller (taker SELL) — that log is the on-chain proof that this wallet
 *     was the taker, and it carries the premium, the fee and the option address;
 *  2. the collateral token's own `Transfer` logs out of this wallet, summed —
 *     the taker's real debit, not a formula;
 *  3. the transaction's own `fillOrder` calldata, decoded, for the contract
 *     count and to prove the filled order is the one that was prepared.
 *
 * The signed ticket only says which post and which side the fill belongs to and
 * supplies cross-check values; every one of them is checked against the chain,
 * and a mismatch refuses to confirm rather than storing a number nobody can
 * reproduce.
 *
 * `positions.tx_hash` is NOT NULL, so no row can exist before the wallet returns
 * a hash. The row is therefore inserted `pending` the moment a hash arrives and
 * only then does this wait for the receipt: a crash while waiting leaves a
 * durable, re-runnable record instead of a lost fill.
 */
import { decodeFunctionData, type Log } from "viem";
import { OPTION_BOOK_ABI, getOptionImplementationInfo, type OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import {
	breakEven as breakEvenOf,
	expectOrderFilled,
	maxPayout as maxPayoutOf,
	premiumUsd8From,
	type ParsedOrderFilled,
} from "@nuts/thetanuts";
import { and, eq } from "drizzle-orm";
import { db } from "@nuts/db";
import { positions, users, type Position } from "@nuts/db/schema/index";
import { encodeFillEventSnapshot } from "@nuts/db/fill-event-snapshot";
import { decodeOrderSnapshot } from "@nuts/db/order-snapshot";
import { getSession } from "@/lib/auth/session";
import { ascendingStrikes, riskKindFor } from "@/lib/market/structures";
import { formatBaseUnits, formatUsd8 } from "@/lib/market/units";
import { pnlCard } from "@/lib/display";
import { mapCreator } from "@/lib/data/map";
import { creatorHandle, creatorInitials } from "@/lib/data/identity";
import type * as Domain from "@/types";
import { collateralUsdPrice } from "@/lib/thetanuts/orders";
import { ACTIVITY_EVENTS, recordActivity } from "./store";
import { measureDebit, publicClient } from "./chain";
import { decodeTradeTicket, type TradeTicketPayload } from "./ticket";
import { truncateAddress } from "@/lib/auth/address";
import type { FillCard, RecordResult } from "./types";

/**
 * The two chain reads this module makes. Structural, so viem's public client
 * satisfies it and a test can supply a receipt this process could not otherwise
 * produce (a revert, a fill with no OptionBook log).
 */
export interface ChainReader {
	waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
		status: string;
		logs: readonly Log<bigint, number, false>[];
	}>;
	getTransaction(args: { hash: `0x${string}` }): Promise<{ to: string | null; input: `0x${string}` }>;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function fail(code: string, reason: string): RecordResult {
	return { ok: false, code, reason };
}

/** USD 8-decimal value of a collateral-token amount, or null when unpriceable. */
function usd8Of(amount: bigint, symbol: string, decimals: number): bigint | null {
	const price = collateralUsdPrice(symbol);
	if (price === null) return null;
	return premiumUsd8From({
		premiumBaseUnits: amount,
		collateralDecimals: decimals,
		collateralUsdPrice8: BigInt(price) * 100_000_000n,
	});
}

/** Collateral base units for an 8-decimal USD value. Only valid at a 1 USD peg. */
function collateralOfUsd8(usd8: bigint, symbol: string, decimals: number): bigint | null {
	if (collateralUsdPrice(symbol) !== 1) return null;
	return (usd8 * 10n ** BigInt(decimals)) / 100_000_000n;
}

export interface RecordTradeInput {
	/** The opaque token `prepareTrade` returned. */
	readonly token: string;
	readonly txHash: string;
}

/**
 * Server-side seam, as in `prepare.ts`: the session and the chain reader are
 * supplied by the caller so a test can replay a real mainnet transaction, or a
 * reverted one, without a request context. The exported action always passes the
 * real cookie session and the real Base client.
 */
export async function recordTradeFor(
	session: { userId: string; walletAddress: string } | null,
	input: RecordTradeInput,
	reader: ChainReader = publicClient(),
): Promise<RecordResult> {
	if (session === null) return fail("NO_SESSION", "Sign in with your wallet first.");
	const ticket = decodeTradeTicket(input.token);
	if (ticket === null) return fail("BAD_TICKET", "This trade could not be verified. Prepare it again.");
	if (ticket.userId !== session.userId || ticket.wallet !== session.walletAddress) {
		return fail("WALLET_MISMATCH", "This trade was prepared for a different wallet.");
	}
	const txHash = input.txHash.trim().toLowerCase();
	if (!TX_HASH.test(txHash)) return fail("BAD_TX_HASH", "That is not a Base transaction hash.");

	const pending = await insertPending(ticket, txHash);
	if (pending.status === "confirmed" || pending.status === "failed") {
		// Already recorded: `positions_chain_id_tx_hash_unique` makes this
		// idempotent, so a retry returns the stored row rather than a second one.
		return await result(ticket, pending, txHash);
	}

	const client = reader;
	const receipt = await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
	if (receipt.status !== "success") {
		// A reverted fill is not a position anyone holds (PRD 13, "Failed
		// transaction: do not publish or count the position"), so the row is
		// marked failed and the draft post stays a draft.
		const [row] = await db
			.update(positions)
			.set({ status: "failed" })
			.where(and(eq(positions.id, pending.id), eq(positions.walletAddress, ticket.wallet)))
			.returning();
		if (!row) throw new Error(`Position ${pending.id} vanished while marking it failed`);
		return await result(ticket, row, txHash);
	}

	const snapshot = decodeOrderSnapshot(ticket.orderSnapshot);
	const raw = snapshot.rawApiData;
	if (!raw) return fail("SNAPSHOT_INCOMPLETE", "The prepared order snapshot is missing its book fields.");

	let event: ParsedOrderFilled;
	try {
		event = expectOrderFilled(receipt.logs, {
			optionBook: ticket.optionBook as `0x${string}`,
			...(ticket.taker === "buy"
				? { buyer: ticket.wallet as `0x${string}` }
				: { seller: ticket.wallet as `0x${string}` }),
		});
	} catch {
		return fail(
			"FILL_NOT_FOUND",
			"That transaction carries no OptionBook fill for this wallet, so nothing was recorded.",
		);
	}

	const price = snapshot.order.price;
	const contracts = await contractsFrom({ client, txHash, ticket, event, price, expected: expectedOnChainOrder(snapshot) });
	if (contracts === null) {
		return fail(
			"FILL_DOES_NOT_MATCH",
			`This fill does not match the trade that was prepared, so its economics cannot be reproduced. Nothing was recorded. Transaction ${txHash}.`,
		);
	}

	const debit = measureDebit({ logs: receipt.logs, token: ticket.collateralAddress, wallet: ticket.wallet });
	const premium = event.premiumAmount;
	const fees = event.feeCollected;
	const collateral = ticket.taker === "buy" ? 0n : debit;
	const expectedDebit = ticket.taker === "buy" ? premium : BigInt(ticket.expectedCollateral);
	if (debit !== expectedDebit) {
		return fail(
			"DEBIT_MISMATCH",
			`The wallet paid ${debit} ${ticket.collateralSymbol} base units and this trade expected ${expectedDebit}. Nothing was recorded. Transaction ${txHash}.`,
		);
	}

	const economics = deriveEconomics({
		ticket,
		strikes: raw.strikes.map((strike) => BigInt(strike)),
		implementation: raw.implementation,
		contracts,
		premium,
		fees,
		collateral,
	});

	const updated = await db.transaction(async (tx) => {
		const [row] = await tx
			.update(positions)
			.set({
				status: "confirmed",
				confirmedAt: new Date(),
				fillEvent: encodeFillEventSnapshot(event),
				optionAddress: event.optionAddress,
				referrer: event.referrer,
				contracts: contracts.toString(),
				contractDecimals: ticket.contractSizeDecimals,
				premium: premium.toString(),
				fees: fees.toString(),
				collateral: collateral.toString(),
				...economics.columns,
			})
			.where(and(eq(positions.id, pending.id), eq(positions.walletAddress, ticket.wallet)))
			.returning();
		if (!row) throw new Error(`Position ${pending.id} vanished while confirming`);
		await recordActivity(tx, {
			userId: ticket.userId,
			eventType: ACTIVITY_EVENTS.positionConfirmed,
			thesisId: ticket.thesisId,
			positionId: row.id,
		});
		return row;
	});

	// FOLLOW-UP: `api.triggerIndexerUpdate()` then polling `getIndexedPositions`
	// is what moves a row from `confirmed` to `indexed` (teammate-measured, not
	// re-verified here). It is deliberately not on this path: confirmation must
	// not wait on an indexer. See `markIndexed` below.
	return await result(ticket, updated, txHash);
}

/**
 * The post-fill share card — the SAME `View.PnlCard` every other surface draws
 * (round-1 fold item 16), built by the one builder in `lib/position/view.ts`.
 *
 * The big number is an em dash on purpose, and the builder says so in its own
 * sentence: a live P&L needs a mark for the option, and this app has none at the
 * moment a fill confirms (`positions.status` only reaches `indexed` later, and
 * the SDK publishes no option price here). A freshly confirmed row is
 * `confirmed`, whose resolution is exactly "no recorded estimate yet", so the
 * card states that rather than asserting "+$0.00".
 *
 * The USD figures are the ones the fill itself recorded, converted from raw
 * collateral base units by the same peg `usd8Of` uses above; a token this code
 * cannot price yields null, which the card renders as "\u2014".
 */
async function fillCard(ticket: TradeTicketPayload, row: Position): Promise<FillCard> {
	const [user] = await db
		.select()
		.from(users)
		.where(eq(users.id, ticket.userId))
		.limit(1);
	const owner: Domain.Creator = user
		? mapCreator(user)
		: {
				// The session proved this wallet; the row it belongs to is only used
				// for the name and monogram, so a missing row degrades to the address
				// rather than failing the fill that already happened onchain.
				id: ticket.userId,
				walletAddress: row.walletAddress,
				displayName: null,
				handle: creatorHandle(row.walletAddress),
				initials: creatorInitials(null, row.walletAddress),
				mockWalletFragment: null,
				sinceLabel: null,
				winRatePct: null,
				thesesCount: null,
				followers: null,
				netPnlUsd: null,
				verifiedPnl30dUsd: null,
				biggestLossUsd: null,
			};
	const decimals = ticket.collateralDecimals;
	const symbol = ticket.collateralSymbol;
	const debit = ticket.taker === "buy" ? row.premium : row.collateral;
	const usdOrNull = (base: string | null): string | null => {
		if (base === null) return null;
		const usd8 = usd8Of(BigInt(base), symbol, decimals);
		return usd8 === null ? null : formatUsd8(usd8);
	};
	const card = pnlCard({
		id: row.id,
		owner,
		status: row.status === "failed" ? "failed" : "confirmed",
		createdAt: (row.confirmedAt ?? row.createdAt).toISOString(),
		instrumentLabel: ticket.instrumentLabel,
		// The order snapshot's own strings are already in the ticket's label; the
		// split fields stay null rather than re-parsing that label back apart.
		asset: null,
		strikesLabel: null,
		expiryLabel: null,
		expiryFullLabel: null,
		side: ticket.positionSide,
		pnl: {
			usd: null,
			basis: "unavailable",
			detail:
				"No P&L yet: a live figure needs a mark for this option and nothing published one at the moment this fill confirmed. TODO-OWNER: the mark source.",
		},
		// TODO-OWNER: tile labels. The mockup names "Max loss" and "Max payout"; it
		// has no label for what a fill cost.
		entryLabel: ticket.taker === "buy" ? "Premium paid" : "Collateral locked",
		entryUsd: usdOrNull(debit),
		maxLossUsd: usdOrNull(row.maximumLoss),
		maxPayoutUsd: usdOrNull(row.maximumPayout),
		tx: row.txHash === null ? undefined : { label: `${truncateAddress(row.txHash)} \u2197`, href: `https://basescan.org/tx/${row.txHash}` },
		// PRD 7.3: the badge is shown only after a verified Base mainnet receipt,
		// which is exactly the state this function is called in.
		verified: row.status !== "failed",
	});
	return { ...card, positionPath: `/p/${row.id}`, composePath: `/new?link=/p/${row.id}` };
}

async function result(ticket: TradeTicketPayload, row: Position, txHash: string): Promise<RecordResult> {
	return {
		ok: true,
		status: row.status === "failed" ? "failed" : "confirmed",
		positionId: row.id,
		thesisId: ticket.thesisId,
		txHash,
		card: row.status === "failed" ? null : await fillCard(ticket, row),
		settled:
			row.status === "failed"
				? null
				: {
						numContracts: row.contracts,
						premium: row.premium,
						fees: row.fees,
						collateral: row.collateral,
						collateralDecimals: ticket.collateralDecimals,
						collateralSymbol: ticket.collateralSymbol,
						optionAddress: row.optionAddress ?? "",
					},
	};
}

/** Inserts the `pending` row, or returns the existing one for this hash. */
async function insertPending(ticket: TradeTicketPayload, txHash: string): Promise<Position> {
	const inserted = await db
		.insert(positions)
		.values({
			thesisId: ticket.thesisId,
			userId: ticket.userId,
			role: ticket.role,
			side: ticket.positionSide,
			status: "pending",
			chainId: 8453,
			walletAddress: ticket.wallet,
			orderId: ticket.structureId,
			orderSnapshot: ticket.orderSnapshot,
			txHash,
			referrer: null,
			budget: ticket.budget,
			budgetDecimals: ticket.collateralDecimals,
			contracts: ticket.expectedContracts,
			contractDecimals: ticket.contractSizeDecimals,
			premium: ticket.expectedPremium,
			premiumDecimals: ticket.collateralDecimals,
			fees: ticket.expectedFee,
			feeDecimals: ticket.collateralDecimals,
			collateral: ticket.expectedCollateral,
			collateralDecimals: ticket.collateralDecimals,
			breakEvenPrices: [],
			breakEvenPriceDecimals: 8,
			breakEvenPricesUsd: [],
		})
		.onConflictDoNothing({ target: [positions.chainId, positions.txHash] })
		.returning();
	if (inserted[0]) return inserted[0];
	const existing = await db
		.select()
		.from(positions)
		.where(and(eq(positions.chainId, 8453), eq(positions.txHash, txHash)))
		.limit(1);
	const row = existing[0];
	if (!row) throw new Error(`Could not insert or read the position for ${txHash}`);
	if (row.walletAddress !== ticket.wallet) {
		throw new Error(`Transaction ${txHash} already belongs to another wallet`);
	}
	return row;
}

/**
 * The contract count actually filled.
 *
 * Preferred source is the transaction's own `fillOrder` calldata, which is
 * unambiguous. A smart-contract wallet can route the same fill through a batch
 * or a UserOperation, and then the top-level calldata is not `fillOrder`; in
 * that case the prepared count is accepted only if it reproduces the premium the
 * OptionBook actually emitted. Anything else returns null and nothing is stored.
 */
async function contractsFrom(context: {
	client: ChainReader;
	txHash: string;
	ticket: TradeTicketPayload;
	event: ParsedOrderFilled;
	price: bigint;
	expected: OnChainOrder;
}): Promise<bigint | null> {
	const { client, txHash, ticket, event, price, expected: expectedOrder } = context;
	try {
		const transaction = await client.getTransaction({ hash: txHash as `0x${string}` });
		if (transaction.to?.toLowerCase() === ticket.optionBook.toLowerCase()) {
			const decoded = decodeFunctionData({ abi: OPTION_BOOK_ABI, data: transaction.input });
			const order = decoded.args?.[0];
			if (
				decoded.functionName === "fillOrder" &&
				typeof order === "object" &&
				order !== null &&
				"numContracts" in order &&
				typeof order.numContracts === "bigint" &&
				sameOrder(order as Record<string, unknown>, expectedOrder)
			) {
				const filled = order.numContracts;
				if ((filled * price) / 100_000_000n === event.premiumAmount) return filled;
				return null;
			}
		}
	} catch {
		// Fall through to the reconciliation path below.
	}
	const expected = BigInt(ticket.expectedContracts);
	return (expected * price) / 100_000_000n === event.premiumAmount ? expected : null;
}

/**
 * The on-chain `fillOrder` struct the prepared order maps to.
 *
 * The mapping is the SDK's own (`buildContractOrder`, dist/index.js:1590): three
 * fields come from the signed order and the rest from the API row, so both
 * sources are read here rather than assumed to live in one of them.
 */
interface OnChainOrder {
	readonly maker: string;
	readonly orderExpiryTimestamp: bigint;
	readonly collateral: string;
	readonly isCall: boolean;
	readonly priceFeed: string;
	readonly implementation: string;
	readonly isLong: boolean;
	readonly maxCollateralUsable: bigint;
	readonly strikes: bigint[];
	readonly expiry: bigint;
	readonly price: bigint;
}

function expectedOnChainOrder(snapshot: OrderWithSignature): OnChainOrder {
	const raw = snapshot.rawApiData;
	if (!raw) throw new Error("Order snapshot has no book fields");
	return {
		maker: snapshot.order.maker,
		orderExpiryTimestamp: BigInt(raw.orderExpiryTimestamp),
		collateral: raw.collateral,
		isCall: raw.isCall,
		priceFeed: raw.priceFeed,
		implementation: raw.implementation,
		isLong: raw.isLong,
		maxCollateralUsable: BigInt(raw.maxCollateralUsable),
		strikes: raw.strikes.map((strike) => BigInt(strike)),
		expiry: snapshot.order.expiry,
		price: snapshot.order.price,
	};
}

/** Every signed field of the filled order must equal the prepared order's. */
function sameOrder(order: Record<string, unknown>, expected: OnChainOrder): boolean {
	const address = (value: unknown): string => String(value).toLowerCase();
	const number = (value: unknown): bigint => BigInt(String(value));
	const strikes = order.strikes;
	if (!Array.isArray(strikes) || strikes.length !== expected.strikes.length) return false;
	for (let index = 0; index < strikes.length; index++) {
		if (number(strikes[index]) !== expected.strikes[index]) return false;
	}
	return (
		address(order.maker) === address(expected.maker) &&
		address(order.collateral) === address(expected.collateral) &&
		address(order.implementation) === address(expected.implementation) &&
		address(order.priceFeed) === address(expected.priceFeed) &&
		order.isCall === expected.isCall &&
		order.isLong === expected.isLong &&
		number(order.expiry) === expected.expiry &&
		number(order.price) === expected.price &&
		number(order.orderExpiryTimestamp) === expected.orderExpiryTimestamp &&
		number(order.maxCollateralUsable) === expected.maxCollateralUsable
	);
}

interface EconomicsColumns {
	readonly columns: Record<string, string | number | string[] | null>;
}

/**
 * Max loss, max payout and break-even, recomputed from the mined fill.
 *
 *   taker BUY   maxLoss     = premium                       (bounded by the premium)
 *               maxPayout   = risk helper, USD 8dp, or null
 *   taker SELL  maxLoss     = collateral - (premium - fees) (loss reaches the collateral)
 *               maxPayout   = premium - fees                (the premium kept)
 *
 * The USD columns convert with the same collateral valuation rule the agent uses
 * (`COLLATERAL_USD_SOURCES`): a USD stablecoin at exactly 1 USD (TODO-OWNER, a
 * peg assumption rather than a measurement), everything else null rather than
 * valued. Nothing here is stored when it cannot be derived.
 */
function deriveEconomics(context: {
	ticket: TradeTicketPayload;
	strikes: bigint[];
	implementation: string;
	contracts: bigint;
	premium: bigint;
	fees: bigint;
	collateral: bigint;
}): EconomicsColumns {
	const { ticket, strikes, implementation, contracts, premium, fees, collateral } = context;
	const decimals = ticket.collateralDecimals;
	const symbol = ticket.collateralSymbol;
	const premiumNet = premium - fees;
	const maxLoss = ticket.taker === "buy" ? premium : collateral - premiumNet;
	const ownPremium = ticket.taker === "buy" ? premium : premiumNet;
	const premiumUsd8 = usd8Of(ownPremium, symbol, decimals);
	const feesUsd8 = usd8Of(fees, symbol, decimals);
	const maxLossUsd8 = usd8Of(maxLoss, symbol, decimals);

	const kind = riskKindFor(getOptionImplementationInfo(8453, implementation)?.name ?? null, strikes.length);

	let maxPayout: bigint | null = ticket.taker === "sell" ? premiumNet : null;
	let breakEvenUsd8: bigint | null = null;
	if (kind !== null && premiumUsd8 !== null && contracts > 0n) {
		const params = {
			kind,
			positionSide: ticket.taker === "buy" ? ("long" as const) : ("short" as const),
			strikes: ascendingStrikes(strikes),
			numContracts: contracts,
			premiumUsd8,
			contractSizeDecimals: ticket.contractSizeDecimals,
		};
		try {
			breakEvenUsd8 = breakEvenOf(params);
			if (ticket.taker === "buy") {
				const payoutUsd8 = maxPayoutOf(params);
				maxPayout = payoutUsd8 === null ? null : collateralOfUsd8(payoutUsd8, symbol, decimals);
			}
		} catch {
			breakEvenUsd8 = null;
		}
	}
	const maxPayoutUsd8 = maxPayout === null ? null : usd8Of(maxPayout, symbol, decimals);
	// The CHECK requires digits only, so a negative break-even (a premium above
	// the strike) is recorded as absent rather than clamped to a wrong number.
	const breakEvens = breakEvenUsd8 !== null && breakEvenUsd8 >= 0n ? [breakEvenUsd8] : [];

	return {
		columns: {
			maximumLoss: maxLoss.toString(),
			maximumLossDecimals: decimals,
			maximumPayout: maxPayout === null ? null : maxPayout.toString(),
			maximumPayoutDecimals: maxPayout === null ? null : decimals,
			breakEvenPrices: breakEvens.map((value) => value.toString()),
			breakEvenPriceDecimals: 8,
			breakEvenPricesUsd: breakEvens.map((value) => formatUsd8(value)),
			entryPremiumUsd: premiumUsd8 === null ? null : formatUsd8(premiumUsd8),
			entryFeesUsd: feesUsd8 === null ? null : formatUsd8(feesUsd8),
			maximumLossUsd: maxLossUsd8 === null ? null : formatUsd8(maxLossUsd8),
			maximumPayoutUsd: maxPayoutUsd8 === null ? null : formatUsd8(maxPayoutUsd8),
		},
	};
}

export { formatBaseUnits };

export async function recordTrade(input: RecordTradeInput): Promise<RecordResult> {
	return recordTradeFor(await getSession(), input);
}
