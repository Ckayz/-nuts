import "server-only";

import { tool } from "ai";
import { z } from "zod";

import type * as Domain from "@/types";
import { decimalFromBaseUnits, sumDecimals } from "@/lib/data/decimal";
import { ascendingStrikes, riskKindFor } from "@/lib/market/structures";
import { findByInstrumentKey } from "@/lib/thetanuts/instrument";
import {
	COLLATERAL_USD_UNAVAILABLE,
	CONTRACT_UNITS_UNVERIFIED,
	collateralUsdPrice,
	getOrderSnapshot,
	isFeedUnavailable,
	sizeFill,
} from "@/lib/thetanuts/orders";
import type { TradeableOrder } from "@/lib/thetanuts/types";
import {
	type DerivationInputs,
	USD_DECIMALS,
	derivePnlAtSpot,
	derivedRisk,
	lifecycleStatus,
	resolvePnl,
	usd8FromDecimal,
	usd8FromSpotNumber,
} from "@/lib/position/pnl";
import { livePriceBook } from "@/lib/position/spot";
import type { LivePriceBook } from "@/lib/position/types";
import { rowDerivation, rowPriceKeys } from "@/lib/position/view";
import { rfqClientFor } from "@/lib/rfq/prepare";

/**
 * The agent's two POSITION tools (PRD 10.5's `getUserPositions`, and the
 * "what if it settles at X" question the scope gate already admits).
 *
 * Why they exist. `lib/agent/scope.ts` lists "The user's own positions,
 * portfolio and profit or loss" as in scope, so layer 1 lets the question
 * through — and until now no tool could answer it, which left the model with
 * nothing to ground an answer in. The portfolio page has computed the answer
 * all along (`lib/page-data.ts` -> `getPortfolio` -> `rowPriceKeys` ->
 * `livePriceBook` -> `listRowPnl`); this file asks the SAME functions the same
 * way, so the agent and `/portfolio` cannot state different figures for one
 * fill.
 *
 * Three rules, the same three `lib/agent/tools.ts` states:
 *
 * 1. **Decimal strings, never floats** (PRD 10.3).
 * 2. **Bounded output.** A portfolio can be long; the rows are capped and
 *    totalled.
 * 3. **Say when a value is unknown.** Every `null` here carries the sentence
 *    that says WHY it is null, taken from the code that refused it, never a
 *    generic "unavailable".
 *
 * And one rule this file adds:
 *
 * 4. **THE WALLET IS NEVER A MODEL ARGUMENT.** It is bound in the closure below
 *    from the server-side session, exactly as `createExecutionTools` binds the
 *    connected account (`lib/agent/execute.ts`): a wallet the model can name is
 *    a wallet a prompt-injected model can change, and "show me the positions of
 *    0x…" would then read a stranger's portfolio out of the database. Neither
 *    tool's `inputSchema` has an address field, and `positions.test.ts` asserts
 *    that from the schema itself rather than from this comment.
 *
 * This file NEVER prepares, signs or sends anything. It reads.
 */

/**
 * Every sentence these tools put into the model's context.
 *
 * TODO-OWNER: all of it. The mockup draws no agent surface and the PRD sets no
 * wording for one, so none of this copy has provenance — the same reason
 * `components/agent/copy.test.ts` exists for the components.
 */
const COPY = {
	signedOut:
		"The user is not signed in, so this app cannot see any positions. Ask them to connect their wallet — that is what signs them in — and offer to look again afterwards.",
	noSuchPosition:
		"No position with that id is held by the signed-in wallet. Do not guess at another one: ask which position they mean, or list their positions first.",
	instrumentGone:
		"That instrument is no longer quoted. The book re-signs about every minute. Search again and use a current instrumentKey.",
	needOneSubject:
		"Ask for exactly one subject: either a positionId the user already holds, or an instrumentKey from a search TOGETHER with the budget they would spend. Never both, and never neither.",
	needBudget:
		"An instrumentKey needs the budget the user would spend with it, in the order's collateral token, because the payoff depends on how many contracts that buys.",
	settlementBasis:
		"This is what the position would be worth if the underlying settled at exactly that price. It is not a mark-to-market value and carries no time value: it ignores everything that could still happen before expiry. Say that whenever you report it.",
	noRiskModel:
		"This structure has no payoff model in the deterministic risk code, so a settlement figure would be a guess. Say it is unavailable.",
	badSettlementPrice: "The settlement price must be a plain positive decimal number of US dollars.",
	unpricedPremium:
		"The recorded fill amounts do not satisfy the risk model's own checks, so no figure can be produced for this position.",
	/**
	 * RFQ-born options. There is no `positions` row for one — an RFQ mints its
	 * option at SETTLEMENT, by whoever sends `settleQuotation`, so nothing in
	 * this app ever saw a fill for it. The Thetanuts indexer lists it and that
	 * is all this can say about it, which is why every figure below is absent
	 * rather than estimated.
	 * TODO-OWNER: the wording.
	 */
	rfqBasis:
		"This option came from a custom request (RFQ) and was minted at settlement, so this app recorded no fill for it. It is listed by the Thetanuts indexer only: there is no premium, no maximum loss and no profit or loss figure for it here. Say that rather than estimating one.",
	rfqUnreadable:
		"The Thetanuts indexer could not be read, so any options minted from the user's custom requests are not listed here. Do not say they have none.",
} as const;

