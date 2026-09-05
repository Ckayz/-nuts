import { creator } from "../display";
import type { Creator } from "@/types";

// TODO-OWNER: search input cap and people result cap.
export const SEARCH_QUERY_LIMIT = 100;
export const PEOPLE_RESULT_LIMIT = 10;
export function normalizeQuery(value: unknown): string | null {
	if (typeof value !== "string" || value.length > SEARCH_QUERY_LIMIT) return null;
	const query = value.trim().toLowerCase();
	return query.length ? query : null;
}
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}
export function walletQuery(query: string): boolean {
	return /^0x[0-9a-f]{4,40}$/.test(query);
}
export interface SearchResults {
	markets: { slug: string; asset: string; name: string }[];
	people: { handle: string; handleLabel: string; displayName: string; initials: string; href: `/u/${string}` }[];
	unavailable?: boolean;
}
export function personResult(value: Creator): SearchResults["people"][number] {
	const view = creator(value);
	return { handle: view.handle, handleLabel: view.handleLabel, displayName: view.displayName,
		initials: view.initials, href: `/u/${encodeURIComponent(view.handle)}` };
}
export function searchMockPeople(query: string, people: Creator[]): SearchResults["people"] {
	return people.filter(person =>
		(!/^0x[0-9a-f]{40}$/i.test(person.handle) && person.handle.toLowerCase().startsWith(query)) ||
		(person.displayName?.toLowerCase().includes(query) ?? false) ||
		(walletQuery(query) && person.walletAddress.toLowerCase().startsWith(query)))
		// TODO-OWNER: deterministic wallet/handle order, not a relevance ranking.
		.sort((a, b) => a.walletAddress < b.walletAddress ? -1 : a.walletAddress > b.walletAddress ? 1 : a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)
		.slice(0, PEOPLE_RESULT_LIMIT).map(personResult);
}
export function searchMarkets(query: string, markets: SearchResults["markets"]): SearchResults["markets"] {
	return markets.filter(market => market.asset.toLowerCase().includes(query) || market.name.toLowerCase().includes(query))
		.map(({ slug, asset, name }) => ({ slug, asset, name }));
}
