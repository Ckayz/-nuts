import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import type { Log } from "viem";
import { db } from "@nuts/db";
import { positions, theses, users, activity } from "@nuts/db/schema/index";
import { deriveSlug } from "@nuts/db/slug";
import { createOrFetchUser } from "@/lib/auth/store";
import { formatBaseUnits } from "@/lib/market/units";
import { structureIdOf } from "@/lib/market/structures";
import { mapPosition } from "@/lib/data/map";
import { resolvePnl } from "@/lib/position/pnl";
import { positionStatusDisplay } from "@/lib/display";
import { prepareTradeFor } from "./prepare";
import { findUnrecordedFill, UNRECORDED_FILL_WINDOW_MS } from "./store";
import { fillCard, pricedPnl, recordTradeFor, type ChainReader } from "./record";
import { listRowPnl } from "@/lib/position/view";
import type { LivePriceBook } from "@/lib/position/types";
import { encodeTradeTicket, decodeTradeTicket, type TradeTicketPayload } from "./ticket";
import { loadProductionFill, PRODUCTION_FILLS, type LoadedFill } from "./production-fills";
import { publicClient } from "./chain";

/**
 * These run against the writer's own throwaway database `trade_r1` and replay
 * real Base mainnet transactions over read-only RPC. No transaction is sent.
 *
 * The two production fills are the ones decoded in
 * `.research/thetanuts/finding-fill-debits.md`; the taker address is taken from
 * each fill's own `OrderFilled` log and used as the test session, which is the
 * only way the wallet fence can pass for someone else's transaction.
 */

/**
 * This suite owns its throwaway database (`trade_r1`) and replays two fixed
 * mainnet hashes, which `positions_chain_id_tx_hash_unique` allows only once.
 * Starting from empty tables is what makes a re-run mean the same thing as the
 * first run.
 */
/**
 * Gated on `DATABASE_URL` like every other integration file, so the offline
 * suite (`DATABASE_URL='' SKIP_ENV_VALIDATION=1 bun test`) skips instead of
 * dereferencing a client that was never created.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.log("trade record integration skipped: DATABASE_URL is not set");
	test.skip("trade record integration requires DATABASE_URL", () => {});
}
const describeLive = databaseUrl ? describe : describe.skip;

beforeAll(async () => {
	if (!databaseUrl) return;
	await db.delete(activity);
	await db.update(theses).set({ creatorPositionId: null });
	await db.delete(positions);
	await db.delete(theses);
});

async function seedUser(address: string) {
	return createOrFetchUser(db, address);
}

/** An open, structured post, so the participant path has something to attach to. */
async function seedThesis(creatorUserId: string, fill: LoadedFill) {
	const raw = fill.order.rawApiData;
	if (!raw) throw new Error("no raw order");
	const id = randomUUID();
	const headline = `Test post ${id.slice(0, 8)}`;
	const [row] = await db
		.insert(theses)
		.values({
			id,
			slug: deriveSlug(headline, id),
			creatorUserId,
			headline,
			status: "open",
			publishedAt: new Date(),
			taggedAsset: "BTC",
			direction: fill.takerSide === "buy" ? "bull" : "bear",
			underlyingAsset: "BTC",
			expiryAt: new Date(Number(fill.order.order.expiry) * 1000),
			productType: "physical put",
			isCall: raw.isCall,
			isLong: fill.takerSide === "buy",
			strikes: raw.strikes,
			strikeDecimals: 8,
			collateralAddress: raw.collateral,
			collateralSymbol: "USDC",
			collateralDecimals: 6,
			creatorOrderSnapshot: fill.snapshot,
		})
		.returning();
	if (!row) throw new Error("could not seed thesis");
	return row;
}

function ticketFor(input: {
	fill: LoadedFill;
	userId: string;
	thesisId: string | null;
	role: "creator" | "participant" | "standalone";
	collateralSymbol: string;
	collateralDecimals: number;
	contractSizeDecimals: number;
	contracts: bigint;
	premium: bigint;
	fee: bigint;
	collateral: bigint;
}): TradeTicketPayload {
	const raw = input.fill.order.rawApiData;
	if (!raw) throw new Error("no raw order");
	return {
		v: 1,
		userId: input.userId,
		wallet: input.fill.taker,
		chainId: 8453,
		structureId: structureIdOf({
			priceFeed: raw.priceFeed,
			implementationAddress: raw.implementation,
			collateralAddress: raw.collateral,
			isCall: raw.isCall,
			strikes: raw.strikes.map((strike) => BigInt(strike)),
			expiry: input.fill.order.order.expiry,
		}),
		instrumentLabel: "BTC physical put",
		side: input.fill.takerSide === "buy" ? "bull" : "bear",
		taker: input.fill.takerSide,
		thesisId: input.thesisId,
		role: input.role,
		positionSide: input.fill.takerSide === "buy" ? "back" : "counter",
		optionBook: "0x1bDff855d6811728acaDC00989e79143a2bdfDed",
		budget: (input.collateral === 0n ? input.premium : input.collateral).toString(),
		collateralAddress: raw.collateral,
		collateralSymbol: input.collateralSymbol,
		collateralDecimals: input.collateralDecimals,
		contractSizeDecimals: input.contractSizeDecimals,
		expectedContracts: input.contracts.toString(),
		expectedPremium: input.premium.toString(),
		expectedFee: input.fee.toString(),
		expectedCollateral: input.collateral.toString(),
		maxLossUsd8: null,
		maxPayoutUsd8: null,
		breakEvenUsd8: null,
		orderSnapshot: input.fill.snapshot,
		issuedAt: Math.floor(Date.now() / 1000),
	};
}

/**
 * Removes a position and anything referencing it. A confirmed position has an
 * `activity` row (`activity_position_id_positions_id_fk`), so deleting the
 * position alone fails.
 */
async function dropPosition(positionId: string | undefined): Promise<void> {
	if (!positionId) return;
	await db.delete(activity).where(eq(activity.positionId, positionId));
	await db.delete(positions).where(eq(positions.id, positionId));
}

/**
 * C1-r2. WHY the indirect route cannot be trusted, as arithmetic rather than
 * as prose: `count x price / 1e8` is a floor, so a window of counts maps to
 * one emitted premium. This is the reviewer's ROUNDING_PROOF counterexample.
 */
