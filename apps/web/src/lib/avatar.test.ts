import { expect, test } from "bun:test";
import { avatarDataUri } from "./avatar";

test("same avatar seed produces the same data URI", () => {
	expect(avatarDataUri("wallet-a")).toBe(avatarDataUri("wallet-a"));
});
test("different avatar seeds produce different data URIs", () => {
	expect(avatarDataUri("wallet-a")).not.toBe(avatarDataUri("wallet-b"));
});
test("generated SVG has no active or externally loaded content", () => {
	for (const seed of ["wallet-a", "wallet-b", '<script onload="bad">', 'javascript:']) {
		const uri = avatarDataUri(seed);
		expect(uri).toStartWith("data:image/svg+xml;utf8,");
		const svg = decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
		expect(svg).toStartWith("<svg");
		expect(svg).not.toMatch(/<script|\bon[a-z]+\s*=|javascript:|<image|href\s*=\s*["']http|<foreignObject/i);
	}
});
