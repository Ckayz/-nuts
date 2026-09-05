import { expect, test } from "bun:test";
import { loadFonts } from "./og-fonts";

test("OG loads Manrope font data for both weights using supported sources", async () => {
	const requested: string[] = [];
	const reader = (async (url: string | URL | Request) => {
		const href = String(url); requested.push(href);
		return href.includes("googleapis") ? new Response([400, 700].map(weight => `@font-face { font-family: 'Manrope'; font-weight: ${weight}; src: url(https://fonts.gstatic.com/manrope-${weight}.ttf) format('truetype'); }`).join("\n")) : new Response(new Uint8Array([1, 2, 3]));
	}) as typeof fetch;
	const fonts = await loadFonts(reader);
	expect(fonts.map(font => [font.name, font.weight, font.data.byteLength])).toEqual([["Manrope", 400, 3], ["Manrope", 700, 3]]);
	expect(requested).toHaveLength(3);
});