test("reproducing the emitted premium does not identify the contract count", () => {
	const price = 50_000_000n;
	const premium = (count: bigint) => (count * price) / 100_000_000n;
	expect(premium(2_000_000n)).toBe(1_000_000n);
	expect(premium(2_000_001n)).toBe(1_000_000n);
	expect(premium(2_000_000n)).toBe(premium(2_000_001n));
	// The window is `1e8 / price` wide, so a cheaper option hides MORE counts.
	const window = [...Array(20).keys()].filter((k) => premium(2_000_000n + BigInt(k)) === 1_000_000n);
	expect(window.length).toBeGreaterThan(1);
});

describeLive("recordTrade cross-checks every number against the chain", () => {
	test("a contract count that does not reproduce the emitted premium is not confirmed", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			// One contract unit too many: the premium the OptionBook emitted can no
			// longer be reproduced from it.
			contracts: expectation.numContracts + 1n,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});

		// C-m5. This test used to point the ticket at OptionBook 0x…01, so the
		// fill was never found and RECONCILIATION WAS NEVER EXERCISED. The real
		// OptionBook is used now, so the wrong contract count reaches
		// `contractsFrom` and the decoded calldata is what refuses it.
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		// The transaction IS a direct `fillOrder`, so the decoded count (which is
		// correct) is used and reproduces the premium — the wrong ticket count is
		// simply never consulted, and the stored count is the chain's.
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		const [confirmed] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(confirmed?.contracts).toBe(expectation.numContracts.toString());
		expect(confirmed?.contracts).not.toBe((expectation.numContracts + 1n).toString());
		await dropPosition(result.positionId);

		// C1-r2 (lane C confirming pass, finding 11). When the calldata CANNOT be
		// read as a direct fill (a smart wallet's batch), the quantity is not
		// provable from the chain and the recording REFUSES — with the ticket's
		// count wrong AND with it right, because the route itself proves nothing.
		const indirect: ChainReader = {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => ({ to: "0x00000000000000000000000000000000000000ff", input: "0x" }),
		};
		for (const contracts of [expectation.numContracts + 1n, expectation.numContracts]) {
			const attempt = { ...ticket, expectedContracts: contracts.toString() };
			const refused = await recordTradeFor(
				{ userId: user.id, walletAddress: fill.taker },
				{ token: encodeTradeTicket(attempt), txHash: fill.hash },
				indirect,
			);
			expect(refused).toMatchObject({ ok: false, code: "FILL_QUANTITY_UNPROVEN" });
			const [row] = await db
				.select()
				.from(positions)
				.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
			expect(row?.status).toBe("failed");
			expect(row?.failureReason).toBe("fill_quantity_unproven");
			// Nothing economic was written from the browser's numbers.
			expect(row?.confirmedAt).toBeNull();
			expect(row?.optionAddress).toBeNull();

			// C#9-r3. That row is a REAL FILL whose contract count could not be
			// proven — not a reverted transaction. The page must not tell its
			// holder there is no position.
			const mapped = mapPosition({ position: row!, thesis: null });
			expect(mapped.failureReason).toBe("fill_quantity_unproven");
			const resolved = resolvePnl({
				status: mapped.status,
				failureReason: mapped.failureReason,
				finalPnlUsd: null,
				estimatedPnlUsd: null,
				settlementPriceUsd: null,
				derivable: false,
				derivedPnlUsd: null,
				spotUsd8: null,
				unavailableReason: "no derivation",
				expiryAt: null,
				asOf: new Date().toISOString(),
			});
			expect(resolved.detail).toContain("Your fill is on chain");
			expect(resolved.detail).not.toContain("transaction failed");
			expect(resolved.pnlUsd).toBeNull();
			expect(positionStatusDisplay(mapped.status, mapped.failureReason).label).toBe("Not tracked yet");

			await dropPosition(row?.id);
		}
	}, 60_000);


	test("a collateral that does not match the debit measured on chain is not confirmed", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "sell");
		if (expectation === undefined) throw new Error("no sell fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			// One base unit off the 22,000,000 the wallet actually sent.
			collateral: expectation.takerCollateral + 1n,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result).toMatchObject({ ok: false, code: "DEBIT_MISMATCH" });
		if (result.ok) throw new Error("unreachable");
		console.log(`[debit fence] ${result.reason}`);
		const [row] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		// C2: refused rows are `failed`, not `pending`.
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("debit_differs_from_prepared");
		expect(row?.confirmedAt).toBeNull();
		await dropPosition(row?.id);
	}, 60_000);

	test("a fill that belongs to another wallet is refused", async () => {
		// A third decoded fill, so the two fixtures above stay untouched.
		const hash = "0x2d2fc8c7158e2b8dc102dd35c12771bdfec4994f9a287bb2053bb91e9ba3206b" as const;
		const fill = await loadProductionFill(hash);
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: "USDC",
			collateralDecimals: 6,
			contractSizeDecimals: 6,
			contracts: 1n,
			premium: 1n,
			fee: 0n,
			collateral: 0n,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ token: encodeTradeTicket({ ...ticket, wallet }), txHash: hash },
		);
		// The OrderFilled log names the real taker, not this wallet.
		expect(result).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });
		expect(fill.taker).not.toBe(wallet);
	}, 60_000);
});

