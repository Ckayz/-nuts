import { CHART_REVALIDATE_SECONDS, binancePair, fetchCandles } from "@/lib/chart/klines";

/**
 * Price history for the market chart.
 *
 * A proxy rather than a browser fetch, for three reasons: the response is cached
 * once per asset for every visitor instead of once per visitor, the page's own
 * CSP does not have to allow an outbound host, and an unmapped asset is refused
 * here rather than by Binance.
 *
 * Returns an empty series rather than an error status when the upstream cannot
 * be read: the chart's own empty state says the history is unavailable, and a
 * failing decoration must not look like a failing page.
 */
/**
 * A literal, NOT `CHART_REVALIDATE_SECONDS`. Next.js reads route segment config
 * statically and refuses an imported constant: "Invalid segment configuration
 * export detected", which fails the production build. Keep this in step with
 * CHART_REVALIDATE_SECONDS in lib/chart/klines.ts — the test below pins them
 * together so they cannot drift apart silently.
 */
export const revalidate = 300;

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
	const { asset } = await context.params;
	// The allowlist is the guard: a value that is not a known asset never
	// reaches an outbound URL.
	if (binancePair(asset) === null) {
		return Response.json({ candles: [] }, { status: 404 });
	}
	const candles = await fetchCandles(asset);
	return Response.json(
		{ candles },
		{ headers: { "cache-control": `public, s-maxage=${CHART_REVALIDATE_SECONDS}, stale-while-revalidate=60` } },
	);
}
