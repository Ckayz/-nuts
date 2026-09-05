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
