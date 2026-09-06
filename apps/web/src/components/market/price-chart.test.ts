/// <reference types="bun" />
/**
 * D-R3-m2 (Astra lane D, pass 3). The chart's text is painted onto a canvas and
 * inherits nothing from CSS, so `lightweight-charts` used its own
 * `defaultFontFamily` while the mockup allows Manrope only.
 *
 * Measured in my own headless Chromium, by recording every value the library
 * assigns to `CanvasRenderingContext2D.font` on `/m/eth`:
 *
 *   before ["12px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto,
 *            Ubuntu, sans-serif", "bold 12px …"]
 *   after  ["12px Manrope, \"Manrope Fallback\", Manrope, -apple-system, …",
 *           "bold 12px Manrope, …"]
 *
 * The "before" string is byte-identical to `defaultFontFamily` at
 * `apps/web/node_modules/lightweight-charts/dist/lightweight-charts.development.mjs:263`,
 * which is asserted below so this file fails if the library's default changes
 * out from under the finding.
 *
 * This test runs the REAL effect in a child process with a hand-rolled document
 * and a stubbed `lightweight-charts`, and reads the options the component
 * actually passes to `createChart`. The browser measurement above is what proves
 * the canvas paints it; this is what keeps it from silently regressing offline.
 */
import { expect, test } from "bun:test";

const APP = new URL("../../..", import.meta.url).pathname;

test("the library's own default really is the system stack this fold replaced", async () => {
	const bundle = await Bun.file(
		`${APP}node_modules/lightweight-charts/dist/lightweight-charts.development.mjs`,
	).text();
	expect(bundle).toContain(
		"const defaultFontFamily = `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`;",
	);
});

