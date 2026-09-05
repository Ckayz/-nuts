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
 * Book statistics for one asset's stat tiles: the makers' median implied vol,
 * and how the live orders split between calls and puts.
 *
 * Reads the SAME cached order snapshot the rest of the page already reads, so
 * this costs no extra network call. Returns an empty object in mock mode and
 * whenever the book cannot be read — the tiles then simply do not appear, which
 * is the honest rendering of "we do not know", never a zero.
 */
export async function marketBookStats(
	asset: string,
): Promise<{ impliedVol?: number | null; calls?: number | null; puts?: number | null }> {
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
		for (const order of orders) {
			if (order.isCall) calls += 1;
			else puts += 1;
		}
		// `sdkOrder` is where the SDK parks `rawApiData.greeks`; the reader checks
		// every documented position and returns null when none carries an iv.
		return { impliedVol: medianImpliedVol(orders), calls, puts };
	} catch {
		return {};
	}
}
