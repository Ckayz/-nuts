/**
 * The Open Graph cards must make NO outbound request. Vendored fonts removed
 * one; this file proves the emoji path removed the other.
 *
 * Two independent measurements per claim: the pure function's output, and a
 * REAL `ImageResponse` render with `globalThis.fetch` stubbed and counted.
 */
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { EMOJI_SEQUENCE_SOURCE, ogText, ogTextOrNull, SATORI_EMOJI_SOURCE } from "./og-text";

test("emoji are removed and the words are kept", () => {
	expect(ogText("BTC 🚀")).toBe("BTC");
	expect(ogText("🚀 BTC breaks out")).toBe("BTC breaks out");
	expect(ogText("BTC 🚀 breaks out")).toBe("BTC breaks out");
	expect(ogText("ETH ✅ up")).toBe("ETH up");
	// Flag (regional-indicator pair), keycap, skin-tone modifier, ZWJ family.
	expect(ogText("🇺🇸 rally")).toBe("rally");
	expect(ogText("1️⃣ pick")).toBe("pick");
	expect(ogText("👍🏽 nice")).toBe("nice");
	expect(ogText("👨‍👩‍👧‍👦 family")).toBe("family");
	expect(ogText("🚀🚀🚀")).toBe("");
});

test("the numbers and words a card is made of survive untouched", () => {
	for (const value of [
		"BTC put spread · 78,000 / 74,000 P",
		"+$612.00",
		"−$2,000",
		"0.0126",
		"Bull · buy the spread",
		"11 Sep 26 08:00 UTC",
		"café Ünicode 中文 العربية",
		"@merkle_mike",
		"0x7c44…5dEd",
		"#1 pick * note",
	]) {
		expect(ogText(value)).toBe(value);
	}
	// Line breaks are left alone; only runs of spaces/tabs collapse.
	expect(ogText("one\ntwo")).toBe("one\ntwo");
});

test("the second pass exists for pictographs Satori's own pattern does NOT match", () => {
	// Reserved Extended_Pictographic code points (measured by scanning U+0000..U+1FFFF
	// against both patterns) are not `\p{Emoji}`, so Satori never fetches a twemoji
	// for them — it draws tofu with a font that has no glyph. They are stripped by
	// the second pass, which is the only reason that pass is here.
	const satori = new RegExp(SATORI_EMOJI_SOURCE, "u");
	for (const codePoint of [0x1f02c, 0x1f094, 0x1f09b]) {
		const char = String.fromCodePoint(codePoint);
		expect(/\p{Extended_Pictographic}/u.test(char)).toBe(true);
		expect(satori.test(char)).toBe(false); // no CDN call, but no glyph either
		expect(ogText(`BTC ${char}`)).toBe("BTC");
	}
});

test("ogTextOrNull passes null through and empties to null", () => {
	expect(ogTextOrNull(null)).toBeNull();
	expect(ogTextOrNull(undefined)).toBeNull();
	expect(ogTextOrNull("🚀")).toBeNull();
	expect(ogTextOrNull("BTC 🚀")).toBe("BTC");
});

test("nothing that survives is still an emoji to Satori's OWN detector", () => {
	const detector = new RegExp(SATORI_EMOJI_SOURCE, "u");
	for (const value of ["BTC 🚀", "🇺🇸 rally", "1️⃣ pick", "👨‍👩‍👧‍👦 family", "👍🏽 nice", "☀️ hot", "™ mark"]) {
		expect(detector.test(value)).toBe(true); // the input WOULD have fetched
		expect(detector.test(ogText(value))).toBe(false); // the output cannot
	}
});

test("the matcher IS the installed Satori bundle's own pattern, re-derived from its bytes", () => {
	for (const file of ["index.edge.js", "index.node.js"]) {
		const bundle = readFileSync(
			new URL(`../../node_modules/next/dist/compiled/@vercel/og/${file}`, import.meta.url),
			"utf8",
		);
		// Satori builds its detector from two String.raw templates whose local
		// names are minified. Pull both out of the bundle and expand them, then
		// compare with what this module uses — a drift in either direction fails.
		const sequence = bundle.match(/var (\w+) = \w+`(\\p\{Emoji\}[^`]*)`;/);
		expect(sequence).not.toBeNull();
		const [, sequenceName, sequenceSource] = sequence!;
		expect(sequenceSource).toBe(EMOJI_SEQUENCE_SOURCE);

		const detector = bundle.match(/var \w+ = \(\) => new RegExp\(\w+`(\\p\{RI\}[^`]*)`, "gu"\);/);
		expect(detector).not.toBeNull();
		const expanded = detector![1]!.split(`\${${sequenceName}}`).join(sequenceSource!);
		expect(expanded).toBe(SATORI_EMOJI_SOURCE);

		// The reason this file exists.
		expect(bundle).toContain("https://cdn.jsdelivr.net/gh/twitter/twemoji");
	}
});

/**
 * A REAL `ImageResponse` render cannot run inside `bun test`: `next/og` loads
 * its yoga/resvg WebAssembly through a `?module` import that bun's loader hands
 * over as text ("module doesn't start with \\0asm"). The render was therefore
 * measured OUT of band, under node 24.10.0, with `globalThis.fetch` counted and
 * only the CDN faked (next/og fetches its own wasm through the same function):
 *
 *   "BTC \u{1F680}" -> 2 fetches, one of them
 *                      https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f680.svg
 *   ogText("BTC \u{1F680}") = "BTC" -> 0 fetches, same 1817-byte PNG
 *
 * The in-suite proof of the same property is the test above: `loadEmoji` is
 * only ever reached for a segment Satori's detector classified as an emoji, and
 * no output of `ogText` is classified that way.
 */
test("both OG routes send every interpolated string through the stripper", () => {
	for (const path of ["../app/t/[slug]/opengraph-image.tsx", "../app/p/[id]/opengraph-image.tsx"]) {
		const source = readFileSync(new URL(path, import.meta.url), "utf8");
		expect(source).toContain('from "@/lib/og-text"');
		// Every JSX child expression (a `{...}` that directly follows a `>`,
		// newlines and indentation included) that reads a value off the page data
		// must go through the stripper.
		const children = [...source.matchAll(/>\s*\{([^{}]*)\}/g)].map((match) => match[1]!);
		const values = children.filter((expression) => /\b(card|thesis|pnl|stat)\./.test(expression));
		expect(values.length).toBeGreaterThan(3);
		expect(values.filter((expression) => !/ogText(OrNull)?\(/.test(expression))).toEqual([]);
	}
});