test("the chart is created with the page's own font family, after the fonts are ready", () => {
	const script = String.raw`
		import { plugin } from "bun";
		const calls = { createChart: [], fontsAwaited: 0 };
		const BODY_FONT = 'Manrope, "Manrope Fallback", -apple-system, sans-serif';
		const chart = {
			addSeries: () => ({ setData() {}, createPriceLine() {} }),
			timeScale: () => ({ fitContent() {} }),
			remove() {},
			applyOptions() {},
			subscribeCrosshairMove() {},
		};
		plugin({ name: "chart-font-probe", setup(build) {
			build.module("lightweight-charts", () => ({ exports: {
				createChart: (host, options) => { calls.createChart.push(options); return chart; },
				CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: "solid" },
			}, loader: "object" }));
		}});
		// Only what the effect touches, so nothing here can accidentally supply
		// the answer: the font comes from document.body's computed style.
		const element = { style: {}, getBoundingClientRect: () => ({ width: 600, height: 260 }) };
		globalThis.document = {
			documentElement: {},
			body: {},
			fonts: { get ready() { calls.fontsAwaited += 1; return Promise.resolve(); } },
		};
		globalThis.getComputedStyle = (node) => node === globalThis.document.body
			? { fontFamily: BODY_FONT }
			: { getPropertyValue: () => "" };
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => ({ candles: [{ time: 1788044400, open: 1, high: 2, low: 1, close: 2 }] }),
		});
		const { mount } = await import("./src/test/hook-runner.ts");
		const { PriceChart } = await import("./src/components/market/price-chart.tsx");
		const h = mount(PriceChart, { asset: "ETH", strikesUsd: [], strikesLabel: null });
		// The ref the effect writes into; the runner does not attach real hosts.
		const found = h.find(n => n.props && n.props.ref);
		for (const node of found) if (node.props.ref && "current" in node.props.ref) node.props.ref.current = element;
		await h.settle();
		console.log("RESULT:" + JSON.stringify({
			charts: calls.createChart.length,
			fontFamily: calls.createChart[0]?.layout?.fontFamily ?? null,
			fontsAwaited: calls.fontsAwaited,
		}));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: APP,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	expect(JSON.parse(line.slice("RESULT:".length))).toEqual({
		charts: 1,
		fontFamily: 'Manrope, "Manrope Fallback", -apple-system, sans-serif',
		fontsAwaited: 1,
	});
});

/**
 * ── The screen-reader alternative, and the DOM split that makes it possible ──
 *
 * A canvas has no readable content. Before this, `.chart-box` was the library's
 * host AND React's parent for the thesis markers, and nothing named the picture
 * at all — the chart was an unlabelled blank to anyone not looking at it.
 *
 * `role="img"` names it, and it also HIDES the element's subtree from assistive
 * technology, so the markers (real focusable buttons) must not live inside it.
 * Hence the split: `.chart-canvas` is the library's, the markers are siblings.
 * Both halves are asserted below, because a label added on the wrong element
 * would read as a fix while silently removing the markers from the a11y tree.
 */
function runChart(body: string) {
	const script = String.raw`
		import { plugin } from "bun";
		const calls = { createChart: [], timeouts: [], fetches: [] };
		const chart = {
			addSeries: () => ({ setData() {}, createPriceLine() {}, priceToCoordinate: () => 100 }),
			timeScale: () => ({
				fitContent() {}, timeToCoordinate: () => 50,
				subscribeVisibleTimeRangeChange() {}, unsubscribeVisibleTimeRangeChange() {},
			}),
			remove() {}, applyOptions() {}, subscribeCrosshairMove() {},
		};
		plugin({ name: "chart-a11y-probe", setup(build) {
			build.module("lightweight-charts", () => ({ exports: {
				createChart: (host, options) => { calls.createChart.push(options); return chart; },
				CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: "solid" },
			}, loader: "object" }));
		}});
		const element = { style: {}, getBoundingClientRect: () => ({ width: 600, height: 260 }) };
		globalThis.document = {
			documentElement: {}, body: {},
			fonts: { get ready() { return Promise.resolve(); } },
		};
		globalThis.getComputedStyle = (node) => node === globalThis.document.body
			? { fontFamily: "Manrope" }
			: { getPropertyValue: () => "" };
		globalThis.ResizeObserver = class { observe() {} disconnect() {} };
		// The component asks for its own deadline; the probe records the number
		// it asked for and hands back a signal that fires fast enough to assert.
		const realTimeout = AbortSignal.timeout.bind(AbortSignal);
		AbortSignal.timeout = (ms) => { calls.timeouts.push(ms); return realTimeout(5); };
		` + body + String.raw`
		const { mount } = await import("./src/test/hook-runner.ts");
		const { PriceChart } = await import("./src/components/market/price-chart.tsx");
		const { CHART_TIMEOUT_MS, CHART_SOURCE_NOTE, CHART_WINDOW_LABEL } = await import("./src/lib/chart/klines.ts");
		const h = mount(PriceChart, {
			asset: "ETH",
			strikesUsd: ["3400", "3600"],
			strikesLabel: "3,400 / 3,600",
			theses: [{
				id: "t1", slug: "s1", createdAt: new Date(1788044400 * 1000).toISOString(),
				headline: "calling it", handleLabel: "@thesis-0001", avatarSeed: "seed",
				direction: "bull", likes: 3,
			}],
		});
		const found = h.find(n => n.props && n.props.ref);
		for (const node of found) if (node.props.ref && "current" in node.props.ref) node.props.ref.current = element;
		// Real time has to pass: the deadline under test is a real timer, and
		// settle() returns as soon as nothing is in flight, which for a fetch
		// that never resolves is immediately.
		await new Promise((resolve) => setTimeout(resolve, 40));
		await h.settle();
		const labelled = h.find(n => n.props && n.props.role === "img");
		const markers = h.find(n => n.type === "button" && typeof n.props["aria-label"] === "string");
		console.log("RESULT:" + JSON.stringify({
			labelledCount: labelled.length,
			label: labelled[0]?.props["aria-label"] ?? null,
			// role="img" hides its subtree: the element must have no children.
			labelledHasChildren: labelled[0]?.props.children !== undefined,
			markerLabels: markers.map(m => m.props["aria-label"]),
			text: h.text(),
			timeouts: calls.timeouts,
			expectedTimeout: CHART_TIMEOUT_MS,
			expectedNote: CHART_SOURCE_NOTE,
			expectedWindow: CHART_WINDOW_LABEL,
			charts: calls.createChart.length,
		}));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: APP,
		env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("RESULT:".length)) as Record<string, unknown>;
}

