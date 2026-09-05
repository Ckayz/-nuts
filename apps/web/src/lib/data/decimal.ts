/**
 * Base-unit integer string + decimals -> decimal string.
 *
 * `packages/db/src/ai-context.ts` has the same function but does not export it
 * (verified: `decimalFromBaseUnits` at line 126 has no `export` keyword), so
 * this is an independent copy with the same behaviour, tested against the same
 * cases. If `@nuts/db` ever exports it, delete this and import that one.
 *
 * Never converts through `number`: `positions.budget`, `contracts`, `premium`
 * and friends are unconstrained `numeric` columns whose values routinely exceed
 * 2^53 (packages/db/README.md, "Unit conventions").
 */

export function decimalFromBaseUnits(value: string, decimals: number): string {
	if (!Number.isInteger(decimals) || decimals < 0) {
		throw new Error("Base-unit decimals must be a non-negative integer");
	}
	const negative = value.startsWith("-");
	const digits = negative ? value.slice(1) : value;
	if (!/^\d+$/.test(digits)) throw new Error("Base-unit value must be an integer string");
	if (decimals === 0) return `${negative ? "-" : ""}${digits}`;
	const padded = digits.padStart(decimals + 1, "0");
	const integer = padded.slice(0, -decimals);
	const fraction = padded.slice(-decimals).replace(/0+$/, "");
	return `${negative ? "-" : ""}${integer}${fraction.length > 0 ? `.${fraction}` : ""}`;
}

/**
 * Nullable pair. Returns null when either half is null — the schema pairs every
 * nullable quantity with its own decimals column and the
 * `positions_*_decimals_required` CHECKs allow a null quantity with null
 * decimals, so a missing value is represented, never estimated.
 */
export function decimalFromNullableBaseUnits(
	value: string | null,
	decimals: number | null,
): string | null {
	if (value === null || decimals === null) return null;
	return decimalFromBaseUnits(value, decimals);
}

/**
 * USD columns (`entry_premium_usd`, `final_pnl_usd`, ...) are already decimal
 * `numeric`. Postgres returns them verbatim as strings through node-postgres, so
 * they only need normalising for the display layer's stricter pattern
 * (`/^-?\d+(?:\.\d+)?$/` in lib/display.ts) which rejects a leading `+`,
 * exponent form, or the `NaN` a numeric column can legally hold.
 */
export function usdDecimalOrNull(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/** Sums decimal strings exactly, in base-10 integer arithmetic. */
export function sumDecimals(values: readonly string[]): string {
	let scale = 0;
	for (const value of values) {
		const fraction = value.split(".")[1] ?? "";
		if (fraction.length > scale) scale = fraction.length;
	}
	let total = 0n;
	for (const value of values) {
		const negative = value.startsWith("-");
		const magnitude = negative ? value.slice(1) : value;
		const [integer = "0", fraction = ""] = magnitude.split(".");
		const scaled = BigInt(integer + fraction.padEnd(scale, "0"));
		total += negative ? -scaled : scaled;
	}
	if (scale === 0) return total.toString();
	const negative = total < 0n;
	const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
	const fraction = digits.slice(-scale).replace(/0+$/, "");
	return `${negative ? "-" : ""}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}
