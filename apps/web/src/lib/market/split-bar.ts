/**
 * The split bar behind the market page's About panel.
 *
 * fomo's `About <TOKEN>` card draws paired proportional bars — `234 buys / 23
 * sells`, `3.23K buyers / 850 sellers` — as ONE track split green-left,
 * red-right, each side's width proportional to its share
 * (docs/design/FOMO-DIGEST.md, "About-panel pattern worth stealing"). It is the
 * one fomo idea that needs no price history, which is the constraint that
 * removed our charts.
 *
 * The maths is here, pure and tested, because the failure mode is silent: a bar
 * that divides by zero renders as a full-width claim about a book that quoted
 * nothing. Every unmeasurable case returns `null` and the caller draws no bar,
 * which is the same rule `lib/market/stat-tiles.ts` already applies to a missing
 * tile — an absent figure is never a zero.
 */

/** One bar's geometry. `leftPct + rightPct` is exactly 100. */
export interface SplitBar {
	/** Left segment width as a percentage, 0-100. */
	leftPct: number;
	/** Right segment width as a percentage, 0-100. */
	rightPct: number;
	left: number;
	right: number;
	total: number;
}

/**
 * Proportions for a two-sided count, or `null` when there is nothing to draw.
 *
 * `null` — never a 0/100 or a 50/50 stand-in — for:
 *   · either side missing (`null`/`undefined`), which is what every read in
 *     `marketBookStats` returns when the book could not be read;
 *   · a non-finite or negative count, which no order tally can honestly be;
 *   · a total of zero, the divide-by-zero case.
 *
 * The right side is computed as `100 - leftPct` rather than from its own
 * division, so the two segments always fill the track exactly and floating-point
 * error can never leave a hairline gap or overflow the row.
 */
export function splitBar(
	left: number | null | undefined,
	right: number | null | undefined,
): SplitBar | null {
	if (typeof left !== "number" || typeof right !== "number") return null;
	if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
	if (left < 0 || right < 0) return null;
	const total = left + right;
	if (total <= 0) return null;
	const leftPct = (left / total) * 100;
	return { leftPct, rightPct: 100 - leftPct, left, right, total };
}

/**
 * A CSS width for one segment.
 *
 * Rounded to two decimals so the markup is stable across renders (an unrounded
 * `33.33333333333333%` differs between a server render and a hydration on a
 * different float path), and never below zero.
 */
export function barWidth(pct: number): string {
	const safe = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
	return `${Math.round(safe * 100) / 100}%`;
}
