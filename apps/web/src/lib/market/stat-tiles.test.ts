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

/**
 * D-R3-3 (Astra lane D, pass 3). `marketBookStats()` takes EVERY live order for
 * the asset — all strikes, all expiries — and returns their unweighted median
 * iv, and the tile called it simply "Implied vol". The reviewer's pure probe:
 *   {"inputIv":[0.1,0.9],"display":"50.0%","aggregationTagged":false}
 *
 * The formula is unchanged (a rule nobody approved must not be swapped for a
 * second rule nobody approved); the tile now carries the same `TodoOwner`
 * marker every other unapproved number carries, and both the cohort and the
 * statistic are written down where the formula lives.
 */
test("D-R3-3: the implied-vol tile is marked as an unapproved aggregation, and only it", async () => {
	const tiles = marketStatTiles(market, 7, { impliedVol: 0.385, calls: 2, puts: 1 });
	expect(tiles.filter((tile) => tile.todoOwner === true).map((tile) => tile.label)).toEqual(["Implied vol"]);
	// The wording is untouched: the marker is the whole change.
	expect(tiles.find((tile) => tile.label === "Implied vol")?.value).toBe("38.5%");
});

test("D-R3-3: the cohort and the statistic are named where the formula lives", async () => {
	const source = await Bun.file(new URL("./implied-vol.ts", import.meta.url).pathname).text();
	const summaries = await Bun.file(new URL("./summaries.ts", import.meta.url).pathname).text();
	expect(source).toContain("TODO-OWNER: the COHORT");
	expect(source).toContain("TODO-OWNER: the STATISTIC");
	expect(summaries).toContain("D-R3-3");
	// And the formula really is still the unweighted MEDIAN of every order. Three
	// values on purpose: with two, the median and the mean coincide and a mutant
	// that swapped one for the other would pass (measured — it did).
	const { medianImpliedVol } = await import("./implied-vol");
	const ivs = [{ greeks: { iv: 0.1 } }, { greeks: { iv: 0.2 } }, { greeks: { iv: 0.9 } }];
	expect({ median: medianImpliedVol(ivs), mean: (0.1 + 0.2 + 0.9) / 3 }).toEqual({
		median: 0.2,
		mean: 0.4000000000000001,
	});
});

/** The marker really reaches the page, not just the data. */
test("D-R3-3: the market page renders the marker beside that tile", async () => {
	const page = await Bun.file(new URL("../../app/m/[asset]/page.tsx", import.meta.url).pathname).text();
	expect(page).toContain("{tile.todoOwner ? <TodoOwner /> : null}");
});