describeLive("recordTrade against decoded Base production fills", () => {
	test("taker BUY 0x9c4bb1… is stored with the economics the chain shows, as a participant", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const thesis = await seedThesis(user.id, fill);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: thesis.id,
			role: "participant",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("confirmed");

		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		if (!row) throw new Error("no stored position");
		expect(BigInt(row.contracts)).toBe(expectation.numContracts);
		expect(BigInt(row.premium)).toBe(expectation.premium);
		expect(BigInt(row.fees)).toBe(expectation.fee);
		expect(BigInt(row.collateral)).toBe(expectation.takerCollateral);
		expect(row.status).toBe("confirmed");
		expect(row.confirmedAt).not.toBeNull();
		expect(row.fillEvent?.premiumAmount).toBe(expectation.premium.toString());
		expect(row.optionAddress?.toLowerCase()).toBe(fill.event.optionAddress.toLowerCase());
		expect(row.role).toBe("participant");
		expect(row.thesisId).toBe(thesis.id);
		// max loss on a long option is exactly the premium.
		expect(row.maximumLoss === null ? null : BigInt(row.maximumLoss)).toBe(expectation.premium);
		expect(row.entryPremiumUsd).toBe(formatBaseUnits(expectation.premium * 100n, 8));

		const events = await db.select().from(activity).where(eq(activity.positionId, row.id));
		expect(events.map((event) => event.eventType)).toEqual(["position_confirmed"]);

		console.log(
			[
				`[record buy ${fill.hash.slice(0, 12)}] stored`,
				`  contracts ${row.contracts} (decoded ${expectation.numContracts})`,
				`  premium   ${row.premium} = ${formatBaseUnits(BigInt(row.premium), 6)} USDC (decoded ${expectation.premium})`,
				`  fees      ${row.fees} (decoded ${expectation.fee})`,
				`  collateral ${row.collateral} (decoded ${expectation.takerCollateral})`,
				`  entry premium USD ${row.entryPremiumUsd}`,
				`  max loss  ${row.maximumLoss} = premium`,
			].join("\n"),
		);
	}, 60_000);

	test("taker SELL 0xdf3323… is stored standalone, with the collateral the chain measured", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "sell");
		if (expectation === undefined) throw new Error("no sell fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("confirmed");
		expect(result.thesisId).toBeNull();

		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		if (!row) throw new Error("no stored position");
		expect(row.role).toBe("standalone");
		expect(row.thesisId).toBeNull();
		expect(BigInt(row.contracts)).toBe(expectation.numContracts);
		expect(BigInt(row.premium)).toBe(expectation.premium);
		expect(BigInt(row.fees)).toBe(expectation.fee);
		// The taker's collateral is the debit measured from the token's Transfer
		// logs, not a formula: strike x contracts / 1e8 = 22,000,000.
		expect(BigInt(row.collateral)).toBe(expectation.takerCollateral);
		// A short position's loss reaches the collateral, less the premium kept.
		expect(row.maximumLoss === null ? null : BigInt(row.maximumLoss)).toBe(
			expectation.takerCollateral - (expectation.premium - expectation.fee),
		);
		expect(row.maximumPayout === null ? null : BigInt(row.maximumPayout)).toBe(
			expectation.premium - expectation.fee,
		);
		// Round-1 fold item 16: the dialog's card IS `View.PnlCard`, so the tiles
		// are the shared set and the money is USD at the collateral's peg.
		expect(result.card?.stats[0]?.label).toBe("Collateral locked");
		expect(result.card?.stats[0]?.value).toBe("$22.00");
		expect(result.card?.owner.initials.length).toBeGreaterThan(0);
		expect(result.card?.dateLabel).toMatch(/^\d{1,2} \w{3} \d{4}$/);
		console.log(
			[
				`[record sell ${fill.hash.slice(0, 12)}] stored standalone`,
				`  contracts ${row.contracts}`,
				`  premium   ${row.premium} fees ${row.fees}`,
				`  collateral ${row.collateral} = ${formatBaseUnits(BigInt(row.collateral), 6)} aBasUSDC`,
				`  max loss  ${row.maximumLoss}  max payout ${row.maximumPayout}`,
				`  share card tiles: ${result.card?.stats.map((t: { label: string; value: string }) => `${t.label}=${t.value}`).join(", ")}`,
			].join("\n"),
		);
	}, 60_000);

	test("a second call with the same hash is idempotent, not a second position", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const [existing] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		if (!existing) throw new Error("the first test must have stored it");
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: existing.thesisId,
			role: "participant",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.positionId).toBe(existing.id);
		const rows = await db
			.select({ total: sql<string>`count(*)` })
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		expect(rows[0]?.total).toBe("1");
	}, 60_000);
});

/**
 * C1, C2, C3 — the money-path fences the one-shot review found open. Every case
 * replays a REAL decoded Base fill and changes exactly one thing.
 */
