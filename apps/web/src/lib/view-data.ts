/** Mock read boundary. Components receive presentation models only. */
import * as data from "@/mock/data";
import * as display from "./display";
export const allCreators = data.allCreators.map(display.creator);
export const leaderboard = data.leaderboard.map(display.creator);
export const topCreators = data.topCreators.map(display.creator);
export const currentUser = display.creator(data.currentUser);
export const CURRENT_USER_HANDLE = data.CURRENT_USER_HANDLE;
export const wallet = { addressLabel: data.wallet.mockAddressFragment, network: data.wallet.network };
export const theses = data.theses.map(display.thesis);
export const trending = data.trending.map(display.trending);
export const ending = data.ending.map(display.trending);
export const settled = data.settled.map(display.trending);
export const following = data.following.map(display.thesis);
export const top = data.top.map(display.thesis);
export const yourPositions = data.yourPositions.map(display.position);
export const yourSettledPositions = data.yourSettledPositions.map(display.position);
export const thesisDetails = data.thesisDetails.map(display.detail);
export const newCallouts = { count: data.newCallouts.count, avatars: data.newCallouts.avatars.map(display.creator) };
export const marketPrices = data.marketPrices.map(display.price);
export const marketsSource = data.marketsSource;
export const footerSource = data.footerSource;
export const marketSummaries = data.markets.map(display.marketSummary);
export const markets = data.markets.map(display.market);
export function creatorByHandle(handle: string) { return allCreators.find(c => c.handle === handle); }
export function thesisDetailBySlug(slug: string) { return thesisDetails.find(d => d.thesis.slug === slug); }
export function thesesByCreator(handle: string) { return theses.filter(t => t.creator.handle === handle); }
export function participantsByCreator(handle: string) { return thesisDetails.flatMap(d => d.participants.filter(p => p.creator.handle === handle)); }
export function activityByCreator(handle: string) { return thesisDetails.flatMap(d => d.activity.filter(a => a.creator.handle === handle)); }
export function marketBySlug(slug: string) { return markets.find(m => m.slug === slug); }
/** The posts tagged to a market, in the order the market fixture lists them. */
export function thesesByMarket(slug: string) {
    const source = data.markets.find(m => m.slug === slug);
    if (!source) return [];
    return source.taggedThesisSlugs.flatMap(s => theses.filter(t => t.slug === s));
}
