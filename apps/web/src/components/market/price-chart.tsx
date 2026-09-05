"use client";

import { AreaSeries, ColorType, createChart, LineStyle } from "lightweight-charts";
import type { UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { SeriesPoint } from "@/lib/display-types";

/**
 * The market page's price chart: TradingView `lightweight-charts@5.2.1`
 * (owner order 2026-09-05; identity verified before install, see CLAUDE.md).
 *
 * Colours are read from the mockup's design tokens at mount so the chart cannot
 * drift from `packages/ui/src/styles/globals.css`. `autoSize` uses the library's
 * own ResizeObserver, so the chart follows the column width. Under
 * `prefers-reduced-motion` the kinetic (inertial) scroll is switched off; the
 * chart itself never animates on its own.
 */
export function PriceChart({
	series,
	label,
	priceLineValue,
	priceDecimals,
}: {
	series: SeriesPoint[];
	label: string;
	/** Draws the current-spot guide line, in the mockup's accent gold. */
	priceLineValue: number;
	/** Digits on the price axis. A five-figure BTC axis reads worse with cents. */
	priceDecimals: number;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = ref.current;
		if (!container) return;
		const css = getComputedStyle(document.documentElement);
		const tok = (name: string) => css.getPropertyValue(name).trim();
		const reduced =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const chart = createChart(container, {
			autoSize: true,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: tok("--tn-dim"),
				fontSize: 10,
				fontFamily: tok("--tn-mono"),
			},
			grid: {
				vertLines: { visible: false },
				horzLines: { color: tok("--tn-l") },
			},
			rightPriceScale: { borderColor: tok("--tn-l") },
			timeScale: { borderColor: tok("--tn-l"), timeVisible: true, secondsVisible: false },
			crosshair: {
				vertLine: { color: tok("--tn-l2"), labelBackgroundColor: tok("--tn-s2") },
				horzLine: { color: tok("--tn-l2"), labelBackgroundColor: tok("--tn-s2") },
			},
			kineticScroll: { touch: !reduced, mouse: false },
		});

		const area = chart.addSeries(AreaSeries, {
			lineColor: tok("--tn-k"),
			lineWidth: 2,
			topColor: "rgba(245,197,66,.16)",
			bottomColor: "rgba(245,197,66,0)",
			priceLineVisible: false,
			lastValueVisible: false,
			priceFormat: { type: "price", precision: priceDecimals, minMove: 10 ** -priceDecimals },
		});
		// `time` is a UTC epoch in seconds, which is exactly `UTCTimestamp`; the
		// library brands the number type, so the assertion carries no new claim.
		area.setData(series.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
		area.createPriceLine({
			price: priceLineValue,
			color: tok("--tn-acc"),
			lineWidth: 1,
			lineStyle: LineStyle.Dashed,
			axisLabelVisible: true,
			// Gold fill takes dark ink, per the mockup's colour rules.
			axisLabelColor: tok("--tn-acc"),
			axisLabelTextColor: tok("--tn-acc-ink"),
			title: "",
		});
		chart.timeScale().fitContent();

		return () => {
			chart.remove();
		};
	}, [series, priceLineValue, priceDecimals]);

	return <div className="chartwrap" ref={ref} role="img" aria-label={label} />;
}