describeLive("money-path fences (C1 receipt binding, C2 hash squatting, C3 ticket binding)", () => {
	/**
	 * Every case here replays the REAL logs and the REAL `fillOrder` calldata of
	 * a decoded mainnet fill, but under its OWN synthetic transaction hash.
	 *
	 * That matters: the suite above stores a permanent row for the production
	 * hash (its idempotency case depends on it), and nothing in `record.ts`
	 * derives economics from the hash itself — the receipt's logs and the
	 * transaction's calldata are the evidence. Synthetic hashes therefore make
	 * these cases independent of each other and of that stored row, without
	 * weakening a single check.
	 */
	async function loadFixture(side: "buy" | "sell", hash?: `0x${string}`) {
		const expectation = hash
			? PRODUCTION_FILLS.find((f) => f.hash === hash)
			: PRODUCTION_FILLS.find((f) => f.takerSide === side);
		if (expectation === undefined) throw new Error(`no ${side} fixture`);
		const fill = await loadProductionFill(expectation.hash);
		const input = (await publicClient().getTransaction({ hash: expectation.hash })).input;
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		return { expectation, fill, user, ticket, input, txHash: `0x${randomBytes(32).toString("hex")}` };
	}

	const buyFixture = () => loadFixture("buy");

	/** The real receipt AND the real direct `fillOrder` calldata. */
	function directReader(fill: LoadedFill, input: `0x${string}`): ChainReader {
		return {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => ({ to: "0x1bDff855d6811728acaDC00989e79143a2bdfDed", input }),
		};
	}

	/** The real receipt, with the top-level call hidden (a smart wallet's batch). */
	function indirectReader(fill: LoadedFill): ChainReader {
		return {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => ({ to: "0x00000000000000000000000000000000000000ff", input: "0x" }),
		};
	}

	test("C1: a snapshot naming a DIFFERENT maker is refused even though the premium reproduces", async () => {
		const { fill, user, ticket, txHash } = await buyFixture();
		// Only the maker changes. The premium, the contract count and the wallet
		// are the real ones, so the pre-fold code would have accepted this: the
		// event was bound to our wallet alone and the ticket count reproduced the
		// emitted premium.
		const impostor = "0x00000000000000000000000000000000deadbeef";
		const snapshot = {
			...ticket.orderSnapshot,
			makerAddress: impostor,
			order: { ...ticket.orderSnapshot.order, maker: impostor },
		} as typeof ticket.orderSnapshot;
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: snapshot }), txHash },
			indirectReader(fill),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(row?.status).toBe("failed");
		await dropPosition(row?.id);
	}, 60_000);

	test("C1: a snapshot with a DIFFERENT nonce is refused", async () => {
		const { fill, user, ticket, txHash } = await buyFixture();
		const snapshot = {
			...ticket.orderSnapshot,
			order: { ...ticket.orderSnapshot.order, nonce: (BigInt(ticket.orderSnapshot.order.nonce) + 1n).toString() },
		} as typeof ticket.orderSnapshot;
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: snapshot }), txHash },
			indirectReader(fill),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		await dropPosition(row?.id);
	}, 60_000);

	test("C1: a DIFFERENT strike in the snapshot is refused by the decoded calldata", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		const raw = fill.order.rawApiData;
		if (!raw) throw new Error("fixture snapshot has no rawApiData");
		const snapshot = {
			...ticket.orderSnapshot,
			rawApiData: {
				...ticket.orderSnapshot.rawApiData,
				strikes: raw.strikes.map((strike) => (BigInt(strike) + 100_000_000n).toString()),
			},
		} as typeof ticket.orderSnapshot;
		// The transaction IS a direct `fillOrder`, so the decoded order is
		// compared field by field; the premium still reproduces, which is exactly
		// the case that used to fall through and be accepted.
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: snapshot }), txHash },
			directReader(fill, input),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_DOES_NOT_MATCH" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("filled_order_differs_from_prepared");
		await dropPosition(row?.id);
	}, 60_000);

	test("C1: a DIFFERENT extraOptionData is refused (the third fixture carries a real one)", async () => {
		const { expectation, fill, user, ticket, input, txHash } = await loadFixture(
			"sell",
			"0x3e7417c5c676109e737f540debe95d0aec9477c9797c19f37e626d0c611cff04",
		);
		const raw = fill.snapshot.rawApiData;
		if (!raw) throw new Error("no rawApiData");
		// Proves the field is load-bearing on this order rather than always "0x".
		expect(raw.extraOptionData).not.toBe("0x");
		const tampered = {
			...ticket.orderSnapshot,
			rawApiData: { ...raw, extraOptionData: `0x${"0".repeat(64)}` },
		} as typeof ticket.orderSnapshot;
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: tampered }), txHash },
			directReader(fill, input),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_DOES_NOT_MATCH" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		await dropPosition(row?.id);

		// The untampered ticket confirms, so the refusal above is that one field.
		const clean = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
		);
		expect(clean.ok).toBe(true);
		if (!clean.ok) throw new Error("unreachable");
		const [stored] = await db.select().from(positions).where(eq(positions.id, clean.positionId));
		// The third fixture's own economics, measured from chain.
		expect(stored?.premium).toBe(expectation.premium.toString());
		expect(stored?.fees).toBe(expectation.fee.toString());
		expect(stored?.collateral).toBe(expectation.takerCollateral.toString());
		expect(stored?.contracts).toBe(expectation.numContracts.toString());
		expect(stored?.premium).toBe("9009");
		expect(stored?.fees).toBe("737");
		expect(stored?.collateral).toBe("1150000");
		await dropPosition(clean.positionId);
	}, 60_000);

	test("C1: a chain read that FAILS is reported unavailable, never downgraded to the ticket's numbers", async () => {
		const { fill, user, ticket, txHash } = await buyFixture();
		const broken: ChainReader = {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => {
				throw new Error("RPC timeout");
			},
		};
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			broken,
		);
		expect(result).toMatchObject({ ok: false, code: "CHAIN_UNAVAILABLE" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		// The fill is fine; only our reading of it failed, so the row stays
		// pending and a retry still finds it.
		expect(row?.status).toBe("pending");
		await dropPosition(row?.id);
	}, 60_000);

	test("C2: an attacker who reserves a hash cannot stop the true taker recording it", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();

		// The attacker holds a perfectly valid ticket of their OWN and simply
		// submits the victim's transaction hash. The pre-fold code inserted their
		// pending row against the globally unique key and the victim's later
		// attempt threw "already belongs to another wallet" for ever.
		const attackerWallet = `0x${randomBytes(20).toString("hex")}`;
		const attacker = await seedUser(attackerWallet);
		const attackerTicket = { ...ticket, userId: attacker.id, wallet: attackerWallet };
		const stall: ChainReader = {
			waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
			getTransaction: async () => ({ to: null, input: "0x" }),
		};
		const grab = await recordTradeFor(
			{ userId: attacker.id, walletAddress: attackerWallet },
			{ token: encodeTradeTicket(attackerTicket), txHash },
			stall,
		);
		expect(grab).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });

		// The victim — the wallet the chain shows as the taker — records normally.
		const victim = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
		);
		expect(victim.ok).toBe(true);
		if (!victim.ok) throw new Error("unreachable");
		const [stored] = await db.select().from(positions).where(eq(positions.id, victim.positionId));
		expect(stored?.walletAddress).toBe(fill.taker);
		expect(stored?.status).toBe("confirmed");

		const live = await db.select().from(positions).where(eq(positions.txHash, txHash));
		// Exactly one non-failed row, and it is the true taker's.
		expect(live.filter((row) => row.status !== "failed")).toHaveLength(1);
		for (const row of live) await dropPosition(row.id);
	}, 60_000);

	test("C2: a squatter's ABANDONED pending row is superseded by the on-chain taker", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		const squatterWallet = `0x${randomBytes(20).toString("hex")}`;
		const squatter = await seedUser(squatterWallet);

		// The squatter's row is left `pending` — they never came back to finish.
		const [held] = await db
			.insert(positions)
			.values({
				thesisId: null,
				userId: squatter.id,
				role: "standalone",
				side: "back",
				status: "pending",
				chainId: 8453,
				walletAddress: squatterWallet,
				orderId: ticket.structureId,
				orderSnapshot: ticket.orderSnapshot,
				txHash,
				referrer: null,
				budget: "1",
				budgetDecimals: 6,
				contracts: "1",
				contractDecimals: 6,
				premium: "0",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "0",
				collateralDecimals: 6,
				breakEvenPrices: [],
				breakEvenPriceDecimals: 8,
				breakEvenPricesUsd: [],
			})
			.returning();
		expect(held?.status).toBe("pending");

		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		const [squatted] = await db.select().from(positions).where(eq(positions.id, held?.id ?? ""));
		expect(squatted?.status).toBe("failed");
		expect(squatted?.failureReason).toBe("superseded_by_onchain_taker");
		const [mine] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(mine?.walletAddress).toBe(fill.taker);
		await dropPosition(result.positionId);
		await dropPosition(held?.id);
	}, 60_000);

	test("C2: a wallet that is NOT the on-chain taker cannot supersede a pending row", async () => {
		const { fill, ticket, txHash } = await buyFixture();
		const holderWallet = `0x${randomBytes(20).toString("hex")}`;
		const holder = await seedUser(holderWallet);
		const outsiderWallet = `0x${randomBytes(20).toString("hex")}`;
		const outsider = await seedUser(outsiderWallet);

		// A pending row held by someone else, exactly as `claimPending` sees one.
		const [held] = await db
			.insert(positions)
			.values({
				thesisId: null,
				userId: holder.id,
				role: "standalone",
				side: "back",
				status: "pending",
				chainId: 8453,
				walletAddress: holderWallet,
				orderId: ticket.structureId,
				orderSnapshot: ticket.orderSnapshot,
				txHash,
				referrer: null,
				budget: "1",
				budgetDecimals: 6,
				contracts: "1",
				contractDecimals: 6,
				premium: "0",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "0",
				collateralDecimals: 6,
				breakEvenPrices: [],
				breakEvenPriceDecimals: 8,
				breakEvenPricesUsd: [],
			})
			.returning();
		expect(held?.status).toBe("pending");

		// The outsider is on neither side of this fill's `OrderFilled` log, so
		// their claim is refused and the holder's row is left exactly as it was.
		const steal = await recordTradeFor(
			{ userId: outsider.id, walletAddress: outsiderWallet },
			{ token: encodeTradeTicket({ ...ticket, userId: outsider.id, wallet: outsiderWallet }), txHash },
			{
				waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
				getTransaction: async () => ({ to: null, input: "0x" }),
			},
		);
		expect(steal).toMatchObject({ ok: false, code: "TX_HASH_TAKEN" });
		const rows = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(held?.id ?? "");
		expect(rows[0]?.walletAddress).toBe(holderWallet);
		expect(rows[0]?.status).toBe("pending");
		expect(rows[0]?.failureReason).toBeNull();
		for (const row of rows) await dropPosition(row.id);
	}, 60_000);

	test("C3: a pending row cannot be confirmed with a DIFFERENT ticket's economics", async () => {
		const { expectation, fill, user, ticket, input, txHash } = await buyFixture();
		// First attempt leaves a pending row (the chain read fails).
		const stalled = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			{
				waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
				getTransaction: async () => {
					throw new Error("RPC timeout");
				},
			},
		);
		expect(stalled).toMatchObject({ ok: false, code: "CHAIN_UNAVAILABLE" });

		// A DIFFERENT ticket for the same hash: same wallet, different budget.
		const other = { ...ticket, budget: (BigInt(ticket.budget) + 1n).toString() };
		const mismatch = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(other), txHash },
			directReader(fill, input),
		);
		expect(mismatch).toMatchObject({ ok: false, code: "TICKET_MISMATCH" });

		// The ORIGINAL ticket still confirms the row it created; only `issuedAt`
		// differs, which is deliberately outside the identity.
		const retry = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, issuedAt: ticket.issuedAt + 60 }), txHash },
			directReader(fill, input),
		);
		expect(retry.ok).toBe(true);
		if (!retry.ok) throw new Error("unreachable");
		const [row] = await db.select().from(positions).where(eq(positions.id, retry.positionId));
		expect(row?.status).toBe("confirmed");
		expect(row?.premium).toBe(expectation.premium.toString());
		await dropPosition(retry.positionId);
	}, 60_000);

	test("C6: a share card that THROWS does not reject the recording", async () => {
		const { expectation, fill, user, ticket, input, txHash } = await buyFixture();
		// The real failure mode: `fillCard` runs after the confirming transaction
		// commits, and a throw there used to reject the whole action. The browser
		// would return to idle with no position id and the next "Trade" click
		// would send a SECOND fill against money already spent.
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
			async () => {
				throw new Error("card builder exploded");
			},
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("the card must not fail the recording");
		expect(result.status).toBe("confirmed");
		expect(result.positionId).toBeTruthy();
		expect(result.txHash).toBe(txHash);
		// The card is the only thing lost; everything else is intact.
		expect(result.card).toBeNull();
		expect(result.settled?.premium).toBe(expectation.premium.toString());
		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(row?.status).toBe("confirmed");
		expect(row?.premium).toBe(expectation.premium.toString());
		await dropPosition(result.positionId);
	}, 60_000);

	/**
	 * CL-2 (Claude's own leg, confirming round). The confirming UPDATE's
	 * `status = 'pending'` predicate was pinned by nothing: dropping
	 * `eq(positions.status, "pending")` from `record.ts` left this file at
	 * 32 pass / 0 fail (measured on a fresh 0008 throwaway).
	 *
	 * That predicate is what C3 rests on — a row that has already reached a
	 * TERMINAL state must never regress to `confirmed`, and the loser of two
	 * concurrent confirmations must write no second `activity` row. The
	 * `ChainReader` seam is the injection point: the reader flips the row while
	 * `recordTradeFor` is awaiting the receipt, which is exactly the window a
	 * concurrent writer occupies.
	 */
	test("C3: a row that turned terminal mid-recording never regresses to confirmed", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		let flipped = 0;
		const racingReader: ChainReader = {
			waitForTransactionReceipt: async () => {
				// The pending row exists by now (`claimPending` inserted it). Turn it
				// terminal, as a concurrent confirmation or a revert-marking would.
				flipped += (
					await db
						.update(positions)
						.set({ status: "failed", failureReason: "transaction_reverted" })
						.where(and(eq(positions.chainId, 8453), eq(positions.txHash, txHash), eq(positions.status, "pending")))
						.returning()
				).length;
				return { status: "success", logs: fill.logs };
			},
			getTransaction: async () => ({ to: "0x1bDff855d6811728acaDC00989e79143a2bdfDed", input }),
		};

		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			racingReader,
		);

		const rows = await db.select().from(positions).where(eq(positions.txHash, txHash));
		const row = rows[0];
		const events = row === undefined ? [] : await db.select().from(activity).where(eq(activity.positionId, row.id));
		expect({
			flipped,
			rows: rows.length,
			status: row?.status,
			failureReason: row?.failureReason,
			confirmedAt: row?.confirmedAt,
			// Nothing economic was written over the terminal row.
			optionAddress: row?.optionAddress,
			// The confirming UPDATE and its activity insert share one transaction:
			// no row means no event.
			events: events.length,
			// The caller is handed the row that actually exists, not an invented one.
			resultStatus: result.ok ? result.status : `refused:${result.code}`,
		}).toEqual({
			flipped: 1,
			rows: 1,
			status: "failed",
			failureReason: "transaction_reverted",
			confirmedAt: null,
			optionAddress: null,
			events: 0,
			resultStatus: "failed",
		});
		for (const stale of rows) await dropPosition(stale.id);
	}, 60_000);

	test("C3: two concurrent confirmations write ONE row and ONE activity entry", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		const token = encodeTradeTicket(ticket);
		const reader = directReader(fill, input);
		const [a, b] = await Promise.all([
			recordTradeFor({ userId: user.id, walletAddress: fill.taker }, { token, txHash }, reader),
			recordTradeFor({ userId: user.id, walletAddress: fill.taker }, { token, txHash }, reader),
		]);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		if (!a.ok || !b.ok) throw new Error("unreachable");
		expect(a.positionId).toBe(b.positionId);
		const rows = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(rows.filter((row) => row.status !== "failed")).toHaveLength(1);
		const events = await db.select().from(activity).where(eq(activity.positionId, a.positionId));
		expect(events).toHaveLength(1);
		for (const row of rows) await dropPosition(row.id);
	}, 60_000);
});

