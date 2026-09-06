/**
 * Price history for the market page's chart.
 *
 * ── Where this data comes from, and why that is a compromise ────────────────
 *
 * Thetanuts publishes a spot price and NO history: the SDK has no candle, OHLC
 * or time-range method, and `CLAUDE.md` records the owner removing charts three
 * times for exactly that reason — "no price history at Thetanuts … think for
 * the users man". So the honest options were to draw nothing, or to draw a real
 * series from somewhere else and say where it came from. This is the second.
 *
 * The series is Binance spot. Settlement is against Chainlink TWAP, so the two
 * are NOT the same number and the chart must say so. MEASURED 2026-09-06,
 * Thetanuts' own quoted spot against Binance at the same moment:
 *
 *   BTC 0.040%   ETH 0.020%   SOL -0.040%
 *   BNB 0.031%   AVAX 0.013%  XRP -0.021%
 *
 * Under four basis points on every live asset. That is immaterial for reading
 * which way price has moved over days, which is the only question this chart
 * exists to answer, and material for settlement maths, which this chart is
 * never used for. `CHART_SOURCE_NOTE` carries the caveat to the UI.
 */

/**
 * Binance's kline endpoint. Public, unauthenticated, no key. Weight 2 per call
 * against a 6,000/minute budget, so the cache window below is generous.
 *
 * MEASURED 2026-09-06 23:34 UTC, one request per pair against this endpoint
 * (`?interval=1h&limit=1`), for ALL EIGHT symbols `buildPriceFeedSymbolMap(8453)`
 * configures on Base — read from the SDK the same day, not from a doc:
 * ETH BTC SOL DOGE XRP BNB PAXG AVAX. Every one returned a candle row:
 *
 *   BTCUSDT  [[1788649200000,"79783.99000000",...
 *   ETHUSDT  [[1788649200000,"2480.98000000",...
 *   SOLUSDT  [[1788649200000,"103.38000000",...
 *   BNBUSDT  [[1788649200000,"770.49000000",...
 *   AVAXUSDT [[1788649200000,"7.60200000",...
 *   XRPUSDT  [[1788649200000,"1.41440000",...
 *   DOGEUSDT [[1788649200000,"0.09010000",...
 *   PAXGUSDT [[1788649200000,"4432.75000000",...
 */
/*
 * Binance's PUBLIC market-data host, not `api.binance.com`. MEASURED
 * 2026-09-06 09:1x: production (Vercel) answered `{"candles":[]}` for BTC and
 * ETH while the same route on a Malaysian machine returned candles and
 * `api.binance.com` answered it 200 — `api.binance.com` refuses US-hosted
 * callers (HTTP 451), which is where Vercel's default region runs; that refusal
 * was NOT read from Vercel's logs (no project link here), it is inferred from
 * the two measurements. `data-api.binance.vision` serves the identical
 * `/api/v3/klines` shape (measured from here: 200, same rows) and Binance
 * documents it as the market-data endpoint without the geo restriction. The
 * data is still Binance spot, so the chart's label stays true.
 */
const BINANCE_KLINES = "https://data-api.binance.vision/api/v3/klines";

/** TODO-OWNER: the window and granularity the chart opens on. */
export const CHART_INTERVAL = "1h";
export const CHART_LIMIT = 168; // one week of hourly candles

/** Seconds the proxy caches a series. TODO-OWNER. */
export const CHART_REVALIDATE_SECONDS = 300;

/**
 * One deadline for the WHOLE upstream exchange, headers and body alike.
 *
 * MEASURED 2026-09-06 before this was added: `fetchCandles` passed no signal and
 * raced nothing, so a `fetchImpl` that never resolves — and a real Binance that
 * accepts the connection and never answers — left the promise pending forever.
 * That promise is awaited inside the `/api/klines/[asset]` route handler, so a
 * stalled upstream holds a serverless function open until its own budget runs
 * out, and the browser's `fetch` of that route stalls with it: the chart would
 * sit in its loading phase with nothing in the box and no message. A response
 * whose headers arrive and whose body never does is the same stall, and only
 * the JSON read below puts the signal in front of it, so it is raced too. Same
 * shape as `lib/farcaster/casts.ts`, for the same reason.
 *
 * The number is PROVISIONAL and matched to `FARCASTER_TIMEOUT_MS` (3 s) rather
 * than invented: both are secondary panels read inside a page render, and a
 * serverless function's own budget is single-digit seconds. Binance's real
 * latency was not measured, so this is a bound, not an estimate.
 * TODO-OWNER: the number.
 */
