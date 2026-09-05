/// <reference types="bun" />
/**
 * D-R3-m3 (Astra lane D, pass 3). Both share images are drawn by Satori, which
 * resolves no CSS variables, so every colour in them is a literal — and both had
 * drifted to an older palette while `index.css` moved on:
 *
 *   OG routes      #070511 / #181623 / #201d2d
 *   index.css      #060510 / #12111a / #1a1922
 *
 * A shared card therefore did not match the page it links to. This reads the
 * tokens out of `index.css` and refuses any hex in either OG route that is not
 * one of them, so the next drift fails here instead of in a screenshot.
 */
import { expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;

async function tokens(): Promise<Map<string, string>> {
	const css = await Bun.file(`${ROOT}index.css`).text();
	const block = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
	const found = new Map<string, string>();
	for (const [, name, value] of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
		found.set(name!, value!.trim());
	}
	return found;
}

/** Every hex literal in a file, lowercased, deduplicated. */
async function hexes(path: string): Promise<string[]> {
	const source = await Bun.file(path).text();
	return [...new Set([...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]!.toLowerCase()))].sort();
}

const OG_ROUTES = ["app/p/[id]/opengraph-image.tsx", "app/t/[slug]/opengraph-image.tsx"];

test("the tokens this pins really are in index.css", async () => {
	const found = await tokens();
	// Guards the whole file: a parse that found nothing would make every
	// assertion below pass vacuously.
	expect({
		bg: found.get("bg"),
		surface: found.get("surface"),
		surface2: found.get("surface2"),
		line: found.get("line"),
		text: found.get("text"),
		accent: found.get("accent"),
	}).toEqual({
		bg: "#060510",
		surface: "#12111a",
		surface2: "#1a1922",
		line: "#282438",
		text: "#f7f7f7",
		accent: "#3f6fe0",
	});
});

test("every colour in both share images is one of the app's own tokens", async () => {
	const palette = new Set(
		[...(await tokens()).values()].filter((value) => /^#[0-9a-f]{6}$/i.test(value)).map((v) => v.toLowerCase()),
	);
	// `#ffffff` is `--accent-ink`, which the token map already carries.
	for (const route of OG_ROUTES) {
		const used = await hexes(`${ROOT}${route}`);
		expect({ route, unknown: used.filter((hex) => !palette.has(hex)) }).toEqual({ route, unknown: [] });
	}
});

test("the ground, the card surface and the second surface are pinned by value", async () => {
	const position = await Bun.file(`${ROOT}app/p/[id]/opengraph-image.tsx`).text();
	const thread = await Bun.file(`${ROOT}app/t/[slug]/opengraph-image.tsx`).text();
	expect(position).toContain('const BG = "#060510";');
	expect(position).toContain('const CARD = "#12111a";');
	expect(position).toContain('const SURFACE_2 = "#1a1922";');
	expect(thread).toContain('background: "#060510"');
	expect(thread).toContain('background: "#12111a"');
	// The old palette must be extinct in both.
	for (const [name, source] of [["position", position], ["thread", thread]] as const) {
		expect({ name, stale: ["#070511", "#181623", "#201d2d"].filter((hex) => source.includes(hex)) }).toEqual({
			name,
			stale: [],
		});
	}
});

/** Both routes still load the vendored Manrope; the fold changed colours only. */
test("both share images still use the vendored Manrope", async () => {
	for (const route of OG_ROUTES) {
		const source = await Bun.file(`${ROOT}${route}`).text();
		expect({ route, fonts: source.includes("ogFonts"), face: source.includes('"Manrope"') }).toEqual({
			route,
			fonts: true,
			face: true,
		});
	}
});
