/**
 * Base-unit <-> decimal-string conversions for token and price amounts.
 *
 * Pure and dependency-free on purpose: every money number the market page and
 * the ticket print is produced here from raw integer base units, so a reader can
 * reproduce it with the formula in the doc comment. Nothing here uses `Number`.
 *
 * `src/lib/thetanuts/orders.ts` has a `decimalString` of its own. It is not
 * reused because that module is `server-only` and these helpers must be
 * importable from a unit test and from pure code; the two are tested to agree.
 */

/** Formats integer base units as a decimal string: `value / 10**decimals`. */
export function formatBaseUnits(value: bigint, decimals: number): string {
	if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error(`Invalid decimals: ${decimals}`);
	}
	const negative = value < 0n;
	const absolute = negative ? -value : value;
	const scale = 10n ** BigInt(decimals);
	const whole = absolute / scale;
	if (decimals === 0) return `${negative ? "-" : ""}${whole}`;
	const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
	return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/**
 * Parses a non-negative decimal amount into integer base units.
 *
 * Rejects, rather than rounds, an input with more precision than the token
 * carries: silently truncating a user's budget would spend a different amount
 * than the one they typed.
 */
export function parseTokenAmount(input: string, decimals: number): bigint {
	if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
		throw new Error(`Invalid decimals: ${decimals}`);
	}
	const trimmed = input.trim().replace(/,/g, "");
	if (!/^\d+(\.\d+)?$/.test(trimmed)) {
		throw new Error("Amount must be a positive decimal number");
	}
	const [whole = "0", fraction = ""] = trimmed.split(".");
	if (fraction.length > decimals) {
		throw new Error(`Amount has more than ${decimals} decimal places`);
	}
	return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** 8-decimal USD price units, the unit every risk helper in `@nuts/thetanuts` returns. */
export const USD_PRICE_DECIMALS = 8;

/** Formats an 8-decimal USD value produced by the risk helpers. */
export function formatUsd8(value: bigint): string {
	return formatBaseUnits(value, USD_PRICE_DECIMALS);
}

/**
 * A ratio rendered to one decimal place, e.g. `47.1`. Integer arithmetic only,
 * with half-up rounding on the single kept digit.
 */
export function ratioToOneDecimal(numerator: bigint, denominator: bigint): string | null {
	if (denominator <= 0n || numerator < 0n) return null;
	// hundredths -> tenths, rounded half-up on the digit that is dropped.
	const hundredths = (numerator * 100n) / denominator;
	const tenths = (hundredths + 5n) / 10n;
	return formatBaseUnits(tenths, 1);
}