describeLive("refusals: nothing is stored when the chain does not agree", () => {
	const reader = (status: string, logs: readonly Log<bigint, number, false>[] = []): ChainReader => ({
		waitForTransactionReceipt: async () => ({ status, logs }),
		getTransaction: async () => ({ to: null, input: "0x" }),
	});

	async function standaloneTicket(hashSeed: string) {
		const expectation = PRODUCTION_FILLS[0];
		if (expectation === undefined) throw new Error("no fixture");
		const fill = await loadProductionFill(expectation.hash);
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		return {
			user,
			wallet,
			ticket: { ...ticket, wallet },
			txHash: `0x${hashSeed.padEnd(64, "0")}`,
		};
	}

	test("a reverted receipt marks the position failed and stores no economics", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const result = await recordTradeFor(
			{ userId: setup.user.id, walletAddress: setup.wallet },
			{ token: encodeTradeTicket(setup.ticket), txHash: setup.txHash },
			reader("reverted"),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("failed");
		expect(result.card).toBeNull();
		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(row?.status).toBe("failed");
		expect(row?.fillEvent).toBeNull();
		expect(row?.confirmedAt).toBeNull();
	});

	test("a receipt with no OptionBook fill for this wallet stores nothing more", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const result = await recordTradeFor(
			{ userId: setup.user.id, walletAddress: setup.wallet },
			{ token: encodeTradeTicket(setup.ticket), txHash: setup.txHash },
			reader("success"),
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("FILL_NOT_FOUND");
		// C2. A refusal must NOT leave a `pending` row squatting the transaction
		// hash: the uniqueness is partial over non-failed rows since 0008, so the
		// row is marked `failed` with the reason and the hash is free again.
		const [row] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, setup.txHash)));
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("no_matching_order_filled");
		expect(row?.confirmedAt).toBeNull();
		expect(row?.fillEvent).toBeNull();
	});

	test("no session, a wallet that is not the session's, and a tampered token are all refused", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const token = encodeTradeTicket(setup.ticket);

		expect(await recordTradeFor(null, { token, txHash: setup.txHash })).toMatchObject({
			ok: false,
			code: "NO_SESSION",
		});
		const other = `0x${randomBytes(20).toString("hex")}`;
		const otherUser = await seedUser(other);
		expect(
			await recordTradeFor({ userId: otherUser.id, walletAddress: other }, { token, txHash: setup.txHash }),
		).toMatchObject({ ok: false, code: "WALLET_MISMATCH" });

		// One flipped character in the payload invalidates the signature.
		const [body, signature] = token.split(".");
		const tampered = `${(body ?? "").slice(0, -1)}${(body ?? "").endsWith("A") ? "B" : "A"}.${signature}`;
		expect(decodeTradeTicket(tampered)).toBeNull();
		expect(
			await recordTradeFor({ userId: setup.user.id, walletAddress: setup.wallet }, { token: tampered, txHash: setup.txHash }),
		).toMatchObject({ ok: false, code: "BAD_TICKET" });

		expect(
			await recordTradeFor({ userId: setup.user.id, walletAddress: setup.wallet }, { token, txHash: "not-a-hash" }),
		).toMatchObject({ ok: false, code: "BAD_TX_HASH" });
	});

	test("a ticket for another chain never decodes", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const wrongChain = encodeTradeTicket({ ...setup.ticket, chainId: 1 as unknown as 8453 });
		expect(decodeTradeTicket(wrongChain)).toBeNull();
	});
});

