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
export const yourPositions = data.yourPositions.map(display.position);
export const yourSettledPositions = data.yourSettledPositions.map(display.position);
export const btcNfpDetail = display.detail(data.btcNfpDetail);
export const thesisDetails = data.thesisDetails.map(display.detail);
export const creatorPayouts = { paidToCreatorsUsd: display.amount(data.creatorPayouts.paidToCreatorsUsd), fromFollowerFillsUsd: display.amount(data.creatorPayouts.fromFollowerFillsUsd), topEarner: display.creator(data.creatorPayouts.topEarner), topEarnerUsd: display.amount(data.creatorPayouts.topEarnerUsd) };
export const newCallouts = { count: data.newCallouts.count, avatars: data.newCallouts.avatars.map(display.creator) };
export const marketPrices = data.marketPrices.map(display.price);
export const marketsSource = data.marketsSource;
export const footerSource = data.footerSource;
export function creatorByHandle(handle: string) { return allCreators.find(c => c.handle === handle); }
export function thesisBySlug(slug: string) { return theses.find(t => t.slug === slug); }
export function thesisDetailBySlug(slug: string) { return thesisDetails.find(d => d.thesis.slug === slug); }
export function thesesByCreator(handle: string) { return theses.filter(t => t.creator.handle === handle); }
export function participantsByCreator(handle: string) { return thesisDetails.flatMap(d => d.participants.filter(p => p.creator.handle === handle)); }
export function activityByCreator(handle: string) { return thesisDetails.flatMap(d => d.activity.filter(a => a.creator.handle === handle)); }
