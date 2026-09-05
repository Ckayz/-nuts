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