describeLive("prepareTrade refuses before any calldata exists", () => {
	test("without a session", async () => {
		const result = await prepareTradeFor(null, {
			structureId: "0".repeat(16),
			side: "bull",
			budgetInput: "10",
		});
		expect(result).toMatchObject({ ok: false, code: "NO_SESSION", needsSignIn: true });
	});

	test("with a structure that is not on the book", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const result = await prepareTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ structureId: "deadbeefdeadbeef", side: "bull", budgetInput: "10" },
		);
		expect(result).toMatchObject({ ok: false, code: "STRUCTURE_GONE" });
	}, 60_000);

	test("on a live structure with an unfunded wallet, past the side gate (the package agrees with the chain since core round 9)", async () => {
		const { getLiveMarkets } = await import("@/lib/market/live");
		const book = await getLiveMarkets();
		if ("error" in book) throw new Error(book.detail);
		const structure = book.assets
			.flatMap((asset) => asset.structures)
			.find((candidate) => candidate.buy !== null && candidate.collateralDecimals === 6);
		if (structure === undefined) throw new Error("no 6-decimal buy structure on the book");
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const result = await prepareTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ structureId: structure.id, side: "bull", budgetInput: "10" },
		);
		// A fresh random wallet has no allowance, so preparation stops at the
		// APPROVE stage: it hands back approval calldata only (nothing is sent,
		// the fill is not even simulated yet) — and never the side gate. Measured.
		if (result.ok) {
			expect(result.stage).toBe("approve");
			console.log(`[prepare] stage=${result.stage}`);
		} else {
			expect(result.code).not.toBe("TAKER_SIDE_CONTRADICTION");
			console.log(`[prepare refused] ${result.code}: ${result.reason}`);
		}
		// Nothing was written: no draft post, no position.
		const rows = await db.select({ total: sql<string>`count(*)` }).from(positions).where(eq(positions.userId, user.id));
		expect(rows[0]?.total).toBe("0");
	}, 60_000);
});

