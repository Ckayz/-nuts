/**
 * The About panel's split bars.
 *
 * The failure this pins is silent rather than loud: a proportional bar whose
 * denominator is zero renders as a full-width statement about a book that
 * quoted nothing. So the absences are asserted as hard as the proportions.
 */
import { expect, test } from "bun:test";
import { barWidth, splitBar } from "./split-bar";

test("a two-sided count splits in proportion and fills the track exactly", () => {
	const bar = splitBar(75, 25);
	expect(bar).not.toBeNull();
	expect(bar?.leftPct).toBe(75);
	expect(bar?.rightPct).toBe(25);
	expect(bar?.total).toBe(100);
});

test("the two segments always sum to exactly 100, including on repeating decimals", () => {
	for (const [left, right] of [[1, 2], [2, 1], [1, 3], [7, 11], [86, 61], [1, 999_999]] as const) {
		const bar = splitBar(left, right);
		expect(bar).not.toBeNull();
		expect((bar as { leftPct: number }).leftPct + (bar as { rightPct: number }).rightPct).toBe(100);
	}
});

test("zero on one side is a real proportion, not a missing one", () => {
	expect(splitBar(0, 12)).toEqual({ leftPct: 0, rightPct: 100, left: 0, right: 12, total: 12 });
	expect(splitBar(12, 0)).toEqual({ leftPct: 100, rightPct: 0, left: 12, right: 0, total: 12 });
});

test("a total of zero draws NO bar — the divide-by-zero full-width lie", () => {
	expect(splitBar(0, 0)).toBeNull();
});

test("a side the book did not supply draws no bar, never a zero", () => {
	// `marketBookStats` returns `{}` in mock mode and whenever the order snapshot
	// cannot be read, so both of these reach the panel in normal operation.
	expect(splitBar(null, 4)).toBeNull();
	expect(splitBar(4, null)).toBeNull();
	expect(splitBar(undefined, undefined)).toBeNull();
	expect(splitBar(null, null)).toBeNull();
});

test("a count that cannot be a count draws no bar", () => {
	expect(splitBar(Number.NaN, 4)).toBeNull();
	expect(splitBar(4, Number.NaN)).toBeNull();
	expect(splitBar(Number.POSITIVE_INFINITY, 4)).toBeNull();
	expect(splitBar(-1, 4)).toBeNull();
	expect(splitBar(4, -1)).toBeNull();
});

test("widths are clamped and rounded, so no segment can overflow its row", () => {
	expect(barWidth(33.333333333)).toBe("33.33%");
	expect(barWidth(0)).toBe("0%");
	expect(barWidth(100)).toBe("100%");
	expect(barWidth(140)).toBe("100%");
	expect(barWidth(-8)).toBe("0%");
	expect(barWidth(Number.NaN)).toBe("0%");
});

test("a rendered pair of widths never exceeds the track", () => {
	for (const [left, right] of [[1, 2], [86, 61], [0, 5], [5, 0], [999, 1]] as const) {
		const bar = splitBar(left, right);
		if (bar === null) throw new Error("expected a bar");
		const total =
			Number.parseFloat(barWidth(bar.leftPct)) + Number.parseFloat(barWidth(bar.rightPct));
		expect(total).toBeLessThanOrEqual(100.001);
		expect(total).toBeGreaterThanOrEqual(99.999);
	}
});