/** A proxy that answers with one real candle. */
const HEALTHY_FETCH = String.raw`
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => ({ candles: [
				{ time: 1788040800, open: 1, high: 2, low: 1, close: 2 },
				{ time: 1788044400, open: 2, high: 3, low: 2, close: 3 },
			] }),
		});
`;

test("the drawn chart carries a name, and the markers stay outside it", () => {
	const result = runChart(HEALTHY_FETCH);
	expect(result.charts).toBe(1);
	// Exactly one named picture, not one per marker.
	expect(result.labelledCount).toBe(1);
	expect(result.labelledHasChildren).toBe(false);
	const label = String(result.label);
	// It says which asset, over what window, which levels, and where the
	// prices came from — the four things the picture itself says.
	expect(label).toContain("ETH price");
	expect(label).toContain(String(result.expectedWindow));
	expect(label).toContain("3,400 / 3,600");
	expect(label).toContain(String(result.expectedNote));
	// The markers are still their own reachable controls, not swallowed by the
	// image role.
	expect(result.markerLabels).toEqual(["1 thesis on this candle by @thesis-0001"]);
});

test("a proxy that never answers ends in the empty state, not a permanent blank", () => {
	// Before the deadline the phase stayed "loading" forever: an empty box with
	// no message and no way to know it had failed.
	const result = runChart(String.raw`
		globalThis.fetch = () => new Promise(() => {});
	`);
	expect(result.timeouts).toEqual([result.expectedTimeout]);
	expect(String(result.text)).toContain("Price history is unavailable right now.");
	// Nothing was drawn, so nothing claims to be a picture.
	expect(result.labelledCount).toBe(0);
});

test("the empty box is not labelled as a picture that was never drawn", () => {
	const result = runChart(String.raw`
		globalThis.fetch = async () => ({ ok: true, json: async () => ({ candles: [] }) });
	`);
	expect(result.charts).toBe(0);
	expect(result.labelledCount).toBe(0);
	expect(String(result.text)).toContain("Price history is unavailable right now.");
});

/**
 * ── The token fallbacks ─────────────────────────────────────────────────────
 *
 * The chart reads its colours from the page's CSS variables and carries a hex
 * literal per variable as the fallback. H-1 reported one that had gone stale —
 * `--surface2` was `#201d2d` in the chart and `#1a1922` in the app — and left
 * it as "one line for whoever owns the chart next", because it is invisible
 * while the variable resolves and only shows itself when it does not.
 *
 * A one-off correction rots again the next time the palette moves, so this
 * derives BOTH sides from the files and compares them: every fallback in the
 * component must equal the token's own value in `index.css`.
 */
test("every colour fallback in the chart equals the token it stands in for", async () => {
	const component = await Bun.file(`${APP}src/components/market/price-chart.tsx`).text();
	const css = await Bun.file(`${APP}src/index.css`).text();

	const fallbacks = [...component.matchAll(/token\("(--[a-z0-9-]+)",\s*"(#[0-9a-fA-F]{3,8})"\)/g)].map(
		(match) => [match[1] as string, (match[2] as string).toLowerCase()] as const,
	);
	// A regex that matched nothing would make this test pass vacuously.
	expect(fallbacks.length).toBeGreaterThanOrEqual(7);

	const drift: string[] = [];
	for (const [name, fallback] of fallbacks) {
		const declared = css.match(new RegExp(`^\\s*${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "m"));
		if (declared === null) {
			drift.push(`${name} is not declared in index.css`);
			continue;
		}
		const value = (declared[1] as string).toLowerCase();
		if (value !== fallback) drift.push(`${name}: chart says ${fallback}, index.css says ${value}`);
	}
	expect(drift).toEqual([]);
});

/**
 * The market page's own docblock said "NO PRICE CHART" while mounting one, for
 * two commits. A comment that states the opposite of the code beneath it is
 * read by the next person as the rule, so it is pinned here: the page either
 * has no chart, or it does not claim to have none.
 */
test("the market page does not document the absence of a chart it renders", async () => {
	const page = await Bun.file(`${APP}src/app/m/[asset]/page.tsx`).text();
	if (!page.includes("<PriceChart")) return; // no chart mounted; nothing to contradict
	expect(page).not.toContain("NO PRICE CHART");
	// And it must say where the prices come from, because that is the whole
	// condition the chart is kept under.
	expect(page).toContain("Binance");
});
