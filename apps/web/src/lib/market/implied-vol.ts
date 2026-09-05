/**
 * Implied volatility for an asset, from the live order book.
 *
 * ── Why this reads `greeks.iv` and NOT `market_weather.curVol` ──────────────
 *
 * The order feed publishes both, and they are different quantities. MEASURED
 * 2026-09-06 against the live feed:
 *
 *   asset   market_weather.curVol   median greeks.iv
 *   BTC     0.08                    0.385
 *   ETH     0.04                    0.487
 *   SOL     0.22                    0.567
 *   BNB     0.22                    0.680
 *   AVAX    0.18                    0.459
 *   XRP     0.19                    0.423
 *
 * 38-68% is what annualised crypto implied volatility looks like; 4-8% is not.
 * `curVol` is some other measure — a short-window realised figure, most likely —
 * and labelling it "implied vol" would put a wrong number on a trading page.
 * `greeks.iv` is the maker's own implied vol for that order, which is the number
 * an options trader is asking for.
 *
 * The MEDIAN, not the mean: a book carries deep out-of-the-money strikes whose
 * implied vol is far above the at-the-money level, and a mean lets a handful of
 * those drag the headline number somewhere no real quote sits.
 */

/** One order's greeks, as the feed publishes them. */
interface Greeks {
	readonly iv?: unknown;
}

/**
 * Read `iv` off an order, defensively.
 *
 * `greeks` sits at the WRAPPER level in the raw feed — a sibling of `order`, not
 * a field inside it — and the SDK copies it into `rawApiData` when present
 * (`normalizeOdetteOrder`, dist/index.js:3392). Neither position is in the
 * app's own types, so this reads through `unknown` with a runtime check rather
 * than asserting a shape the compiler cannot see.
 */
export function orderImpliedVol(order: unknown): number | null {
	if (typeof order !== "object" || order === null) return null;
	const candidates: unknown[] = [];
	const record = order as Record<string, unknown>;
	candidates.push(record.greeks);
	const sdkOrder = record.sdkOrder;
	if (typeof sdkOrder === "object" && sdkOrder !== null) {
		const raw = (sdkOrder as Record<string, unknown>).rawApiData;
		if (typeof raw === "object" && raw !== null) candidates.push((raw as Record<string, unknown>).greeks);
	}
	const entry = record.entry;
	if (typeof entry === "object" && entry !== null) {
		const inner = (entry as Record<string, unknown>).order;
		if (typeof inner === "object" && inner !== null) candidates.push((inner as Record<string, unknown>).greeks);
	}
	for (const candidate of candidates) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const iv = (candidate as Greeks).iv;
		// A quote at exactly zero volatility is not a quote; it is a missing field
		// written as a number, and it must not drag the median down.
		if (typeof iv === "number" && Number.isFinite(iv) && iv > 0) return iv;
	}
	return null;
}

/**
 * The median implied vol across a set of orders, as a fraction (0.385 = 38.5%).
 * Null when no order carries a usable one — the tile then shows nothing rather
 * than a zero that would read as "this market has no volatility".
 */
export function medianImpliedVol(orders: readonly unknown[]): number | null {
	const values: number[] = [];
	for (const order of orders) {
		const iv = orderImpliedVol(order);
		if (iv !== null) values.push(iv);
	}
	if (values.length === 0) return null;
	values.sort((left, right) => left - right);
	const middle = Math.floor(values.length / 2);
	if (values.length % 2 === 1) return values[middle] ?? null;
	const lower = values[middle - 1];
	const upper = values[middle];
	if (lower === undefined || upper === undefined) return null;
	return (lower + upper) / 2;
}

/**
 * TODO-OWNER: the precision. One decimal reads as a level, not a measurement.
 *
 * Zero and negatives return null for the same reason `orderImpliedVol` rejects
 * them: "0.0%" on a market page reads as "this market has no volatility", which
 * is a claim the book never makes. A missing number must look missing.
 */
export function impliedVolLabel(value: number | null | undefined): string | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
	return `${(value * 100).toFixed(1)}%`;
}
