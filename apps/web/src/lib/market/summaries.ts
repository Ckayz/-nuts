import "server-only";
import { connection } from "next/server";
import { usingDatabase } from "../data/source";
import type { MarketSummary } from "../display-types";
import type { LiveBook } from "./live";
import type { FeedUnavailable } from "../thetanuts/types";

export interface MarketSummariesData {
	markets: MarketSummary[];
	unavailable: boolean;
}

/** Injected reads keep production-mode source selection testable without a network. */
export async function readMarketSummaries(
	databaseMode: boolean,
	live: () => Promise<LiveBook | FeedUnavailable>,
	fixtures: () => Promise<MarketSummary[]>,
): Promise<MarketSummariesData> {
	if (!databaseMode) return { markets: await fixtures(), unavailable: false };
	try {
		const book = await live();
		if ("error" in book) return { markets: [], unavailable: true };
		const { amount } = await import("../display");
		return { markets: book.assets.map(asset => ({
			slug: asset.slug, asset: asset.asset, name: asset.asset,
			spotUsd: amount(asset.spotUsd?.toFixed(2) ?? null), changeLabel: "", changeClass: "",
		})), unavailable: false };
	} catch {
		return { markets: [], unavailable: true };
	}
}

export async function marketSummariesData(): Promise<MarketSummariesData> {
	const databaseMode = usingDatabase();
	if (databaseMode) await connection();
	return readMarketSummaries(databaseMode,
		async () => (await import("@/lib/market/live")).getLiveMarkets(),
		async () => (await import("../view-data")).marketSummaries);
}


/**
 * Book statistics for one asset's stat tiles and its About panel: the makers'
 * median implied vol, how the live orders split between calls and puts, and how
 * they split between the two sides a taker can take.
 *
 * `buys` / `sells` are TAKER sides, which is what `TradeableOrder.side` carries
 * (`lib/thetanuts/orders.ts` sets it from `takerSide(order)`, and CLAUDE.md
 * records that raw `isLong` is the MAKER's flag): `buy` is an order this app's
 * visitor could take by paying a premium, `sell` one they could take by posting
 * collateral. They are ORDERS RESTING ON THE BOOK, never trades — the OptionBook
 * publishes no trade history, so a "234 buys / 23 sells" in fomo's sense does not
 * exist here and is not invented.
 *
 * Reads the SAME cached order snapshot the rest of the page already reads, so
 * this costs no extra network call. Returns an empty object in mock mode and
 * whenever the book cannot be read — the tiles and bars then simply do not
 * appear, which is the honest rendering of "we do not know", never a zero.
 */
export interface MarketBookStats {
	impliedVol?: number | null;
	calls?: number | null;
	puts?: number | null;
	/** Live orders whose TAKER side is a buy (pay premium). */
	buys?: number | null;
	/** Live orders whose TAKER side is a sell (post collateral). */
	sells?: number | null;
}

export async function marketBookStats(asset: string): Promise<MarketBookStats> {
	if (!usingDatabase()) return {};
	try {
		const { getOrderSnapshot, isFeedUnavailable } = await import("@/lib/thetanuts/orders");
		const snapshot = await getOrderSnapshot();
		if (isFeedUnavailable(snapshot)) return {};
		const wanted = asset.trim().toUpperCase();
		const orders = snapshot.orders.filter((order) => order.asset?.toUpperCase() === wanted);
		if (orders.length === 0) return {};
		const { medianImpliedVol } = await import("./implied-vol");
		let calls = 0;
		let puts = 0;
		let buys = 0;
		let sells = 0;
		for (const order of orders) {
			if (order.isCall) calls += 1;
			else puts += 1;
			if (order.side === "buy") buys += 1;
			else sells += 1;
		}
		// `sdkOrder` is where the SDK parks `rawApiData.greeks`; the reader checks
		// every documented position and returns null when none carries an iv.
		return { impliedVol: medianImpliedVol(orders), calls, puts, buys, sells };
	} catch {
		return {};
	}
}