export const CHART_TIMEOUT_MS = 3_000;

/** The sentence shown under the chart. TODO-OWNER: the wording. */
export const CHART_SOURCE_NOTE =
	"Binance spot, hourly. Thetanuts settles on a Chainlink TWAP, which can differ.";

/**
 * What the chart's window IS, in words, for the screen-reader alternative — a
 * canvas has no readable content of its own, so the label has to say it.
 *
 * Derived from the two constants above and not independently chosen: `1h` ×
 * 168 = 168 hours = one week. `klines.test.ts` pins the arithmetic, so changing
 * either constant fails that test rather than leaving this sentence lying.
 * TODO-OWNER: the wording.
 */
export const CHART_WINDOW_LABEL = "one week of hourly candles";

/**
 * The pair to ask Binance for.
 *
 * An allowlist, deliberately: the asset arrives from a URL segment, and an
 * unmapped value must never be concatenated into an outbound request. An asset
 * Thetanuts lists but Binance does not price simply has no chart.
 *
 * K-2 (pass-4 D4-m4). DOGE and PAXG were missing and the omission was explained
 * as "Binance does not price" them, which is false: both pairs were requested
 * and both returned candles (the measurement is in the comment above the
 * endpoint). They have no live orders today, so nothing rendered differently —
 * they would simply have lost their chart, silently, the day they got
 * liquidity. All eight configured Base feeds are mapped now, so this list and
 * `buildPriceFeedSymbolMap(8453)` cover the same assets.
 *
 * `app/api/klines/[asset]/route.ts` guards the proxy with `binancePair()` — this
 * map — and keeps no second list of its own.
 * TODO-OWNER: the quote currency, if a venue ever needs a different one.
 */
const PAIRS: Readonly<Record<string, string>> = {
	BTC: "BTCUSDT",
	ETH: "ETHUSDT",
	SOL: "SOLUSDT",
	BNB: "BNBUSDT",
	AVAX: "AVAXUSDT",
	XRP: "XRPUSDT",
	DOGE: "DOGEUSDT",
	PAXG: "PAXGUSDT",
};

export function binancePair(asset: string): string | null {
	return PAIRS[asset.trim().toUpperCase()] ?? null;
}

/** One candle, in the shape lightweight-charts consumes. Time is UNIX seconds. */
export interface Candle {
	readonly time: number;
	readonly open: number;
	readonly high: number;
	readonly low: number;
	readonly close: number;
}

/**
 * Binance returns an array of arrays, not objects. VERIFIED 2026-09-06 against
 * the live endpoint: 12 fields per row, `[0]` open time in MILLISECONDS, then
 * open, high, low, close as decimal STRINGS at `[1..4]`.
 *
 * Every row is validated. A malformed page yields an empty series rather than a
 * chart drawn from partial or NaN data — a price chart with a wrong point on it
 * is worse than no chart.
 */
export function parseKlines(body: unknown): Candle[] {
	if (!Array.isArray(body)) return [];
	const candles: unknown[] = [];
	for (const row of body) {
		if (!Array.isArray(row) || row.length < 5) return [];
		// Binance sends milliseconds; lightweight-charts wants seconds. The
		// numbers arrive as decimal STRINGS, so they are converted here and
		// judged by the shared rule below.
		//
		// K-4: one deliberate difference from the loop this replaced. The
		// positivity test used to run on the RAW millisecond value, so a
		// timestamp under 1,000 ms passed and was then floored to second 0 and
		// plotted. It now runs on the SECONDS, so such a row rejects the page.
		// Binance has never sent one; the old order was simply wrong.
		candles.push({
			time: Math.floor(Number(row[0]) / 1000),
			open: Number(row[1]),
			high: Number(row[2]),
			low: Number(row[3]),
			close: Number(row[4]),
		});
	}
	return asCandles(candles);
}

