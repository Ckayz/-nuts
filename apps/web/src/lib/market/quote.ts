/**
 * One quote for one structure, on one taker side, at one budget.
 *
 * Everything here is integer arithmetic on the book's own base units. Each
 * money field carries the formula that produced it, so every printed number is
 * reproducible from raw units:
 *
 *   premiumGross      = numContracts * pricePerContract / 1e8          (floor)
 *   feeEstimate       = premiumGross * 1250 / 10000                    (estimate)
 *   collateralPosted  = SDK utils.calculateCollateral(...)             (sell only)
 *   debit             = premiumGross (buy) | collateralPosted (sell)
 *   credit            = 0 (buy)          | premiumGross - feeEstimate (sell)
 *   premiumUsd8       = premium * collateralUsdPrice8 / 10**collateralDecimals
 *   maxLoss/maxPayout/breakEven — @nuts/thetanuts risk helpers, USD 8dp
 *
 * VERIFIED against decoded Base production fills (.research/thetanuts/
 * finding-fill-debits.md): a taker BUY debits exactly the premium, with the
 * protocol fee carved out of what the MAKER receives; a taker SELL debits the
 * structure collateral and credits premium minus fee.
 *
 * UNVERIFIED and therefore refused rather than guessed: contract-size units for
 * any collateral that is not 6 decimals (buy side), every (implementation,
 * collateral) pair outside `VERIFIED_SELL_PAIRS` (sell side, gated inside the
 * package), and the fee's notional branch. Nothing here relaxes a package gate.
 */
