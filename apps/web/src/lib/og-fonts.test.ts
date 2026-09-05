import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fontPath, loadFonts } from "./og-fonts";

/** The four bytes every TrueType file opens with (sfnt version 1.0). */
const TRUETYPE_MAGIC = [0x00, 0x01, 0x00, 0x00];

test("OG fonts come from the vendored files, not the network", async () => {
	// A reader that would fail loudly if anything asked for a URL.
	const asked: string[] = [];
	const fonts = await loadFonts(async path => {
		asked.push(path);
		expect(path.startsWith("http")).toBe(false);
		return readFile(path);
	});

	expect(fonts.map(font => [font.name, font.weight, font.style])).toEqual([
		["Manrope", 400, "normal"],
		["Manrope", 700, "normal"],
	]);
	expect(asked).toEqual([fontPath(400), fontPath(700)]);
	for (const font of fonts) {
		expect(font.data.byteLength).toBeGreaterThan(10_000);
		expect([...new Uint8Array(font.data).slice(0, 4)]).toEqual(TRUETYPE_MAGIC);
	}
	// The two weights are different files, not the same one read twice.
	expect(fonts[0]?.data.byteLength).not.toBe(fonts[1]?.data.byteLength);
});

test("the real vendored paths exist and are the weights Satori is told they are", async () => {
	for (const weight of [400, 700] as const) {
		const bytes = await readFile(fontPath(weight));
		expect([...bytes.subarray(0, 4)]).toEqual(TRUETYPE_MAGIC);
		// OS/2 `usWeightClass` is at offset 4 of the OS/2 table; find the table.
		const tables = bytes.readUInt16BE(4);
		let weightClass: number | undefined;
		for (let i = 0; i < tables; i++) {
			const entry = 12 + 16 * i;
			if (bytes.toString("latin1", entry, entry + 4) === "OS/2") {
				weightClass = bytes.readUInt16BE(bytes.readUInt32BE(entry + 8) + 4);
			}
		}
		expect(weightClass).toBe(weight);
	}
});

test("a missing or empty font file is reported, never silently blank", async () => {
	await expect(loadFonts(async () => Buffer.alloc(0))).rejects.toThrow(/empty/);
	await expect(loadFonts(async () => { throw new Error("ENOENT"); })).rejects.toThrow("ENOENT");
});