/**
 * How many positions one answer may carry.
 *
 * TODO-OWNER: 10 is not the owner's number. It bounds MODEL CONTEXT, not what
 * the user holds — `totals.count` below always counts the rows read, so a
 * truncated list can never be read as "that is all you have".
 */
const MAX_ROWS = 10;

/**
 * The window `totals.expiringWithinDays` counts.
 *
 * TODO-OWNER: 7 is not the owner's number, and "soon" is a product judgement.
 * It is returned WITH the window so the model repeats the window rather than
 * the word.
 */
const EXPIRY_SOON_DAYS = 7;

/** A plain decimal, or null. Same guard as `lib/position/view.ts` and `lib/position/lifecycle.ts`,
 *  which both keep their own copy for the same reason: neither exports it. */
function decimalOrNull(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/** Strikes as the user writes them, from the 8-decimal integers the feed publishes. */
function strikesUsdOf(strikesUsd8: readonly string[]): string[] {
	return strikesUsd8.map((strike) => decimalFromBaseUnits(strike, USD_DECIMALS));
}

export interface PositionSummary {
	readonly positionId: string;
	/** The position's own page. Rendered as a link by `components/agent/market-link.ts`. */
	readonly path: string;
	readonly asset: string | null;
	readonly label: string;
	/**
	 * The TAKER side of the fill: "buy" paid a premium, "sell" locked collateral.
	 * NOT `Domain.Position.side`, which is "back"/"counter" — whose side of a POST
	 * the fill took, a different fact that says nothing about the market (see
	 * `marketDirection` in `lib/position/instrument.ts`).
	 */
	readonly side: "buy" | "sell" | null;
	/** Which way the option bets, by standard options semantics; null with no instrument. */
	readonly direction: "bull" | "bear" | null;
	readonly optionType: "call" | "put" | null;
	readonly strikesUsd: string[] | null;
	/** The lifecycle status the app shows, expiry included — `lifecycleStatus`, not the raw column. */
	readonly status: string;
	readonly expiryAt: string | null;
	/**
	 * The premium leg in its COLLATERAL TOKEN, never as USD: the fill stored base
	 * units and a token amount is not a dollar amount (PRD 10.1). Null when the
	 * fill recorded no amounts.
	 */
	readonly premium: { amount: string; token: string | null } | null;
	readonly maxLossUsd: string | null;
	readonly maxPayoutUsd: string | null;
	readonly breakEvenUsd: string | null;
	/** Intrinsic value at the live spot, the figure `/p/<id>` prints; null with its reason in `note`. */
	readonly derivedPnlUsd: string | null;
	/** What the app SHOWS as this position's P&L — settled result, recorded estimate or the derived figure. */
	readonly pnlUsd: string | null;
	readonly basis: string;
	/** One factual sentence naming exactly where `pnlUsd` came from, or why there is none. */
	readonly note: string;
}

/**
 * One portfolio row -> what the model is told about it.
 *
 * Exported so a test can pin it against `listRowPnl` for the same row and the
 * same price book: the agent's number and the portfolio row's number are the
 * same number or this file is wrong.
 *
 * WHICH SOURCE FOR MAX LOSS / MAX PAYOUT / BREAK-EVEN. The recorded column
 * first, the derived figure second — byte-for-byte the precedence
 * `positionPage` uses (`lib/position/view.ts`: `decimalOrNull(economics.
 * maximumLossUsd) ?? derived?.maxLossUsd ?? null`). A figure the fill wrote down
 * beats one this process recomputed, and the derived one is only ever a stand-in
 * for a column nothing has filled. Choosing the other order would have made the
 * agent contradict `/p/<id>` for exactly the rows that carry both.
 */
export function positionSummary(
	position: Domain.Position,
	prices: LivePriceBook,
	asOf: Date,
): PositionSummary {
	const instrument = position.instrument ?? null;
	const { spotUsd8, derivation } = rowDerivation(position, prices);
	const derived = derivation.inputs === null ? null : derivedRisk(derivation.inputs);
	const derivedPnlUsd =
		derivation.inputs === null || spotUsd8 === null ? null : derivePnlAtSpot(derivation.inputs, spotUsd8);
	const expiryAt = instrument?.expiryAt ?? position.expiryAt ?? null;
	const economics = position.economics;

	// The SAME resolver `display.position` and `positionPage` call, with the SAME
	// arguments: a settled row shows its recorded result and never the derived
	// estimate, and an expired one shows neither (PRD 14).
	const pnl = resolvePnl({
		status: position.status,
		failureReason: position.failureReason,
		finalPnlUsd: economics.finalPnlUsd,
		estimatedPnlUsd: economics.estimatedPnlUsd,
		settlementPriceUsd: economics.settlementPriceUsd,
		derivable: derivation.inputs !== null,
		derivedPnlUsd,
		spotUsd8,
		unavailableReason: derivation.inputs === null ? derivation.reason : COPY.unpricedPremium,
		expiryAt,
		asOf: asOf.toISOString(),
	});

	const strikesUsd = instrument === null ? null : strikesUsdOf(instrument.strikesUsd8);
	const quantities = position.quantities ?? null;
	return {
		positionId: position.id,
		path: `/p/${position.id}`,
		asset: instrument?.asset ?? (position.underlyingAsset === "" ? null : position.underlyingAsset),
		label: [
			instrument?.asset ?? position.underlyingAsset,
			strikesUsd?.join("/"),
			instrument === null ? null : instrument.isCall ? "call" : "put",
		]
			.filter((part): part is string => typeof part === "string" && part !== "")
			.join(" "),
		side: instrument?.takerSide ?? null,
		direction:
			instrument === null ? null : instrument.isCall === (instrument.takerSide === "buy") ? "bull" : "bear",
		optionType: instrument === null ? null : instrument.isCall ? "call" : "put",
		strikesUsd,
		status: lifecycleStatus(position.status, expiryAt, asOf.toISOString()),
		expiryAt,
		premium:
			quantities === null
				? null
				: {
						amount: decimalFromBaseUnits(quantities.premium, quantities.premiumDecimals),
						token: instrument?.collateralSymbol ?? null,
					},
		maxLossUsd: decimalOrNull(economics.maximumLossUsd) ?? derived?.maxLossUsd ?? null,
		maxPayoutUsd: decimalOrNull(economics.maximumPayoutUsd) ?? derived?.maxPayoutUsd ?? null,
		breakEvenUsd: decimalOrNull(economics.breakEvenPricesUsd[0] ?? null) ?? derived?.breakEvenUsd ?? null,
		derivedPnlUsd,
		pnlUsd: pnl.pnlUsd,
		basis: pnl.basis,
		note: pnl.detail,
	};
}

/**
 * The risk-model inputs for a HYPOTHETICAL fill — an order on the book plus a
 * budget — rather than for a position that already exists.
 *
 * Pure, and separate from the tool, so the arithmetic can be measured without a
 * network or a database. Every refusal names the piece that is missing, and
 * every one of them is a gate that exists elsewhere in this repo already:
 *
 *  - an unproven contract-size unit (`buyContractSizeDecimals`, orders.ts),
 *  - a collateral token with no citable USD price (`collateralUsdPrice`),
 *  - a structure `packages/thetanuts/src/risk.ts` models no payoff for
 *    (`riskKindFor`, lib/market/structures.ts).
 *
 * The strikes are sorted ASCENDING here for the same reason
 * `lib/position/instrument.ts` and `lib/market/quote.ts` sort theirs: `risk.ts`
 * `checked()` throws on `strikes[0] >= strikes[1]`, and the book publishes a
 * spread's legs in its own order, which is not always ascending.
 */
export function fillDerivationInputs(input: {
	readonly takerSide: "buy" | "sell";
	readonly implementationName: string | null;
	/** Strikes exactly as the feed published them: 8-decimal integers, feed order. */
	readonly feedStrikesUsd8: readonly (string | number)[];
	readonly collateralSymbol: string | null;
	readonly raw: {
		readonly numContracts: string;
		readonly premium: string;
		readonly feeEstimate: string;
		readonly collateralDecimals: number;
		readonly contractSizeDecimals: number | null;
	};
}): { inputs: DerivationInputs; reason?: undefined } | { inputs: null; reason: string } {
	const { raw } = input;
	if (raw.contractSizeDecimals === null) return { inputs: null, reason: CONTRACT_UNITS_UNVERIFIED };

	const peg = collateralUsdPrice(input.collateralSymbol);
	const collateralUsdPrice8 = peg === null ? null : usd8FromSpotNumber(peg);
	if (collateralUsdPrice8 === null) return { inputs: null, reason: COLLATERAL_USD_UNAVAILABLE };

	const riskKind = riskKindFor(input.implementationName, input.feedStrikesUsd8.length);
	if (riskKind === null) return { inputs: null, reason: COPY.noRiskModel };

	return {
		inputs: {
			riskKind,
			takerSide: input.takerSide,
			ascendingStrikesUsd8: ascendingStrikes(input.feedStrikesUsd8.map((strike) => BigInt(strike))).map(
				(strike) => strike.toString(),
			),
			contracts: raw.numContracts,
			contractDecimals: raw.contractSizeDecimals,
			premiumBaseUnits: raw.premium,
			premiumDecimals: raw.collateralDecimals,
			feeBaseUnits: raw.feeEstimate,
			feeDecimals: raw.collateralDecimals,
			collateralUsdPrice8,
		},
	};
}

/** `fillDerivationInputs`, fed from a live order and the sizing the package produced for it. */
function orderDerivationInputs(
	order: TradeableOrder,
	raw: NonNullable<ReturnType<typeof sizeFill>["raw"]>,
): ReturnType<typeof fillDerivationInputs> {
	return fillDerivationInputs({
		takerSide: order.side,
		implementationName: order.productType,
		feedStrikesUsd8: order.entry.order.strikes,
		collateralSymbol: order.collateralToken.symbol,
		raw,
	});
}

/** One option the Thetanuts indexer says a custom request minted for this wallet. */
export interface RfqOptionSummary {
	readonly optionAddress: string;
	readonly quotationId: string;
	readonly strikesUsd: string[];
	readonly expiryAt: string;
	/** The indexer's own numeric option type, unmapped: nothing here proves what each value means. */
	readonly optionType: number;
	readonly collateralAddress: string;
	/** Always "indexer": no fill of this option was ever recorded by this app. */
	readonly basis: "indexer";
	readonly note: string;
}

/**
 * `client.api.getUserOptionsFromRfq`, mapped and bounded.
 *
 * A read failure is reported as a failure, never as an empty list: "you have
 * none" and "we could not look" are different answers and only one of them is
 * ever true.
 */
export async function rfqOptionsFor(
	walletAddress: string,
	client: { api: { getUserOptionsFromRfq(address: string): Promise<readonly RawRfqOption[]> } } = rfqClientFor(
		walletAddress.toLowerCase(),
	),
): Promise<{ options: RfqOptionSummary[] | null; note: string | null }> {
	let raw: readonly RawRfqOption[];
	try {
		raw = await client.api.getUserOptionsFromRfq(walletAddress);
	} catch {
		return { options: null, note: COPY.rfqUnreadable };
	}
	if (raw.length === 0) return { options: [], note: null };
	return {
		options: raw.slice(0, MAX_ROWS).map((option) => ({
			optionAddress: option.address,
			quotationId: option.quotationId,
			strikesUsd: strikesUsdOf(option.strikes),
			expiryAt: new Date(option.expiry * 1000).toISOString(),
			optionType: option.optionType,
			collateralAddress: option.collateral,
			basis: "indexer" as const,
			note: COPY.rfqBasis,
		})),
		note: COPY.rfqBasis,
	};
}

/** The indexer fields this file reads (`StateOption`). Structural, so a test can supply rows. */
export interface RawRfqOption {
	readonly address: string;
	readonly quotationId: string;
	readonly collateral: string;
	readonly strikes: readonly string[];
	readonly expiry: number;
	readonly optionType: number;
}

export interface PositionToolsParams {
	/**
	 * The signed-in session, read server-side from the cookie — never from the
	 * request body and never from the model. The wallet in it is the ONLY wallet
	 * these tools ever read.
	 */
	readonly session: { userId: string; walletAddress: string } | null;
}

export function createPositionTools({ session }: PositionToolsParams) {
	const getUserPositions = tool({
		description:
			"The signed-in user's own option positions on Base: what they hold, what it is worth right now, " +
			"the most they can lose, the most it can pay and the break-even price. Use this for ANY question about " +
			"'my positions', 'my portfolio', 'my P&L', 'am I up', 'what am I risking' or 'what do I own'. " +
			"Never answer such a question from the conversation; the figures come from here. " +
			"A `signedIn: false` result means nobody is connected — ask them to connect their wallet. " +
			"Every money field is a decimal string or null, and a null always arrives with the sentence saying why.",
		inputSchema: z.object({
			limit: z
				.number()
				.int()
				.min(1)
				.max(MAX_ROWS)
				.default(MAX_ROWS)
				.describe("How many of the newest positions to return."),
		}),
		execute: async ({ limit }) => {
			const asOf = new Date();
			if (session === null) return { signedIn: false as const, note: COPY.signedOut };

			// Imported here rather than at the top: `lib/data/reads.ts` creates the
			// database client at import time, and this module is also loaded by
			// offline tests and by the route in mock mode.
			const { getPortfolio } = await import("@/lib/data/reads");
			// `getPortfolio` already applies the single fill-status rule (filled
			// statuses only) and orders newest first.
			const rows = await getPortfolio(session.walletAddress, { limit });
			const keys = rowPriceKeys(rows);
			// ONE price book for the whole answer, the same shape `lib/page-data.ts`
			// resolves for a page: two rows on the same asset cannot be valued at two
			// different spots.
			const prices = await livePriceBook(keys.assets, keys.collateralSymbols);
			const positions = rows.map((row) => positionSummary(row, prices, asOf));

			const maxLosses = positions
				.map((row) => row.maxLossUsd)
				.filter((value): value is string => value !== null);
			const soonest = asOf.getTime() + EXPIRY_SOON_DAYS * 86_400_000;

			// Options this wallet owns because a CUSTOM REQUEST settled into one.
			// Appended rather than merged: they carry no fill, no economics and no
			// P&L, and presenting them alongside recorded positions as if they did
			// would be exactly the substitution PRD 8.4 forbids.
			const rfq = await rfqOptionsFor(session.walletAddress);

			return {
				signedIn: true as const,
				asOf: asOf.toISOString(),
				// Set when the order feed could not be read at all. Their P&L is then
				// null for a reason that is nothing to do with the positions.
				feedError: prices.feedError,
				positions,
				rfqOptions: rfq.options,
				rfqOptionsNote: rfq.note,
				totals: {
					count: positions.length,
					/**
					 * Exact base-10 sum of the max losses that HAVE a figure, and a
					 * count of the ones that do not — a sum over a subset presented as
					 * a total would understate what is at risk.
					 */
					maxLossUsd: maxLosses.length === 0 ? null : sumDecimals(maxLosses),
					maxLossUnavailableFor: positions.length - maxLosses.length,
					expiringWithinDays: {
						days: EXPIRY_SOON_DAYS,
						count: positions.filter((row) => {
							if (row.expiryAt === null) return false;
							const expiry = Date.parse(row.expiryAt);
							return !Number.isNaN(expiry) && expiry > asOf.getTime() && expiry <= soonest;
						}).length,
					},
				},
			};
		},
	});

	const whatIfAtExpiry = tool({
		description:
			"What a position, or a trade the user is considering, would be worth if the underlying settled at a " +
			"given price. Use this for every 'what if ETH is at X', 'what happens at expiry', 'when do I break even' " +
			"question, and repeat the returned note: the figure is the payoff AT EXPIRY and carries no time value. " +
			"Give EITHER a positionId the user already holds, OR an instrumentKey from searchOptionBookOrders " +
			"together with the budget they would spend — never both. Never compute this yourself.",
		inputSchema: z.object({
			settlementPriceUsd: z
				.string()
				.regex(/^\d+(\.\d+)?$/)
				.describe("The settlement price of the UNDERLYING asset, in US dollars, as a decimal string."),
			positionId: z
				.string()
				.optional()
				.describe("A positionId from getUserPositions. The position must be one the signed-in user holds."),
			instrumentKey: z
				.string()
				.optional()
				.describe("The instrumentKey field from a searchOptionBookOrders result, for a trade not yet made."),
			budget: z
				.string()
				.regex(/^\d+(\.\d+)?$/)
				.optional()
				.describe("With instrumentKey: the decimal collateral-token amount the user would spend."),
		}),
		execute: async ({ settlementPriceUsd, positionId, instrumentKey, budget }) => {
			const settlementUsd8 = usd8FromDecimal(settlementPriceUsd);
			if (settlementUsd8 === null || BigInt(settlementUsd8) <= 0n) {
				return { found: false as const, reason: COPY.badSettlementPrice };
			}
			// Exactly one subject. Both is ambiguous and neither is unanswerable; in
			// both cases the honest move is to ask, not to pick one.
			if ((positionId === undefined) === (instrumentKey === undefined)) {
				return { found: false as const, reason: COPY.needOneSubject };
			}

			if (positionId !== undefined) {
				if (session === null) return { found: false as const, signedIn: false as const, note: COPY.signedOut };
				const { getPosition } = await import("@/lib/data/reads");
				const detail = await getPosition(positionId);
				/**
				 * ONE answer for "no such position" and for "that position is not
				 * yours". The wallet is the closure's, so this is the fence that keeps
				 * the tool from valuing a stranger's fill; the two cases are given the
				 * same sentence because the difference between them is not the user's
				 * business and is not needed to act.
				 */
				if (
					detail === null ||
					detail.position.walletAddress.toLowerCase() !== session.walletAddress.toLowerCase()
				) {
					return { found: false as const, reason: COPY.noSuchPosition };
				}
				const position = detail.position;
				const keys = rowPriceKeys([position]);
				// Only the COLLATERAL price is used below: the settlement price is the
				// user's, not the book's. The asset is still resolved so an unreadable
				// feed is reported the same way everywhere else reports it.
				const prices = await livePriceBook(keys.assets, keys.collateralSymbols);
				const { derivation } = rowDerivation(position, prices);
				if (derivation.inputs === null) {
					return { found: false as const, positionId: position.id, reason: derivation.reason };
				}
				const pnlUsd = derivePnlAtSpot(derivation.inputs, settlementUsd8);
				const risk = derivedRisk(derivation.inputs);
				return {
					found: true as const,
					subject: "position" as const,
					positionId: position.id,
					path: `/p/${position.id}`,
					settlementPriceUsd,
					pnlUsd,
					basis: "at_expiry" as const,
					maxLossUsd: risk?.maxLossUsd ?? null,
					maxPayoutUsd: risk?.maxPayoutUsd ?? null,
					breakEvenUsd: risk?.breakEvenUsd ?? null,
					note: pnlUsd === null ? COPY.unpricedPremium : COPY.settlementBasis,
				};
			}

			if (budget === undefined) return { found: false as const, reason: COPY.needBudget };

			// Cached snapshot, up to the adapter's TTL. Nothing here is signed or
			// prepared, so a cached signature is not a hazard: `asOf` is returned and
			// `requestOptionBookExecution` re-reads the book for itself.
			const snapshot = await getOrderSnapshot();
			if (isFeedUnavailable(snapshot)) return snapshot;
			const asOf = snapshot.fetchedAt.toISOString();
			const order = findByInstrumentKey(snapshot.orders, instrumentKey as string);
			if (order === undefined) return { found: false as const, asOf, reason: COPY.instrumentGone };

			const fill = sizeFill(order, budget);
			if (!fill.executable) return { found: false as const, asOf, reason: fill.reason };
			const built = orderDerivationInputs(order, fill.raw);
			if (built.inputs === null) return { found: false as const, asOf, reason: built.reason };

			const pnlUsd = derivePnlAtSpot(built.inputs, settlementUsd8);
			const risk = derivedRisk(built.inputs);
			return {
				found: true as const,
				subject: "instrument" as const,
				asOf,
				instrumentKey,
				budget: { amount: budget, token: order.collateralToken.symbol },
				side: order.side,
				settlementPriceUsd,
				pnlUsd,
				basis: "at_expiry" as const,
				maxLossUsd: risk?.maxLossUsd ?? null,
				maxPayoutUsd: risk?.maxPayoutUsd ?? null,
				breakEvenUsd: risk?.breakEvenUsd ?? null,
				note: pnlUsd === null ? COPY.unpricedPremium : COPY.settlementBasis,
			};
		},
	});

	return { getUserPositions, whatIfAtExpiry };
}
