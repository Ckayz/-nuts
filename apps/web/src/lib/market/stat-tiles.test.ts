/**
 * The market header's stat row (docs/design/FOMO-DIGEST.md, "Token page
 * layout"). These pin BOTH halves of the rule: the four tiles the page draws,
 * and the ones that must stay out because the API publishes nothing honest to
 * put in them. A tile added from a value we do not have is the failure mode
 * these guard against, so the absences are asserted as hard as the presences.
 */
import { expect, test } from "bun:test";
import { marketStatTiles } from "./stat-tiles";
import { marketBySlug, thesesByMarket } from "@/lib/view-data";

const market = marketBySlug("btc")!;

test("without book stats the row is only what the page already holds", () => {
	const tiles = marketStatTiles(market, 7);
	expect(tiles.map((tile) => tile.label)).toEqual(["Spot", "Structures", "Expiries", "Theses"]);
});

test("implied vol and calls/puts appear only when the book supplies them", () => {
	const tiles = marketStatTiles(market, 7, { impliedVol: 0.385, calls: 86, puts: 61 });
	expect(tiles.map((tile) => tile.label)).toEqual([
		"Spot",
		"Implied vol",
		"Structures",
		"Expiries",
		"Calls / Puts",
		"Theses",
	]);
	expect(tiles.find((tile) => tile.label === "Implied vol")?.value).toBe("38.5%");
	expect(tiles.find((tile) => tile.label === "Calls / Puts")?.value).toBe("86 / 61");
});

test("a market with no quoted volatility shows no tile, never 0.0%", () => {
	// "0.0%" would read as "this market has no volatility", which the book does
	// not claim. MEASURED: PAXG reports curVol 0 and quotes no orders.
	for (const iv of [null, undefined, 0]) {
		const tiles = marketStatTiles(market, 7, { impliedVol: iv as number | null });
		expect(tiles.some((tile) => tile.label === "Implied vol")).toBe(false);
	}
});

test("every value is read from the market, never recomputed", () => {
	const tiles = marketStatTiles(market, 7);
	expect(tiles[0]?.value).toBe(market.spotUsd.usd);
	expect(tiles[1]?.value).toBe(String(market.structureCount));
	expect(tiles[2]?.value).toBe(String(market.expiryCount));
	expect(tiles[3]?.value).toBe("7");
});

test("the tagged-post count is the caller's, not a fixture's", () => {
	expect(marketStatTiles(market, 0)[3]?.value).toBe("0");
	expect(marketStatTiles(market, thesesByMarket("btc").length)[3]?.value).toBe(
		String(thesesByMarket("btc").length),
	);
});

test("no tile is invented from data Thetanuts does not publish", () => {
	const labels = marketStatTiles(market, 3).map((tile) => tile.label);
	// 24H change needs price history; market cap, volume and holders need a
	// token. Liquidity exists only per structure, never for the market.
	for (const absent of ["24H change", "Change", "Market cap", "Vol.", "Volume", "Holders", "Liquidity"]) {
		expect(labels).not.toContain(absent);
	}
});

test("no tile value is ever blank, which is what a missing figure would print as", () => {
	for (const count of [0, 1, 42]) {
		for (const tile of marketStatTiles(market, count)) {
			expect(tile.label.trim().length).toBeGreaterThan(0);
			expect(tile.value.trim().length).toBeGreaterThan(0);
		}
	}
});