/**
 * K-4 item 4 (pass-5 lane C MINOR-1). The SAME rule, applied to candles that are
 * already objects — which is what the browser gets back from
 * `/api/klines/[asset]`.
 *
 * `price-chart.tsx` used to cast the proxy's JSON to `Candle[]` after an
 * `Array.isArray` check and nothing more, so a row shaped `{time:"x"}` would
 * have been handed to `lightweight-charts` as coordinates. Only our own
 * same-origin proxy can answer that route and it validates every row, so this
 * is defence in depth rather than a live defect — but "the other end validates"
 * is exactly the assumption that stops being true when someone changes the
 * other end.
 *
 * One function for both ends on purpose: two copies of a validation rule drift,
 * and a client that accepted what the server rejects is worse than no check.
 *
 * A single bad row rejects the WHOLE series, matching `parseKlines`: a chart
 * missing a candle in the middle still reads as a continuous price line, so a
 * partial series is a wrong picture rather than an incomplete one.
 */
export function asCandles(value: unknown): Candle[] {
	if (!Array.isArray(value)) return [];
	const candles: Candle[] = [];
	for (const row of value) {
		if (typeof row !== "object" || row === null || Array.isArray(row)) return [];
		const { time, open, high, low, close } = row as Record<string, unknown>;
		const numbers = [time, open, high, low, close];
		// Finite AND positive: `Number("")` is 0 and `Number(null)` is 0, so a
		// zero is far more likely to be a parse failure than a price.
		if (!numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0)) return [];
		const candle: Candle = {
			time: time as number,
			open: open as number,
			high: high as number,
			low: low as number,
			close: close as number,
		};
		// Strictly increasing time, which the chart library requires and which a
		// duplicated or out-of-order page would otherwise break at render time.
		const previous = candles[candles.length - 1];
		if (previous !== undefined && candle.time <= previous.time) return [];
		candles.push(candle);
	}
	return candles;
}

/**
 * A promise that never resolves and rejects when `signal` aborts.
 *
 * Exported because the browser side of the chart needs the same bound on its
 * read of our own proxy route. Used only inside `Promise.race`, which attaches a
 * handler, so its rejection is always handled even when the real work wins;
 * `AbortSignal.timeout`'s timer does not hold the event loop open, so a losing
 * race costs nothing.
 */
export function whenAborted(signal: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

/**
 * Fetch one series. Returns an empty list for any failure; never throws, and —
 * see `CHART_TIMEOUT_MS` — never pends longer than that deadline.
 *
 * The signal is passed to the transport AND raced against, on purpose: the
 * signal alone only bounds a transport that honours it, while the race bounds
 * this function whatever the transport does, which is what the page needs.
 */
export async function fetchCandles(
	asset: string,
	options: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number } = {},
): Promise<Candle[]> {
	const pair = binancePair(asset);
	if (pair === null) return [];
	const url = new URL(BINANCE_KLINES);
	url.searchParams.set("symbol", pair);
	url.searchParams.set("interval", CHART_INTERVAL);
	url.searchParams.set("limit", String(options.limit ?? CHART_LIMIT));
	const request = options.fetchImpl ?? fetch;
	const signal = AbortSignal.timeout(options.timeoutMs ?? CHART_TIMEOUT_MS);
	try {
		const response = await Promise.race([
			request(url, { next: { revalidate: CHART_REVALIDATE_SECONDS }, signal }),
			whenAborted(signal),
		]);
		if (!response.ok) return [];
		return parseKlines(await Promise.race([response.json(), whenAborted(signal)]));
	} catch {
		return [];
	}
}

/**
 * The strike lines to draw, from the strings the book publishes.
 *
 * Strikes arrive as decimal USD strings already scaled by the view layer. A
 * strike that does not parse is DROPPED rather than plotted at zero, which
 * would put a line along the bottom of the chart and read as a real level.
 * Sorted and de-duplicated so a spread's two legs draw once each, in order.
 */
export function strikeLevels(strikesUsd: readonly string[]): number[] {
	const seen = new Set<number>();
	for (const raw of strikesUsd) {
		const value = Number(String(raw).replace(/,/g, "").trim());
		if (!Number.isFinite(value) || value <= 0) continue;
		seen.add(value);
	}
	return [...seen].sort((left, right) => left - right);
}
