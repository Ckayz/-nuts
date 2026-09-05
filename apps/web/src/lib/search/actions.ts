"use server";
import { normalizeQuery, searchMarkets, searchMockPeople, type SearchResults } from "./query";

/** Public profile identities only; no session or private profile fields returned. */
export async function searchAll(value: unknown): Promise<SearchResults> {
	const query = normalizeQuery(value);
	if (!query) return { markets: [], people: [] };
	try {
		const { usingDatabase } = await import("../data/source");
		const { marketSummariesData } = await import("@/lib/market/summaries");
		const [marketData, people] = await Promise.all([
			marketSummariesData(),
			usingDatabase()
				? (await import("@/lib/search/reads")).searchPeople(query)
				: import("@/mock/data").then(data => searchMockPeople(query, data.allCreators)),
		]);
		if (marketData.unavailable) return { markets: [], people: [], unavailable: true };
		return { markets: searchMarkets(query, marketData.markets), people };
	} catch {
		return { markets: [], people: [], unavailable: true };
	}
}