/**
 * drizzle wraps a driver error and its own message is only the failed SQL, so
 * the database's message lives on `cause`. Asserting on that is what proves
 * WHICH fence fired.
 */
function databaseError(error: unknown): { message: string; constraint?: string } {
	const cause = (error as { cause?: { message?: unknown; constraint?: unknown } }).cause;
	return {
		message: typeof cause?.message === "string" ? cause.message : String(error),
		constraint: typeof cause?.constraint === "string" ? cause.constraint : undefined,
	};
}

async function failure(run: () => Promise<unknown>): Promise<{ message: string; constraint?: string }> {
	try {
		await run();
	} catch (error) {
		return databaseError(error);
	}
	throw new Error("expected the database to refuse this write");
}

describeLive("C#2: an unrecorded fill owns the ticket (server fence)", () => {
	/** The minimum a `pending` row needs; nothing here depends on the numbers. */
	async function pendingRow(userId: string, wallet: string, createdAt: Date): Promise<string> {
		const txHash = `0x${randomBytes(32).toString("hex")}`;
		await db.insert(positions).values({
			thesisId: null,
			userId,
			role: "standalone",
			side: "back",
			status: "pending",
			chainId: 8453,
			walletAddress: wallet,
			orderId: "0".repeat(16),
			orderSnapshot: {
				version: 1 as const,
				order: {
					maker: `0x${"1".repeat(40)}`,
					taker: `0x${"0".repeat(40)}`,
					option: `0x${"2".repeat(40)}`,
					isBuyer: false,
					numContracts: "10000",
					price: "50000000",
					expiry: "1893456000",
					nonce: "1",
				},
				signature: "0x00",
				availableAmount: "1000000",
				makerAddress: `0x${"1".repeat(40)}`,
			},
			txHash,
			referrer: null,
			budget: "1",
			budgetDecimals: 6,
			contracts: "1",
			contractDecimals: 6,
			premium: "0",
			premiumDecimals: 6,
			fees: "0",
			feeDecimals: 6,
			collateral: "0",
			collateralDecimals: 6,
			breakEvenPrices: [],
			breakEvenPriceDecimals: 8,
			breakEvenPricesUsd: [],
			createdAt,
		});
		return txHash;
	}

	test("findUnrecordedFill sees a fresh pending row and refuses prepareTrade", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const txHash = await pendingRow(user.id, wallet, new Date());

		const found = await findUnrecordedFill(db, wallet, new Date());
		expect(found?.txHash).toBe(txHash);

		const result = await prepareTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ structureId: "deadbeefdeadbeef", side: "bull", budgetInput: "10" },
		);
		// It refuses BEFORE the structure is even looked up: no calldata path runs.
		expect(result).toMatchObject({ ok: false, code: "UNRECORDED_FILL" });
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toContain(txHash.slice(0, 10));
	});

	test("a row older than the window self-heals, and another wallet is unaffected", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		await pendingRow(user.id, wallet, new Date(Date.now() - UNRECORDED_FILL_WINDOW_MS - 60_000));
		expect(await findUnrecordedFill(db, wallet, new Date())).toBeNull();

		const other = `0x${randomBytes(20).toString("hex")}`;
		const otherUser = await seedUser(other);
		await pendingRow(otherUser.id, other, new Date());
		expect(await findUnrecordedFill(db, wallet, new Date())).toBeNull();
		expect((await findUnrecordedFill(db, other, new Date()))?.txHash).toBeTruthy();
	});

	test("a confirmed or failed row does not block anything", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const txHash = await pendingRow(user.id, wallet, new Date());
		await db.update(positions).set({ status: "failed", failureReason: "transaction_reverted" }).where(eq(positions.txHash, txHash));
		expect(await findUnrecordedFill(db, wallet, new Date())).toBeNull();
	});

	test("the wallet is matched lowercase, as the column is stored", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		await pendingRow(user.id, wallet, new Date());
		expect(await findUnrecordedFill(db, wallet.toUpperCase().replace("0X", "0x"), new Date())).not.toBeNull();
	});
});

