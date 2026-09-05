import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { assetIconPath } from "./asset-icon";

const symbols = ["btc", "eth", "sol", "doge", "xrp", "bnb", "paxg", "avax"];
test("the eight vendored display symbols resolve case-insensitively", () => {
	for (const symbol of symbols) {
		expect(assetIconPath(symbol)).toBe(`/asset-icons/${symbol}.svg`);
		expect(assetIconPath(symbol.toUpperCase())).toBe(assetIconPath(symbol));
	}
});
test("unknown assets and paths preserve the monogram fallback", () => {
	for (const symbol of ["FOO", "", "../btc", "btc.svg", " BTC"]) expect(assetIconPath(symbol)).toBeNull();
});
test("every returned logo path exists in public", () => {
	for (const symbol of symbols) expect(existsSync(new URL(`../../../public${assetIconPath(symbol)}`, import.meta.url))).toBe(true);
});
