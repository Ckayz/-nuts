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

import {
	CHART_SOURCE_NOTE,
	CHART_TIMEOUT_MS,
	CHART_WINDOW_LABEL,
	type Candle,
	strikeLevels,
	whenAborted,
} from "@/lib/chart/klines";
import {
	clusterMarkers,
	placeThesisMarkers,
	type MarkerCluster,
	type MarkerThesis,
} from "@/lib/chart/thesis-markers";
import { Avatar } from "@/components/primitives";

/** A cluster plus where it currently sits over the canvas, in CSS pixels. */
interface Pin {
	readonly key: string;
	readonly x: number;
	readonly y: number;
	readonly cluster: MarkerCluster;
}

const CHART_HEIGHT = 260;

/**
 * How many posts a clustered marker's card lists before it says "and N more".
 * TODO-OWNER: the number.
 */
const CARD_THESES = 3;

type Phase = "loading" | "ready" | "empty";

export function PriceChart({
	asset,
	strikesUsd = [],
	strikesLabel = null,
	theses = [],
}: {
	readonly asset: string;
	/** The selected structure's strikes, as the view layer formats them. */
	readonly strikesUsd?: readonly string[];
	readonly strikesLabel?: string | null;
	/** Posts about this market, drawn on the candles they were written in. */
	readonly theses?: readonly MarkerThesis[];
}) {
	const host = useRef<HTMLDivElement>(null);
	const [phase, setPhase] = useState<Phase>("loading");
	/** Screen positions for the avatars, recomputed on every pan, zoom and resize. */
	const [pins, setPins] = useState<readonly Pin[]>([]);
	const [outsideWindow, setOutsideWindow] = useState(0);
	const [openCluster, setOpenCluster] = useState<string | null>(null);

	useEffect(() => {
		let disposed = false;
		let chart: IChartApi | null = null;
		const cleanups: Array<() => void> = [];

		(async () => {
			let candles: Candle[] = [];
			// Bounded on the same deadline the proxy uses. Without it a route
			// that never answers leaves `phase` on "loading" forever: an empty
			// box, no message, and no way for the reader to know it failed. The
			// signal is passed to the transport AND raced against, so the bound
			// holds whatever the transport does; a body that never arrives is
			// the same stall, so the JSON read is raced too.
			const signal = AbortSignal.timeout(CHART_TIMEOUT_MS);
			try {
				const response = await Promise.race([
					fetch(`/api/klines/${encodeURIComponent(asset)}`, { signal }),
					whenAborted(signal),
				]);
				if (response.ok) {
					const body: unknown = await Promise.race([response.json(), whenAborted(signal)]);
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
				// H-1 carried finding: the fallback said `#201d2d`, but the app's
				// `--surface2` is `#1a1922` (`src/index.css:19`). Invisible while the
				// variable resolves, wrong the moment it does not.
				crosshair: { horzLine: { labelBackgroundColor: token("--surface2", "#1a1922") }, vertLine: { labelBackgroundColor: token("--surface2", "#1a1922") } },
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

			/**
			 * The thesis markers.
			 *
			 * lightweight-charts' own markers are shapes, not images, so the
			 * avatars are ordinary DOM positioned over the canvas: the library
			 * converts a (time, price) into pixels and React draws the rest. That
			 * also means the hover card is real HTML — focusable, selectable, and
			 * styled with the app's own tokens.
			 */
			const placement = placeThesisMarkers(theses, candles);
			const clusters = clusterMarkers(placement.markers);
			setOutsideWindow(placement.outsideWindow);

			const reposition = () => {
				if (disposed || chart === null) return;
				const scale = chart.timeScale();
				const next: Pin[] = [];
				for (const cluster of clusters) {
					const x = scale.timeToCoordinate(cluster.time as UTCTimestamp);
					const y = series.priceToCoordinate(cluster.price);
					// Null means the point is scrolled out of view; it is simply
					// not drawn rather than clamped to an edge it never occupied.
					if (x === null || y === null) continue;
					next.push({ key: String(cluster.time), x, y, cluster });
				}
				setPins(next);
			};
			reposition();
			chart.timeScale().subscribeVisibleTimeRangeChange(reposition);
			// autoSize redraws on container resize; the pins must follow it.
			const observer = new ResizeObserver(reposition);
			if (host.current !== null) observer.observe(host.current);
			cleanups.push(() => {
				observer.disconnect();
				chart?.timeScale().unsubscribeVisibleTimeRangeChange(reposition);
			});

			setPhase("ready");
		})();

		return () => {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			chart?.remove();
		};
	}, [asset, strikesUsd, theses]);

	/**
	 * The screen-reader alternative for the canvas.
	 *
	 * A canvas has no readable content: without this the chart is an unlabelled
	 * blank to anyone not looking at it. It says the three things the picture
	 * says — which asset, over what window, and which levels are drawn on it —
	 * and then where the prices came from, because that caveat belongs to every
	 * reader and not only the sighted one. TODO-OWNER: the wording.
	 */
	const chartLabel = [
		`${asset} price, ${CHART_WINDOW_LABEL}.`,
		strikesLabel === null ? null : `Strikes drawn: ${strikesLabel}.`,
		CHART_SOURCE_NOTE,
	]
		.filter((part): part is string => part !== null)
		.join(" ");

	return (
		<section className="card pad chart-card">
			<div className="chart-h">
				<h3>{asset} price</h3>
				{strikesLabel === null ? null : <span className="mut num">{strikesLabel}</span>}
			</div>
			<div className="chart-box" style={{ height: CHART_HEIGHT }}>
				{/*
				  The library's canvas gets its OWN element, and the markers stay
				  siblings of it, for two reasons.

				  a11y: `role="img"` is what gives the canvas a name, and it also
				  hides everything inside it from assistive technology — so the
				  thesis markers, which are real focusable buttons, must not be
				  in there. The role is only set once there is actually a chart:
				  a label on an empty box would describe a picture that is not
				  drawn.

				  Correctness: React and lightweight-charts were both writing
				  children into this one node. React reconciling a node a third
				  party mutates is a known hazard; now each owns its own.
				*/}
				<div
					className="chart-canvas"
					ref={host}
					role={phase === "ready" ? "img" : undefined}
					aria-label={phase === "ready" ? chartLabel : undefined}
				/>
				{phase === "empty" ? (
					<p className="note">Price history is unavailable right now.</p>
				) : null}
				{pins.map((pin) => {
					const lead = pin.cluster.theses[0];
					if (lead === undefined) return null;
					const open = openCluster === pin.key;
					const extra = pin.cluster.theses.length - 1;
					return (
						<div className="tmark" key={pin.key} style={{ left: pin.x, top: pin.y }}>
							<button
								type="button"
								className={`tmark-dot ${lead.direction ?? "flat"}`}
								aria-label={`${pin.cluster.theses.length} thesis on this candle by ${lead.handleLabel}`}
								aria-expanded={open}
								onMouseEnter={() => setOpenCluster(pin.key)}
								onMouseLeave={() => setOpenCluster((current) => (current === pin.key ? null : current))}
								onFocus={() => setOpenCluster(pin.key)}
								onBlur={() => setOpenCluster((current) => (current === pin.key ? null : current))}
							>
								<Avatar seed={lead.avatarSeed} initials={lead.handleLabel.slice(1, 3).toUpperCase()} size={26} />
								{extra > 0 ? <span className="tmark-more num">+{extra}</span> : null}
							</button>
							{open ? (
								/* Flipped below when the marker sits in the top half, so the
								   card cannot escape the chart and cover the stat tiles above. */
								<div className={`tmark-card ${pin.y < CHART_HEIGHT / 2 ? "below" : ""}`} role="tooltip">
									{pin.cluster.theses.slice(0, CARD_THESES).map((thesis) => (
										<article key={thesis.id}>
											<header>
												<b>{thesis.handleLabel}</b>
												{thesis.direction === null ? null : (
													<span className={`ptype ${thesis.direction}`}>
														<i aria-hidden="true" />
														{thesis.direction === "bull" ? "Bull" : "Bear"}
													</span>
												)}
											</header>
											<p>{thesis.headline}</p>
											<footer className="mut num">♥ {thesis.likes}</footer>
										</article>
									))}
									{pin.cluster.theses.length > CARD_THESES ? (
										<p className="mut">and {pin.cluster.theses.length - CARD_THESES} more on this candle</p>
									) : null}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
			{/* Said out loud rather than silently under-reporting: the chart is one
			    week, and a post older than that has no honest place on it. */}
			{outsideWindow > 0 ? (
				<p className="chart-note mut">
					{outsideWindow} {outsideWindow === 1 ? "thesis is" : "theses are"} older than this window.
				</p>
			) : null}
			{/* Says which price this is. The chart is Binance spot; settlement is a
			    Chainlink TWAP, and the two are not the same number. */}
			<p className="chart-note mut">{CHART_SOURCE_NOTE}</p>
		</section>
	);
}
