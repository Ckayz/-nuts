/**
 * Where a position's P&L number comes from, and what it is allowed to say.
 *
 * Pure: no database, no network, no clock. Everything it returns is either a
 * value recorded by somebody else (the settled result, the indexer's estimate)
 * or a value this file computed from raw base units with `@nuts/thetanuts`'s
 * risk model — never an interpolation, never a fallback constant.
 *
 * The RULES about what a number may SAY live in `./lifecycle`, which imports no
 * SDK and is therefore safe in a client bundle; this module owns the model and
 * re-exports them.
 *
 * The rules it enforces come from the PRD, not from taste:
 *  - PRD 14: "Never label an estimate as settled P&L." A settled row shows only
 *    the recorded final P&L; the estimate is never promoted into its place.
 *  - PRD 13 / 8.5.3: "Expired but unsettled: show settlement pending; do not
 *    invent final P&L."
 *  - PRD 13: "Confirmed but not indexed: show syncing."
 *  - PRD 13: "Missing AI context: explicitly identify unavailable values." Every
 *    `unavailable` carries the reason it is unavailable.
 *
 * TODO-OWNER: the wording of `detail` on each branch is descriptive, not
 * approved product copy. The mockup has no standalone position page, so it
 * specifies none.
 */
import {
	breakEven,
	maxLoss,
	maxPayout,
	payoffAtExpiry,
	premiumUsd8From,
	type RiskKind,
} from "@nuts/thetanuts";
import { decimalFromBaseUnits } from "@/lib/data/decimal";

/** USD prices and payoffs are carried at 8 decimals, the scale `risk.ts` uses (`PRICE_SCALE`). */
export const USD_DECIMALS = 8;

/**
 * Re-exported so nothing that imported these from `pnl.ts` has to move. They
 * live in `./lifecycle`, which imports no SDK: see that file's header for the
 * client-bundle failure that forced the split.
 */
export {
	failedButOnChain,
	FILL_ON_CHAIN_UNPROVEN,
	isPastExpiry,
	lifecycleStatus,
	resolvePnl,
	type PnlBasis,
	type PnlInputs,
	type PnlResolution,
} from "./lifecycle";

/** Everything the risk model needs, in raw units, with the unit named on each field. */
export interface DerivationInputs {
	readonly riskKind: RiskKind;
	/** "buy" is long the structure, "sell" is short it and posts collateral. */
	readonly takerSide: "buy" | "sell";
	/** Strikes ASCENDING, 8-decimal USD base-unit integer strings. */
	readonly ascendingStrikesUsd8: readonly string[];
	/** Contracts in option contract base units, integer string. */
	readonly contracts: string;
	/** Decimals used by `contracts`, from the row that recorded the fill. */
	readonly contractDecimals: number;
	/** Premium in collateral-token base units, integer string. */
	readonly premiumBaseUnits: string;
	readonly premiumDecimals: number;
	/** Protocol fee in collateral-token base units, integer string. */
	readonly feeBaseUnits: string;
	readonly feeDecimals: number;
	/** USD price of ONE collateral token, 8-decimal integer string (1 USD = "100000000"). */
	readonly collateralUsdPrice8: string;
}

