import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHART_REVALIDATE_SECONDS, binancePair, parseKlines, strikeLevels } from "./klines";

/** One real row, copied from the live endpoint on 2026-09-06. */
const REAL_ROW = [
	1788634800000, "79999.99000000", "79999.99000000", "79760.83000000", "79841.47000000",
	"12.5", 1788638399999, "998000.1", 900, "6.2", "495000.0", "0",
];

test("the documented row shape maps to a candle", () => {
	// VERIFIED against the live endpoint: 12 fields, ms at [0], OHLC strings at [1..4].
	expect(parseKlines([REAL_ROW])).toEqual([
		{ time: 1788634800, open: 79999.99, high: 79999.99, low: 79760.83, close: 79841.47 },
	]);
});

test("milliseconds become seconds, because the chart library wants seconds", () => {
	const [candle] = parseKlines([REAL_ROW]);
	expect(candle?.time).toBe(1788634800);
	expect(String(candle?.time)).toHaveLength(10);
});

test("a malformed page draws nothing rather than a chart with a wrong point on it", () => {
	expect(parseKlines(null)).toEqual([]);
	expect(parseKlines({})).toEqual([]);
	expect(parseKlines([[1788634800000, "x", "1", "1", "1"]])).toEqual([]);
	expect(parseKlines([[1788634800000, "1", "1", "1"]])).toEqual([]);
	expect(parseKlines([[0, "1", "1", "1", "1"]])).toEqual([]);
	expect(parseKlines([[1788634800000, "-1", "1", "1", "1"]])).toEqual([]);
	// One bad row poisons the series: a partial chart is still a wrong chart.
	expect(parseKlines([REAL_ROW, [1788638400000, "1", "1", "1", "bad"]])).toEqual([]);
});

test("time must strictly increase, which the chart library requires", () => {
	const same = [REAL_ROW, [...REAL_ROW]];
	expect(parseKlines(same)).toEqual([]);
	const backwards = [REAL_ROW, [1788631200000, "1", "1", "1", "1"]];
	expect(parseKlines(backwards)).toEqual([]);
});

test("only allowlisted assets reach the outbound request", () => {
	// The asset comes from a URL segment. An unmapped value must never be
	// concatenated into a request to Binance.
	expect(binancePair("BTC")).toBe("BTCUSDT");
	expect(binancePair("btc")).toBe("BTCUSDT");
	expect(binancePair(" eth ")).toBe("ETHUSDT");
	for (const bad of ["", "DOGE", "../../etc", "BTC&x=1", "UNKNOWN_FEED:0xabc"]) {
		expect(binancePair(bad)).toBeNull();
	}
});

test("every asset the live book quotes has a pair", () => {
	// MEASURED 2026-09-05: these six are the assets with live OptionBook orders.
	for (const asset of ["BTC", "ETH", "BNB", "SOL", "AVAX", "XRP"]) {
		expect(binancePair(asset)).not.toBeNull();
	}
});

test("strike levels are numeric, sorted, de-duplicated, and never zero", () => {
	expect(strikeLevels(["78000", "74000"])).toEqual([74000, 78000]);
	expect(strikeLevels(["78,000.50"])).toEqual([78000.5]);
	expect(strikeLevels(["78000", "78000"])).toEqual([78000]);
	// A strike that does not parse is dropped, not plotted at zero — a line
	// along the bottom of the chart would read as a real level.
	expect(strikeLevels(["—", "", "n/a", "0", "-5"])).toEqual([]);
	expect(strikeLevels(["78000", "bad"])).toEqual([78000]);
});

test("the route's literal revalidate stays in step with the constant", () => {
	// Next.js reads route segment config statically and refuses an imported
	// constant, so `route.ts` must hard-code the number. This is the pin that
	// stops the two drifting apart.
	const source = readFileSync(new URL("../../app/api/klines/[asset]/route.ts", import.meta.url), "utf8");
	expect(source).toContain(`export const revalidate = ${CHART_REVALIDATE_SECONDS};`);
});
