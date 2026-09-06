import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CHART_INTERVAL,
	CHART_LIMIT,
	CHART_REVALIDATE_SECONDS,
	CHART_WINDOW_LABEL,
	binancePair,
	fetchCandles,
	parseKlines,
	strikeLevels,
} from "./klines";

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
	// K-2 (pass-4 D4-m4): "DOGE" used to stand here as the unmapped case. It is
	// a configured Base feed and Binance prices it, so it is mapped now; the
	// unmapped case has to be an asset Thetanuts does not list at all.
	for (const bad of ["", "LTC", "../../etc", "BTC&x=1", "UNKNOWN_FEED:0xabc"]) {
		expect(binancePair(bad)).toBeNull();
	}
});

test("every asset configured on Base has a pair", () => {
	// The eight symbols `buildPriceFeedSymbolMap(8453)` returns (read from the
	// SDK 2026-09-06). Six of them had live OptionBook orders that day; the
	// other two must not lose their chart the day they get liquidity, and each
	// pair was requested from Binance and returned a candle (klines.ts).
	for (const asset of ["BTC", "ETH", "SOL", "DOGE", "XRP", "BNB", "PAXG", "AVAX"]) {
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

/**
 * ── The deadline ────────────────────────────────────────────────────────────
 *
 * MEASURED before `CHART_TIMEOUT_MS` existed: `fetchCandles` passed no signal
 * and raced nothing, so a `fetchImpl` that never resolves left the promise
 * pending forever. That promise is awaited inside the `/api/klines/[asset]`
 * route handler, so a stalled Binance holds a serverless function open and the
 * browser's read of that route stalls with it.
 *
 * `Promise.race` against a 5 ms watchdog is what makes the assertion real: a
 * regression does not merely fail, it TIMES OUT here, which is exactly the
 * production symptom.
 */
const NEVER_MS = 40;

function watchdog(ms: number): Promise<"still pending"> {
	return new Promise((resolve) => setTimeout(() => resolve("still pending"), ms));
}

test("a transport that never answers is bounded, not awaited forever", async () => {
	let aborts = 0;
	const fetchImpl = ((_url: URL, init?: { signal?: AbortSignal }) => {
		init?.signal?.addEventListener("abort", () => {
			aborts += 1;
		});
		return new Promise<Response>(() => {});
	}) as unknown as typeof fetch;
	const result = await Promise.race([
		fetchCandles("BTC", { fetchImpl, timeoutMs: 5 }),
		watchdog(NEVER_MS),
	]);
	expect(result).toEqual([]);
	// The signal reaches the transport too, so a fetch that honours it is
	// actually cancelled rather than left running behind a won race.
	expect(aborts).toBe(1);
});

test("headers that arrive and a body that never does is the same stall, and bounded too", async () => {
	const fetchImpl = (async (_url: URL, init?: { signal?: AbortSignal }) => ({
		ok: true,
		json: () => new Promise(() => {}),
		signal: init?.signal,
	})) as unknown as typeof fetch;
	const result = await Promise.race([
		fetchCandles("BTC", { fetchImpl, timeoutMs: 5 }),
		watchdog(NEVER_MS),
	]);
	expect(result).toEqual([]);
});

test("a healthy transport is untouched by the deadline", async () => {
	const fetchImpl = (async () => ({ ok: true, json: async () => [REAL_ROW] })) as unknown as typeof fetch;
	expect(await fetchCandles("BTC", { fetchImpl })).toEqual([
		{ time: 1788634800, open: 79999.99, high: 79999.99, low: 79760.83, close: 79841.47 },
	]);
});

test("the window label states what the constants actually ask for", () => {
	// The screen-reader alternative says "one week of hourly candles". That is
	// not an independent claim: it is CHART_INTERVAL x CHART_LIMIT. If either
	// constant moves, this fails rather than leaving the sentence lying to the
	// one reader who cannot check it against the picture.
	expect(CHART_INTERVAL).toBe("1h");
	expect(CHART_LIMIT).toBe(168);
	expect(CHART_LIMIT).toBe(7 * 24);
	expect(CHART_WINDOW_LABEL).toBe("one week of hourly candles");
});