/** Decimal string -> 8-decimal integer string. Digits past the eighth are dropped, never rounded up. */
export function usd8FromDecimal(value: string): string | null {
	if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
	const negative = value.startsWith("-");
	const [integer = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
	const scaled = `${integer}${fraction.slice(0, USD_DECIMALS).padEnd(USD_DECIMALS, "0")}`;
	return `${negative ? "-" : ""}${BigInt(scaled).toString()}`;
}

/**
 * The spot price arrives from the SDK's `getMarketData()` as an IEEE-754 double
 * (`OrderSnapshot.marketData` is `Record<string, number>`), so eight decimals is
 * already more precision than the source carries. `toFixed(8)` is the exact
 * decimal expansion of that double truncated to the scale the risk model uses.
 */
export function usd8FromSpotNumber(price: number): string | null {
	if (!Number.isFinite(price) || price <= 0) return null;
	return usd8FromDecimal(price.toFixed(USD_DECIMALS));
}

/** 8-decimal integer string -> decimal USD string. */
export function decimalFromUsd8(value: bigint): string {
	return decimalFromBaseUnits(value.toString(), USD_DECIMALS);
}

/**
 * The taker's own premium, in 8-decimal USD.
 *
 * A taker who BUYS pays the gross premium: the protocol fee is carved out of
 * what the maker receives, not added to the buyer's debit
 * (`.research/thetanuts/finding-fill-debits.md`, decoded production fills
 * 2026-09-05). A taker who SELLS receives premium minus that fee, which is what
 * `risk.ts`'s `maxLoss` doc asks for ("pass its NET premium converted to USD8").
 */
function netPremiumUsd8(inputs: DerivationInputs): bigint {
	const price = BigInt(inputs.collateralUsdPrice8);
	const gross = premiumUsd8From({
		premiumBaseUnits: BigInt(inputs.premiumBaseUnits),
		collateralDecimals: inputs.premiumDecimals,
		collateralUsdPrice8: price,
	});
	if (inputs.takerSide === "buy") return gross;
	const fee = premiumUsd8From({
		premiumBaseUnits: BigInt(inputs.feeBaseUnits),
		collateralDecimals: inputs.feeDecimals,
		collateralUsdPrice8: price,
	});
	return gross - fee;
}

interface RiskParamsShape {
	readonly kind: RiskKind;
	readonly positionSide: "long" | "short";
	readonly strikes: readonly bigint[];
	readonly numContracts: bigint;
	readonly premiumUsd8: bigint;
	readonly contractSizeDecimals: number;
}

/** Null when any raw field is not the integer string its column promises. */
function riskParams(inputs: DerivationInputs): RiskParamsShape | null {
	if (!/^\d+$/.test(inputs.contracts)) return null;
	if (!/^\d+$/.test(inputs.premiumBaseUnits) || !/^\d+$/.test(inputs.feeBaseUnits)) return null;
	if (!/^\d+$/.test(inputs.collateralUsdPrice8)) return null;
	if (inputs.ascendingStrikesUsd8.some((strike) => !/^\d+$/.test(strike))) return null;
	const premiumUsd8 = netPremiumUsd8(inputs);
	// A fee larger than the premium received means the stored figures disagree,
	// and a disagreement is not a number. Defence in depth, not the only fence:
	// `risk.ts`'s own `checked()` throws on a negative premium and the callers
	// catch it, which is what a mutation of this line proves — removing it leaves
	// the suite green. It stays because refusing here names the reason at the
	// boundary that owns these units, instead of relying on a throw from another
	// package to mean the same thing.
	if (premiumUsd8 < 0n) return null;
	return {
		kind: inputs.riskKind,
		positionSide: inputs.takerSide === "buy" ? "long" : "short",
		strikes: inputs.ascendingStrikesUsd8.map((strike) => BigInt(strike)),
		numContracts: BigInt(inputs.contracts),
		premiumUsd8,
		contractSizeDecimals: inputs.contractDecimals,
	};
}

export interface DerivedRisk {
	/** Net maximum loss in decimal USD; null where `risk.ts` models none (short vanilla call). */
	readonly maxLossUsd: string | null;
	/** Net maximum payout in decimal USD; null for an uncapped long vanilla call. */
	readonly maxPayoutUsd: string | null;
	readonly breakEvenUsd: string | null;
}

/**
 * Max loss, max payout and break-even from the risk model. Every `risk.ts` entry
 * point validates its own parameters and throws `ThetanutsLogicError` when they
 * do not hold; a throw is reported as "no value", never swallowed into a zero.
 */
export function derivedRisk(inputs: DerivationInputs): DerivedRisk | null {
	const params = riskParams(inputs);
	if (params === null) return null;
	try {
		const loss = maxLoss(params);
		const payout = maxPayout(params);
		return {
			maxLossUsd: loss === null ? null : decimalFromUsd8(loss),
			maxPayoutUsd: payout === null ? null : decimalFromUsd8(payout),
			breakEvenUsd: decimalFromUsd8(breakEven(params)),
		};
	} catch {
		return null;
	}
}

/**
 * P&L if this option settled at `spotUsd8` right now.
 *
 * That is what `payoffAtExpiry` computes, and it is NOT a mark-to-market value:
 * it ignores every scrap of time value still in the option. The caller must say
 * so where it is rendered, which is why `resolvePnl` returns the sentence with
 * the number rather than the number alone.
 */
export function derivePnlAtSpot(inputs: DerivationInputs, spotUsd8: string): string | null {
	if (!/^\d+$/.test(spotUsd8)) return null;
	const params = riskParams(inputs);
	if (params === null) return null;
	try {
		return decimalFromUsd8(payoffAtExpiry(params, BigInt(spotUsd8)));
	} catch {
		return null;
	}
}
