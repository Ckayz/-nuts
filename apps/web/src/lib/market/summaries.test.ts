import { expect, test } from "bun:test";
import { busiestMarketSlug, readMarketSummaries } from "./summaries";
import { marketSummaries } from "../view-data";
import { amount } from "../display";
import type { MarketSummary } from "../display-types";

test("production market selection uses a live set different from fixtures", async () => {
	const result = await readMarketSummaries(true, async () => ({
		assets: [{ asset: "PAXG", slug: "paxg", spotUsd: 3500, structures: [] }], fetchedAt: new Date(0),
	}), async () => { throw new Error("production read fixtures"); });
	expect(result.markets.map(row => row.asset)).toEqual(["PAXG"]);
	expect(result.markets.map(row => row.asset)).not.toEqual(marketSummaries.map(row => row.asset));
	expect(result.markets[0]?.spotUsd.usd2).toBe("$3,500.00");
	expect(result.markets[0]?.changeLabel).toBe("");
});
test("book rejection yields unavailable, never fixtures", async () => {
	expect(await readMarketSummaries(true, async () => { throw new Error("offline"); }, async () => marketSummaries)).toEqual({ markets: [], unavailable: true, navMarketSlug: undefined });
});
test("mock selection retains fixtures without a live read", async () => {
	expect(await readMarketSummaries(false, async () => { throw new Error("mock read network"); }, async () => marketSummaries)).toEqual({ markets: marketSummaries, unavailable: false, navMarketSlug: marketSummaries[0]?.slug });
});

test("NODE_ENV=production DATA_SOURCE=db routes the shared boundary to the live book", () => {
	const script = `
		import { plugin } from "bun";
		globalThis.fetch = async () => { throw new Error("unexpected network"); };
		plugin({ name: "production-market-source", setup(build) {
			build.module("next/server", () => ({ loader: "object", exports: { connection: async () => {} } }));
			build.module("@/lib/market/live", () => ({ loader: "object", exports: { getLiveMarkets: async () => ({ assets: [{ asset: "PAXG", slug: "paxg", spotUsd: 3500, structures: [] }], fetchedAt: new Date(0) }) } }));
		}});
		const { marketSummariesData } = await import("./src/lib/market/summaries.ts");
		console.log(JSON.stringify(await marketSummariesData()));
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		// A fully valid production env: A-C5 made SKIP_ENV_VALIDATION inert in
		// production, so the case has to satisfy the schema to reach the code it
		// is about. The URL is a loopback fixture that is never connected to —
		// `@/lib/market/live` is stubbed above and `fetch` throws.
		env: {
			...process.env,
			NODE_ENV: "production",
			DATA_SOURCE: "db",
			DATABASE_URL: "postgresql://user:pw@127.0.0.1:5432/fixture",
			SESSION_SECRET: "x".repeat(32),
			SKIP_ENV_VALIDATION: "1",
		}, stdout: "pipe", stderr: "pipe",
	});
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	const result = JSON.parse(child.stdout.toString());
	expect(result.unavailable).toBe(false);
	expect(result.markets.map((row: { asset: string }) => row.asset)).toEqual(["PAXG"]);
});

/**
 * Owner decision 8 (2026-09-06). "Markets" opens the market with the MOST OPEN
 * ORDERS, ties breaking on the earlier ticker.
 *
 * Every case is a fake book, so nothing here depends on the live OptionBook.
 * `summary` builds only the two fields the rule reads.
 */
const summary = (asset: string): MarketSummary => ({
	slug: asset.toLowerCase(), asset, name: asset,
	spotUsd: amount(null), changeLabel: "", changeClass: "",
});

test("the Markets target is the market with the most open orders", () => {
	const markets = [summary("AVAX"), summary("ETH"), summary("BTC")];
	expect(busiestMarketSlug(markets, [
		{ asset: "AVAX", orders: 3 }, { asset: "ETH", orders: 128 }, { asset: "BTC", orders: 147 },
	])).toBe("btc");
	// Depth, never the summaries' own (alphabetical) order: AVAX is first in the
	// list and would win under the rule this replaced.
	expect(markets[0]?.slug).toBe("avax");
});

test("a tie on order count breaks on the EARLIER ticker", () => {
	// BTC and ETH both 128: B < E, so BTC. This is the case that separates the
	// rule from "whichever the book listed first" — the list is AVAX, ETH, BTC.
	expect(busiestMarketSlug([summary("AVAX"), summary("ETH"), summary("BTC")], [
		{ asset: "AVAX", orders: 3 }, { asset: "ETH", orders: 128 }, { asset: "BTC", orders: 128 },
	])).toBe("btc");
});

test("no depth information leaves the nav on the first market, never on nothing", () => {
	expect(busiestMarketSlug([summary("AVAX"), summary("ETH")], [])).toBe("avax");
	// A depth row for an asset the book no longer summarises cannot select a
	// market that is not there.
	expect(busiestMarketSlug([summary("AVAX")], [{ asset: "SOL", orders: 900 }])).toBe("avax");
	expect(busiestMarketSlug([], [{ asset: "SOL", orders: 900 }])).toBeUndefined();
});

test("readMarketSummaries carries the busiest slug, and a broken depth read does not fail the layout", async () => {
	const book = {
		assets: [
			{ asset: "AVAX", slug: "avax", spotUsd: 20, structures: [] },
			{ asset: "BTC", slug: "btc", spotUsd: 79000, structures: [] },
		],
		fetchedAt: new Date(0),
	};
	const ranked = await readMarketSummaries(true, async () => book,
		async () => { throw new Error("production read fixtures"); },
		async () => [{ asset: "AVAX", orders: 2 }, { asset: "BTC", orders: 40 }]);
	expect(ranked.navMarketSlug).toBe("btc");
	const degraded = await readMarketSummaries(true, async () => book,
		async () => { throw new Error("production read fixtures"); },
		async () => { throw new Error("depth read failed"); });
	expect({ slug: degraded.navMarketSlug, count: degraded.markets.length, unavailable: degraded.unavailable })
		.toEqual({ slug: "avax", count: 2, unavailable: false });
});