describeLive("migration 0007 fences", () => {
	test("thesis_id and role must agree, in both directions", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const fill = await loadProductionFill(PRODUCTION_FILLS[0]?.hash ?? "0x");
		const base = {
			userId: user.id,
			side: "back" as const,
			status: "pending" as const,
			chainId: 8453,
			walletAddress: wallet,
			orderId: "x",
			orderSnapshot: fill.snapshot,
			budget: "1",
			budgetDecimals: 6,
			contracts: "1",
			contractDecimals: 6,
			premium: "1",
			premiumDecimals: 6,
			fees: "0",
			feeDecimals: 6,
			collateral: "0",
			collateralDecimals: 6,
			breakEvenPrices: [],
			breakEvenPriceDecimals: 8,
			breakEvenPricesUsd: [],
		};
		// standalone with a thesis -> refused
		const thesisId = (await seedThesis(user.id, fill)).id;
		const withThesis = await failure(() =>
			db.insert(positions).values({ ...base, role: "standalone", thesisId, txHash: `0x${randomBytes(32).toString("hex")}` }),
		);
		expect(withThesis.constraint).toBe("positions_thesis_role_consistent");
		// participant with no thesis -> refused
		const withoutThesis = await failure(() =>
			db.insert(positions).values({ ...base, role: "participant", thesisId: null, txHash: `0x${randomBytes(32).toString("hex")}` }),
		);
		expect(withoutThesis.constraint).toBe("positions_thesis_role_consistent");
		console.log(`[0007 CHECK] ${withThesis.message}`);
	}, 60_000);

	test("a standalone position can never be a post's creator position", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const fill = await loadProductionFill(PRODUCTION_FILLS[0]?.hash ?? "0x");
		const thesis = await seedThesis(user.id, fill);
		const [standalone] = await db
			.insert(positions)
			.values({
				userId: user.id,
				thesisId: null,
				role: "standalone",
				side: "back",
				status: "confirmed",
				confirmedAt: new Date(),
				chainId: 8453,
				walletAddress: wallet,
				orderId: "x",
				orderSnapshot: fill.snapshot,
				fillEvent: {
					version: 1,
					nonce: "1",
					buyer: wallet,
					seller: wallet,
					optionAddress: wallet,
					premiumAmount: "1",
					feeCollected: "0",
					referrer: wallet,
					referralFeePaid: "0",
					sellerWasMaker: true,
				},
				txHash: `0x${randomBytes(32).toString("hex")}`,
				budget: "1",
				budgetDecimals: 6,
				contracts: "1",
				contractDecimals: 6,
				premium: "1",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "0",
				collateralDecimals: 6,
				breakEvenPrices: [],
				breakEvenPriceDecimals: 8,
				breakEvenPricesUsd: [],
			})
			.returning();
		if (!standalone) throw new Error("could not insert the standalone position");
		// The frozen 0002 trigger requires role = 'creator' and a matching
		// thesis_id, so the link is refused when the deferred check runs.
		const refused = await failure(() =>
			db.transaction(async (tx) => {
				await tx.update(theses).set({ creatorPositionId: standalone.id }).where(eq(theses.id, thesis.id));
			}),
		);
		// The deferred trigger fires at COMMIT, so the transaction is the thing
		// that fails, and the frozen 0002 wording is what fails it.
		expect(refused.message).toMatch(/invalid creator position for thesis/);
		console.log(`[0002 trigger] ${refused.message}`);
		const [after] = await db.select().from(theses).where(eq(theses.id, thesis.id));
		expect(after?.creatorPositionId).toBeNull();
	}, 60_000);
});

/** Kept so the RPC client is torn down after the suite instead of holding the process open. */
test("teardown", () => {
	expect(typeof publicClient().getBlockNumber).toBe("function");
	expect(typeof users).toBe("object");
});


/**
 * MAJOR-1 (Opus user-flow re-walk, pass 2). The post-fill dialog is the one
 * moment the share card was designed for, and it printed
 *
 *   HERO  <b class=" num none">—</b>
 *   BASIS "No P&L yet: a live figure needs a mark for this option and nothing
 *          published one at the moment this fill confirmed."
 *
 * while `/p/<id>` printed `−$1.00 (−100.0% of max loss)` for the SAME position
 * from the SAME snapshot at the same instant. `fillCard` hardcoded
 * `basis: "unavailable"`.
 *
 * The spot is INJECTED here, so the assertion is arithmetic rather than a
 * reading of whatever BTC costs while the suite runs.
 */
describeLive("MAJOR-1: the post-fill card is priced like every other surface", () => {
	/** Far above any strike on the book: a long put there expires worthless. */
	const WORTHLESS_SPOT = "10000000000000000"; // $100,000,000 at 8 decimals
	const book = (spotUsd8: string | null): LivePriceBook => ({
		spotUsd8: () => spotUsd8,
		collateralUsdPrice8: () => "100000000",
		feedError: null,
	});

	async function buyRow() {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		return { expectation, fill, user, ticket };
	}

	test("the dialog's card carries the DERIVED figure, not an em dash", async () => {
		const { expectation, fill, user, ticket } = await buyRow();
		const recorded = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
			publicClient(),
			(t, r) => fillCard(t, r, book(WORTHLESS_SPOT)),
		);
		expect(recorded.ok).toBe(true);
		if (!recorded.ok) throw new Error("unreachable");
		const card = recorded.card;
		if (card === null) throw new Error("no card");

		const [row] = await db.select().from(positions).where(eq(positions.id, recorded.positionId));
		if (!row) throw new Error("no stored position");
		const domain = mapPosition({ position: row, thesis: null });
		// The SAME builder `/p/<id>` and every list row use.
		const live = listRowPnl(domain, book(WORTHLESS_SPOT));

		// Independent arithmetic: a long put above its strike pays nothing, so the
		// result is exactly the premium that was paid — 999,998 USDC base units.
		const premiumUsd = `-${formatBaseUnits(expectation.premium, 6)}`;

		expect({
			basis: card.basis,
			derived: live.derivedPnlUsd,
			sentence: card.pnlBasisLabel.startsWith("Estimate: what this position would pay"),
			emDash: card.pnl.usd === "\u2014" || card.pnl.signed === "\u2014",
			// The rendered hero, which used to be the em dash the tester measured.
			signed: card.pnl.signed,
			pct: card.pnlPctLabel,
		}).toEqual({
			basis: "derived",
			derived: premiumUsd,
			sentence: true,
			emDash: false,
			signed: "\u2212$1",
			pct: "\u2212100.0% of max loss",
		});
		/**
		 * The tester's own second measurement: the DIALOG renders this card, and
		 * its hero used to be `<b class=" num none">—</b>`.
		 */
		const { createElement } = await import("react");
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { PnlCard } = await import("@/components/position/pnl-card");
		// `createElement` rather than JSX so this stays a `.ts` file: two docs and
		// `packages/db/src/test-fence.ts` name it by path.
		const html = renderToStaticMarkup(createElement(PnlCard, { card }));
		expect(html).not.toContain('num none">\u2014');
		expect(html).toContain("\u2212$1");

		console.log(`[MAJOR-1] ${JSON.stringify({ basis: card.basis, pnl: card.pnl, derived: live.derivedPnlUsd, label: card.pnlBasisLabel.slice(0, 60) })}`);
	}, 60_000);

	test("no spot keeps the honest sentence and never invents a zero", async () => {
		const [row] = await db.select().from(positions).limit(1);
		if (!row) throw new Error("no stored position");
		const answer = await pricedPnl(row, book(null));
		expect({ usd: answer.usd, basis: answer.basis, honest: answer.detail.includes("No P&L") || answer.detail.includes("Settlement pending") || answer.detail.includes("price feed") }).toEqual({
			usd: null,
			basis: "unavailable",
			honest: true,
		});
	});
});
