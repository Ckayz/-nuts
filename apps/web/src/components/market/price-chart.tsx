"use client";

/**
 * The market page's price chart, with the selected structure's strikes drawn on
 * it as horizontal lines.
 *
 * The strike lines are the point. A bare price chart is decoration: premium and
 * max loss already tell you what a trade costs. What they do not tell you is
 * whether the strike you are buying sits where price has actually been, and
 * that is the question a chart answers — is 78,000 a level this asset has been
 * trading around all week, or one it has not touched.
 *
 * Client-only, because lightweight-charts writes to the DOM. Loaded through a
 * dynamic import inside the effect so the library is never in the server bundle
 * and never blocks first paint.
 *
 * TODO-OWNER: the height, the timeframe, and every label below.
 */

import { useEffect, useRef, useState } from "react";
// Type-only: erased at build, so the library stays out of the server bundle and
// only the dynamic import below ever pulls the runtime in.
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

import { CHART_SOURCE_NOTE, type Candle, strikeLevels } from "@/lib/chart/klines";

const CHART_HEIGHT = 260;

type Phase = "loading" | "ready" | "empty";

export function PriceChart({
	asset,
	strikesUsd = [],
	strikesLabel = null,
}: {
	readonly asset: string;
	/** The selected structure's strikes, as the view layer formats them. */
	readonly strikesUsd?: readonly string[];
	readonly strikesLabel?: string | null;
}) {
	const host = useRef<HTMLDivElement>(null);
	const [phase, setPhase] = useState<Phase>("loading");

	useEffect(() => {
		let disposed = false;
		let chart: IChartApi | null = null;

		(async () => {
			let candles: Candle[] = [];
			try {
				const response = await fetch(`/api/klines/${encodeURIComponent(asset)}`);
				if (response.ok) {
					const body: unknown = await response.json();
					const list = (body as { candles?: unknown }).candles;
					if (Array.isArray(list)) candles = list as Candle[];
				}
			} catch {
				candles = [];
			}
			if (disposed) return;
			if (candles.length === 0 || host.current === null) {
				setPhase("empty");
				return;
			}

			// Read the app's own tokens rather than restating hex here, so the
			// chart cannot drift from the palette the rest of the page uses.
			const styles = getComputedStyle(document.documentElement);
			const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

			const { createChart, CandlestickSeries, LineStyle, ColorType } = await import("lightweight-charts");
			if (disposed || host.current === null) return;

			/**
			 * D-R3-m2 (Astra lane D, pass 3). The canvas draws its own text and
			 * inherits nothing from CSS: `lightweight-charts` falls back to
			 * `defaultFontFamily` — measured in the installed 5.2.1 bundle,
			 * `dist/lightweight-charts.development.mjs:263`:
			 *   `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`
			 * — so every axis and crosshair label was rendered in the system face
			 * while the mockup allows Manrope only.
			 *
			 * The family is READ from the page rather than restated: `body` carries
			 * `font-family: var(--sans)` (`index.css:51`), and a computed style
			 * resolves the `var(--font-manrope)` hashed family name that
			 * `next/font` generates — which a literal string here could not know.
			 * The literal stack is the fallback for a body that has not been
			 * styled yet.
			 *
			 * `document.fonts.ready` first, because a canvas can only paint a web
			 * font that is already loaded; with `display: "swap"` an unloaded face
			 * would be drawn in the fallback and never repainted. Guarded: a
			 * browser without the Font Loading API must still get a chart.
			 */
			try {
				await document.fonts?.ready;
			} catch {
				// A font that cannot be awaited is still drawn, in the fallback.
			}
			if (disposed || host.current === null) return;
			const chartFont =
				getComputedStyle(document.body).fontFamily ||
				'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

			chart = createChart(host.current, {
				height: CHART_HEIGHT,
				// The chart must follow its container, not the width it was born at.
				// Without this it keeps the desktop width after a resize and pushes
				// the whole page into horizontal scroll on a phone — MEASURED at
				// 390px: a 568px canvas inside a 316px card, document 683 > 390.
				autoSize: true,
				layout: {
					background: { type: ColorType.Solid, color: "transparent" },
					textColor: token("--muted", "#9899a3"),
					// D-R3-m2: the app's own face, not the library's system stack.
					fontFamily: chartFont,
					attributionLogo: false,
				},
				grid: {
					vertLines: { visible: false },
					horzLines: { color: token("--line-soft", "#201d2c") },
				},
				rightPriceScale: { borderColor: token("--line", "#282438") },
				timeScale: { borderColor: token("--line", "#282438"), timeVisible: true },
				crosshair: { horzLine: { labelBackgroundColor: token("--surface2", "#201d2d") }, vertLine: { labelBackgroundColor: token("--surface2", "#201d2d") } },
				handleScale: false,
				handleScroll: false,
			});

			const series = chart.addSeries(CandlestickSeries, {
				upColor: token("--gain", "#1cce59"),
				downColor: token("--loss", "#fd6536"),
				borderVisible: false,
				wickUpColor: token("--gain", "#1cce59"),
				wickDownColor: token("--loss", "#fd6536"),
			});
			// The library brands its time type; our candles carry plain UNIX
			// seconds, which is exactly what UTCTimestamp is.
			series.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));

			// The strikes. Accent, dashed, labelled — deliberately not a money
			// colour: a strike is a level, not a gain or a loss.
			for (const level of strikeLevels(strikesUsd)) {
				series.createPriceLine({
					price: level,
					color: token("--accent-lift", "#7598e9"),
					lineWidth: 1,
					lineStyle: LineStyle.Dashed,
					axisLabelVisible: true,
					title: "strike",
				});
			}

			chart.timeScale().fitContent();
			setPhase("ready");
		})();

		return () => {
			disposed = true;
			chart?.remove();
		};
	}, [asset, strikesUsd]);

	return (
		<section className="card pad chart-card">
			<div className="chart-h">
				<h3>{asset} price</h3>
				{strikesLabel === null ? null : <span className="mut num">{strikesLabel}</span>}
			</div>
			<div className="chart-box" ref={host} style={{ height: CHART_HEIGHT }}>
				{phase === "empty" ? (
					<p className="note">Price history is unavailable right now.</p>
				) : null}
			</div>
			{/* Says which price this is. The chart is Binance spot; settlement is a
			    Chainlink TWAP, and the two are not the same number. */}
			<p className="chart-note mut">{CHART_SOURCE_NOTE}</p>
		</section>
	);
}