import {
	breakEven as breakEvenOf,
	maxLoss as maxLossOf,
	maxPayout as maxPayoutOf,
	premiumUsd8From,
	quoteFill,
	quoteSellFill,
	ThetanutsLogicError,
	type Market,
	type RiskKind,
	type RiskParams,
	type SellQuoteClient,
} from "@nuts/thetanuts";
// `ThetanutsClient` is the SDK's own type; `@nuts/thetanuts` uses it but does
// not re-export it (packages/thetanuts/src/client.ts).
import type { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import {
	buyContractSizeDecimals,
	collateralUsdPrice,
	COLLATERAL_USD_UNAVAILABLE,
	CONTRACT_UNITS_UNVERIFIED,
} from "@/lib/thetanuts/orders";
import { ascendingStrikes, riskKindFor } from "./structures";
import { takerSideDisagreement, takerSideOf, TAKER_SIDE_CONTRADICTION } from "./taker-side";

export type TakerSide = "buy" | "sell";

export interface QuoteRefusal {
	readonly ok: false;
	/** Stable machine code; `ThetanutsLogicError.code` when the package refused. */
	readonly code: string;
	/** One sentence for the UI. Never claims the book is empty when it is not. */
	readonly reason: string;
}

export interface StructureQuote {
	readonly ok: true;
	readonly side: TakerSide;
	readonly numContracts: bigint;
	readonly maxContracts: bigint;
	readonly contractSizeDecimals: number;
	readonly collateralDecimals: number;
	readonly collateralSymbol: string;
	readonly collateralAddress: string;
	readonly pricePerContract: bigint;
	readonly premiumGross: bigint;
	readonly feeEstimate: bigint;
	readonly collateralPosted: bigint;
	/** Collateral base units that leave the taker's wallet for this fill. */
	readonly debit: bigint;
	/** Collateral base units the taker receives; zero on the buy side. */
	readonly credit: bigint;
	/** The maker's remaining collateral for this order, in collateral base units. */
	readonly makerLiquidity: bigint;
	readonly capped: boolean;
	readonly budget: bigint;
	/** Null when the collateral token has no USD source this code can justify. */
	readonly premiumUsd8: bigint | null;
	readonly maxLossUsd8: bigint | null;
	readonly maxPayoutUsd8: bigint | null;
	readonly breakEvenUsd8: bigint | null;
	readonly riskKind: RiskKind | null;
	readonly strikes: readonly bigint[];
	readonly expiry: bigint;
	/** Unix seconds after which the maker's signature is no longer valid. */
	readonly orderExpiry: bigint;
}

export type QuoteResult = StructureQuote | QuoteRefusal;

function refuse(code: string, reason: string): QuoteRefusal {
	return { ok: false, code, reason };
}

/** Domain-specific wording for the package's own refusal codes; the code is always carried through. */
function fromLogicError(error: unknown): QuoteRefusal {
	if (error instanceof ThetanutsLogicError) return refuse(error.code, error.message);
	return refuse("QUOTE_FAILED", error instanceof Error ? error.message : "Quote unavailable");
}

export interface RiskOutputs {
	readonly premiumUsd8: bigint | null;
	readonly maxLossUsd8: bigint | null;
	readonly maxPayoutUsd8: bigint | null;
	readonly breakEvenUsd8: bigint | null;
}

const RISK_UNAVAILABLE: RiskOutputs = { premiumUsd8: null, maxLossUsd8: null, maxPayoutUsd8: null, breakEvenUsd8: null };

/**
 * Converts a collateral-token premium to USD and runs the payoff helpers.
 *
 * A structure with no payoff model (rangers, flies, condors, physical calls)
 * returns nulls rather than an invented number, and so does a premium the
 * helpers reject as exceeding the bounded payoff.
 *
 * EXPORTED so the agent's `previewOptionBookTrade` runs this exact function
 * (`lib/agent/tools.ts`). The agent and the market ticket quoting one structure
 * at one budget must not be able to print different max payouts, and the only
 * way to guarantee that is one implementation, pinned by an equality test
 * (`lib/agent/preview-risk.test.ts`). Its behaviour is unchanged by the export.
 */
export function riskOutputs(input: {
	riskKind: RiskKind | null;
	positionSide: "long" | "short";
	strikes: readonly bigint[];
	numContracts: bigint;
	premiumBaseUnits: bigint;
	collateralDecimals: number;
	collateralUsdPrice8: bigint | null;
	contractSizeDecimals: number;
}): RiskOutputs {
	if (input.collateralUsdPrice8 === null) return RISK_UNAVAILABLE;
	const premiumUsd8 = premiumUsd8From({
		premiumBaseUnits: input.premiumBaseUnits,
		collateralDecimals: input.collateralDecimals,
		collateralUsdPrice8: input.collateralUsdPrice8,
	});
	if (input.riskKind === null) {
		return { premiumUsd8, maxLossUsd8: null, maxPayoutUsd8: null, breakEvenUsd8: null };
	}
	const params: RiskParams = {
		kind: input.riskKind,
		positionSide: input.positionSide,
		strikes: ascendingStrikes(input.strikes),
		numContracts: input.numContracts,
		premiumUsd8,
		contractSizeDecimals: input.contractSizeDecimals,
	};
	try {
		return {
			premiumUsd8,
			maxLossUsd8: maxLossOf(params),
			maxPayoutUsd8: maxPayoutOf(params),
			breakEvenUsd8: breakEvenOf(params),
		};
	} catch {
		// INVALID_RISK_PARAMS: the helpers refuse a premium above the bounded
		// payoff, and a short vanilla call has no USD payoff model at all.
		return { premiumUsd8, maxLossUsd8: null, maxPayoutUsd8: null, breakEvenUsd8: null };
	}
}

export interface QuoteStructureParams {
	readonly client: ThetanutsClient;
	readonly market: Market;
	readonly side: TakerSide;
	/** Collateral base units: the premium to spend (buy) or the collateral to post (sell). */
	readonly budget: bigint;
	readonly referrer: string;
	readonly now?: number;
}

/**
 * Quotes one side of one structure, or refuses with a reason the UI shows.
 *
 * The order handed in must be the taker side being quoted: `takerSide(order)`
 * is checked by the package, and `getLiveMarkets` keeps the two sides apart.
 */
export function quoteStructure({ client, market, side, budget, referrer, now }: QuoteStructureParams): QuoteResult {
	const raw = market.order.rawApiData;
	if (!raw) return refuse("INVALID_ORDER", "This order is missing the fields needed to quote it.");
	if (budget <= 0n) return refuse("ZERO_BUDGET", "Enter an amount above zero.");
	const collateralDecimals = market.collateralToken.decimals;
	const collateralSymbol = market.collateralToken.symbol;
	if (collateralDecimals === null || collateralSymbol === null) {
		return refuse("COLLATERAL_UNKNOWN", "This order's collateral token is not in the SDK's token map, so it cannot be sized.");
	}
	const usdPrice = collateralUsdPrice(collateralSymbol);
	const collateralUsdPrice8 = usdPrice === null ? null : BigInt(usdPrice) * 100_000_000n;
	if (collateralUsdPrice8 === null) {
		return refuse("COLLATERAL_USD_UNAVAILABLE", `${COLLATERAL_USD_UNAVAILABLE} Collateral ${collateralSymbol} has no USD source.`);
	}
	// Fail closed on the taker-side contradiction before anything is sized: see
	// `./taker-side.ts`. Building on the wrong side approves a premium and then
	// posts collateral, or the reverse.
	const disagreement = takerSideDisagreement(market.order);
	if (disagreement !== null) return refuse(TAKER_SIDE_CONTRADICTION, disagreement);
	if (takerSideOf(market.order) !== side) {
		return refuse(
			"WRONG_SIDE_ORDER",
			`This order's taker side is ${takerSideOf(market.order)}, not ${side}.`,
		);
	}
	const riskKind = riskKindFor(market.implementation.info?.name ?? null, market.strikes.length);

	if (side === "buy") {
		const contractSizeDecimals = buyContractSizeDecimals(collateralDecimals);
		if (contractSizeDecimals === null) {
			return refuse("CONTRACT_UNITS_UNVERIFIED", `${CONTRACT_UNITS_UNVERIFIED} (${collateralSymbol}, ${collateralDecimals} decimals).`);
		}
		let quote;
		try {
			quote = quoteFill({ client, order: market.order, budget, referrer, now });
		} catch (error) {
			return fromLogicError(error);
		}
		const risk = riskOutputs({
			riskKind,
			positionSide: "long",
			strikes: market.strikes,
			numContracts: quote.numContracts,
			premiumBaseUnits: quote.premium,
			collateralDecimals,
			collateralUsdPrice8,
			contractSizeDecimals,
		});
		return {
			ok: true,
			side,
			numContracts: quote.numContracts,
			maxContracts: quote.maxContracts,
			contractSizeDecimals,
			collateralDecimals,
			collateralSymbol,
			collateralAddress: market.collateralToken.address,
			pricePerContract: quote.pricePerContract,
			premiumGross: quote.premium,
			// The buyer's debit IS the premium; the fee is carved out of what the
			// maker receives (decoded fill 0x9c4bb1…: taker paid 999998 = premium,
			// of which 124999 went to the OptionBook as the fee).
			feeEstimate: (quote.premium * 1250n) / 10000n,
			collateralPosted: 0n,
			debit: quote.premium,
			credit: 0n,
			makerLiquidity: market.availableAmount,
			capped: quote.capped,
			budget,
			...risk,
			riskKind,
			strikes: market.strikes,
			expiry: market.expiry,
			orderExpiry: BigInt(raw.orderExpiryTimestamp),
		};
	}

	let quote;
	try {
		quote = quoteSellFill({
			client: client as SellQuoteClient,
			order: market.order,
			collateralBudget: budget,
			referrer,
			now,
		});
	} catch (error) {
		return fromLogicError(error);
	}
	const risk = riskOutputs({
		riskKind,
		positionSide: "short",
		strikes: market.strikes,
		numContracts: quote.numContracts,
		// The seller's economics use the premium they actually keep.
		premiumBaseUnits: quote.premiumNet,
		collateralDecimals: quote.collateralDecimals,
		collateralUsdPrice8,
		contractSizeDecimals: quote.contractSizeDecimals,
	});
	return {
		ok: true,
		side,
		numContracts: quote.numContracts,
		maxContracts: quote.maxContracts,
		contractSizeDecimals: quote.contractSizeDecimals,
		collateralDecimals: quote.collateralDecimals,
		collateralSymbol,
		collateralAddress: market.collateralToken.address,
		pricePerContract: quote.pricePerContract,
		premiumGross: quote.premiumGross,
		feeEstimate: quote.feeEstimate,
		collateralPosted: quote.collateralRequired,
		debit: quote.collateralRequired,
		credit: quote.premiumNet,
		makerLiquidity: market.availableAmount,
		capped: quote.capped,
		budget,
		...risk,
		riskKind,
		strikes: market.strikes,
		expiry: market.expiry,
		orderExpiry: BigInt(raw.orderExpiryTimestamp),
	};
}
