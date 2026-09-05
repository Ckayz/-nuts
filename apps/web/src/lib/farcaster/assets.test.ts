import { expect, test } from "bun:test";
import { rankAssets } from "./assets";

/**
 * The book MEASURED 2026-09-05T18:29Z: 362 live orders. Every test below is
 * pinned to that shape or to a hazard observed in the code it reads from.
 */
const BOOK = [
	{ asset: "AVAX", orders: 16 },
	{ asset: "BNB", orders: 33 },
	{ asset: "BTC", orders: 147 },
	{ asset: "ETH", orders: 123 },
	{ asset: "SOL", orders: 30 },
	{ asset: "XRP", orders: 13 },
];

test("the measured book ranks BTC then ETH", () => {
	expect(rankAssets(BOOK, 2)).toEqual(["BTC", "ETH"]);
	expect(rankAssets(BOOK, 4)).toEqual(["BTC", "ETH", "BNB", "SOL"]);
});

test("the ranking is by depth, not alphabetical", () => {
	// `getLiveMarkets` sorts alphabetically, which would put AVAX first. If this
	// ever returns AVAX at N=1, the rail is following the wrong order.
	expect(rankAssets(BOOK, 1)).toEqual(["BTC"]);
	expect(rankAssets(BOOK, 1)[0]).not.toBe("AVAX");
});

test("an unmapped price feed can never become a search query", () => {
	// packages/thetanuts/src/markets.ts:34 names an unmapped feed
	// `UNKNOWN_FEED:0x…`, and getAvailableAssets only skips EMPTY assets, so
	// that string reaches here. Unfiltered it would be sent to Neynar verbatim.
	const rows = [{ asset: "UNKNOWN_FEED:0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", orders: 999 }, ...BOOK];
	expect(rankAssets(rows, 2)).toEqual(["BTC", "ETH"]);
});

test("only ticker-shaped assets survive", () => {
	const rows = [
		{ asset: "btc", orders: 500 },
		{ asset: "TOOLONGTICKER", orders: 400 },
		{ asset: "", orders: 300 },
		{ asset: "E", orders: 200 },
		{ asset: "BTC", orders: 10 },
	];
	expect(rankAssets(rows, 5)).toEqual(["BTC"]);
});

test("an asset with no live orders is not a market", () => {
	expect(rankAssets([{ asset: "DOGE", orders: 0 }, { asset: "BTC", orders: 1 }], 2)).toEqual(["BTC"]);
});

test("ties break alphabetically, so the rail cannot reshuffle between renders", () => {
	const tied = [{ asset: "ETH", orders: 40 }, { asset: "BTC", orders: 40 }, { asset: "SOL", orders: 9 }];
	expect(rankAssets(tied, 2)).toEqual(["BTC", "ETH"]);
	expect(rankAssets(tied, 2)).toEqual(rankAssets(tied, 2));
});

test("an empty book yields nothing and never a default", () => {
	expect(rankAssets([], 2)).toEqual([]);
	expect(rankAssets(BOOK, 0)).toEqual([]);
	expect(rankAssets(BOOK, -1)).toEqual([]);
});

test("ranking does not mutate the caller's rows", () => {
	const rows = [...BOOK];
	rankAssets(rows, 2);
	expect(rows.map((r) => r.asset)).toEqual(BOOK.map((r) => r.asset));
});
