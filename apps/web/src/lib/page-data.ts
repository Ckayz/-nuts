/**
 * The single read boundary the pages call. `DATA_SOURCE` (see `./data/source`)
 * decides whether it serves the typed fixtures or the database.
 *
 * Mock is the default and its output is byte-identical to what `view-data.ts`
 * exported before, so no page changes appearance unless the flag is set.
 *
 * The database branch imports `./data/reads` dynamically so a mock build never
 * pulls `@nuts/db` (and its eager connection pool) into the module graph.
 *
 * Every database branch starts with `await connection()`. Rows change after the
 * build, so a page served from them must be rendered per request: without it
 * `/t/[slug]` and `/u/[handle]` are prerendered once and never revalidated, and
 * a URL first requested while its thesis is a draft keeps returning 404 after it
 * is published. `connection()` (next/server) marks the render dynamic without
 * naming a revalidation interval, which would be an owner's number, and it is
 * scoped to the database branch so the mock build keeps its static output.
 */
import type * as Domain from "@/types";
import { connection } from "next/server";
import type * as View from "./display-types";
import * as display from "./display";
import * as mock from "./view-data";
import * as mockSource from "@/mock/data";
import { attachLinkedPositions, enrichWithTradeLinks } from "./thesis/enrich";
import { usingDatabase } from "./data/source";

/**
 * Mock-mode posts with their `/p/<uuid>` trade links applied.
 *
 * The two example links live in `mock/data.ts` as a table
 * (`MOCK_TRADE_CARD_LINKS`) rather than inside the thesis literals, so this
 * REBUILDS the affected posts instead of mutating the shared fixture: importing
 * `@/mock/data` still has no side effects, and the fixture array itself is left
 * exactly as another writer left it.
 */
function mockPostsWithTradeLinks(): Domain.Thesis[] {
	const linked = new Map(mockSource.mockLinkedPositions.map((entry) => [entry.position.id, entry]));
	const withLinks = mockSource.theses.map((post) => {
		const link = mockSource.MOCK_TRADE_CARD_LINKS.find((entry) => entry.slug === post.slug);
		return link === undefined
			? post
			: { ...post, thesis: { ...post.thesis, rationale: link.rationale } };
	});
	return attachLinkedPositions(withLinks, linked);
}

/**
 * A `failed` fill is not a position anyone holds, so it never appears in a
 * positions list. `pending`, `confirmed`, `indexed` and `expired` are all still
 * running (PRD 8.5 calls an expired one "settlement pending"); `settled` is done.
 */
function isOpen(position: View.Position): boolean {
	return !position.settled;
}

export interface DiscoverData {
	signedIn: boolean;
	databaseMode: boolean;
	ending: View.TrendingItem[];
	settled: View.TrendingItem[];
	leaderboard: View.Creator[];
	theses: View.Thesis[];
	following: View.Thesis[];
	top: View.Thesis[];
	trending: View.TrendingItem[];
	yourPositions: View.Position[];
}

export interface CreatorPageData {
	isOwner: boolean;
	editableProfile?: import("./profile/validation").ProfileFields & { walletAddress: string };
	signedIn: boolean;
	databaseMode: boolean;
	following: boolean;
	self: boolean;
	creator: View.Creator;
	callouts: View.Thesis[];
	positions: View.Participant[];
	activity: View.ActivityItem[];
}

export interface PortfolioData {
	openPositions: View.Position[];
	settledPositions: View.Position[];
	/** Null when nobody is signed in; the positions list is then empty too. */
	currentUser: View.Creator | null;
}

/** The signed-in visitor, or null. Only consulted in database mode. */
async function viewer(): Promise<{ userId: string; walletAddress: string } | null> {
	const { getSession } = await import("./auth/session");
	const session = await getSession();
	return session === null ? null : { userId: session.userId, walletAddress: session.walletAddress };
}

export async function discoverData(): Promise<DiscoverData> {
	if (!usingDatabase()) {
		return {
			signedIn: false, databaseMode: false, ending: mock.ending, settled: mock.settled,
			following: mock.following, top: mock.top,
			leaderboard: mock.leaderboard,
			theses: mockPostsWithTradeLinks().map(display.thesis),
			trending: mock.trending,
			yourPositions: mock.yourPositions,
		};
	}
	await connection();
	const { listFeed, getPortfolio, leaderboard, trending, endingSoon, settled } = await import("./data/reads");
	const { following, top } = await import("./social/feeds");
	const signedIn = await viewer();
	const { listPositionsByIds } = await import("./data/reads");
	// One extra query for the whole page: the ids every post's text links, then
	// the positions behind them. A post that links nothing costs nothing.
	const theses = await enrichWithTradeLinks(
		await listFeed({ viewerUserId: signedIn?.userId ?? null }),
		(ids) => listPositionsByIds(ids),
	);
	const positions = signedIn === null ? [] : await getPortfolio(signedIn.walletAddress);
	return {
		signedIn: signedIn !== null, databaseMode: true,
		// TODO-OWNER: provisional social/ranking.ts formulas; UI notes retained.
		leaderboard: (await leaderboard({ window: "1W" })).map(display.creator),
		ending: (await endingSoon()).map(railItem),
		settled: (await settled()).map(railItem),
		theses: theses.map(display.thesis),
		following: (await following({ viewerUserId: signedIn?.userId ?? null })).map(display.thesis),
		top: (await top({ viewerUserId: signedIn?.userId ?? null })).map(display.thesis),
		// `getPortfolio` already applies the single fill-status rule, so nothing
		// is filtered by status a second time here.
		yourPositions: positions.map(display.position).filter(isOpen),
		trending: (await trending()).map(railItem),
	};
}

/**
 * `lib/display.ts` renders only the two lifecycle states the mockup specifies
 * (`open` and `settled`); every other status has no approved presentation.
 * Rather than throw inside a page render, a thesis in another state is reported
 * as missing so the route returns 404.
 */
function renderableStatus(status: string): boolean {
	return status === "open" || status === "settled";
}

export async function thesisDetailData(slug: string): Promise<View.ThesisDetail | undefined> {
	if (!usingDatabase()) {
		const source = mockSource.thesisDetails.find((entry) => entry.thesis.slug === slug);
		if (source === undefined) return undefined;
		const post = mockPostsWithTradeLinks().find((entry) => entry.slug === slug);
		return display.detail(post === undefined ? source : { ...source, thesis: post });
	}

	await connection();
	const { getThread } = await import("./data/reads");
	const signedIn = await viewer();
	const thread = await getThread(slug, { viewerUserId: signedIn?.userId ?? null });
	if (thread === null) return undefined;
	if (!renderableStatus(thread.thesis.thesis.status)) return undefined;

	const { listPositionsByIds } = await import("./data/reads");
	const [enriched = thread.thesis] = await enrichWithTradeLinks([thread.thesis], (ids) =>
		listPositionsByIds(ids),
	);

	return display.detail({
		thesis: enriched,
		shareUrl: `thesis.fun/t/${thread.thesis.slug}`,
		shareHeadline: thread.thesis.thesis.headline,
		// TODO-OWNER: settlement wording is the owner's.
		// Null keeps that part of the page hidden instead of
		// stating something unverified. The ticket is not here at all: since round
		// 6 a post carries no ticket and trading happens on the market page.
		settlementLabel: null,
		participants: thread.participants,
		comments: thread.comments,
		activity: thread.activity,
		activityCount: thread.activityCount,
		participantCount: thread.participantCount,
	});
}

/**
 * `/p/[id]`: one position's own page (owner 2026-09-05, "trade is just trade").
 *
 * ADDED for the position round; nothing above was restructured. Like every other
 * read here it is mode-aware, and like `/t/[slug]` its database branch starts
 * with `await connection()` because a position's status and P&L change after the
 * build.
 *
 * No status filter: `FILLED_POSITION_STATUSES` keeps a `pending` or `failed`
 * transaction out of feeds, but the transaction's own page must still show it
 * (PRD 13). What the page must never do is call one of those a P&L — that rule
 * lives in `lib/position/pnl.ts`.
 */
export async function positionPageData(id: string): Promise<View.PositionPage | undefined> {
	const { positionPage } = await import("./position/view");
	if (!usingDatabase()) {
		const { mockPositionDetail } = await import("./position/mock");
		const detail = mockPositionDetail(id);
		if (detail === undefined) return undefined;
		// The fixtures carry no order snapshot, so there is no instrument to price
		// and no live call is made: a mock page never reaches the network.
		return positionPage({ detail, spotUsd8: null, collateralUsdPrice8: null, asOf: new Date() });
	}
	await connection();
	const { readPositionDetail } = await import("./position/read");
	const detail = await readPositionDetail(id);
	if (detail === null) return undefined;
	const { livePrices } = await import("./position/spot");
	const prices = await livePrices(
		detail.instrument?.asset ?? null,
		detail.instrument?.collateralSymbol ?? null,
	);
	return positionPage({
		detail,
		spotUsd8: prices.spotUsd8,
		collateralUsdPrice8: prices.collateralUsdPrice8,
		asOf: new Date(),
	});
}

export async function creatorPageData(handle: string): Promise<CreatorPageData | undefined> {
	if (!usingDatabase()) {
		const creator = mock.creatorByHandle(handle);
		if (!creator) return undefined;
		return {
			signedIn: false, databaseMode: false, following: false, self: false, isOwner: false,
			creator,
			callouts: mock.thesesByCreator(handle),
			positions: mock.participantsByCreator(handle),
			activity: mock.activityByCreator(handle),
		};
	}
	await connection();
	const { getCreator, listActivity, getFollowState } = await import("./data/reads");
	const signedIn = await viewer();
	const profile = await getCreator(handle, { viewerUserId: signedIn?.userId ?? null });
	if (profile === null) return undefined;
	const isOwner = signedIn?.userId === profile.creator.id;
	const editableProfile = isOwner ? await readEditableProfile(signedIn!.userId) : undefined;
	return {
		isOwner, editableProfile,
		signedIn: signedIn !== null, databaseMode: true, self: signedIn?.userId === profile.creator.id,
		following: (await getFollowState(signedIn?.userId ?? null, profile.creator.id)).following,
		creator: display.creator(profile.creator),
		callouts: profile.theses
			.filter((thesis) => renderableStatus(thesis.thesis.status))
			.map(display.thesis),
		positions: profile.positions.map(display.participant),
		activity: (await listActivity(profile.creator.id)).map(display.activity),
	};
}

export async function portfolioData(): Promise<PortfolioData> {
	if (!usingDatabase()) {
		return {
			openPositions: mock.yourPositions,
			settledPositions: mock.yourSettledPositions,
			currentUser: mock.currentUser,
		};
	}
	await connection();
	const signedIn = await viewer();
	if (signedIn === null) {
		return { openPositions: [], settledPositions: [], currentUser: null };
	}
	const { getCreator, getPortfolio } = await import("./data/reads");
	const positions = await getPortfolio(signedIn.walletAddress);
	const profile = await getCreator(signedIn.walletAddress, { viewerUserId: signedIn.userId });
	// `getPortfolio` already applies the single fill-status rule.
	const rows = positions.map(display.position);
	return {
		openPositions: rows.filter(isOpen),
		settledPositions: rows.filter((position) => !isOpen(position)),
		currentUser: profile === null ? null : display.creator(profile.creator),
	};
}

/*
 * `/t/[slug]` and `/u/[handle]` used to export `generateStaticParams`. They no
 * longer do: `export const dynamic = "force-dynamic"` on those routes means
 * nothing is prerendered, and while `generateStaticParams` was exported Next
 * still listed them as SSG (measured: the route table printed ● even with
 * force-dynamic set). Enumerating params against a database that may not be
 * reachable at build time was never wanted either.
 */

/** A rail can show a text post without inventing a market, expiry or P&L. */
function railItem(value: Domain.Thesis): View.TrendingItem {
	const expiry = value.market?.expiryAt;
	return { slug: value.slug, asset: value.market?.underlyingAsset ?? "", headline: value.thesis.headline,
		creatorHandle: value.creator.handle, timeLabel: expiry ? `${Math.max(0, Math.ceil((Date.parse(expiry) - Date.parse(value.dataAsOf)) / 86400000))}d` : "",
		pnlUsd: display.amount(value.thesis.status === "settled" ? value.backing?.economics.finalPnlUsd ?? null : value.backing?.economics.estimatedPnlUsd ?? null), bullPct: value.backing?.bull.pct ?? 0 };
}
export async function socialPageState(creatorId?: string) {
	if (!usingDatabase()) return { databaseMode: false, signedIn: false, following: false, self: false, mockCreator: mock.currentUser };
	const session = await viewer();
	const { getFollowState, getCreator } = await import("./data/reads");
	const profile = session ? await getCreator(session.walletAddress) : null;
	return { databaseMode: true, signedIn: session !== null, self: session?.userId === creatorId,
		following: creatorId ? (await getFollowState(session?.userId ?? null, creatorId )).following : false, mockCreator: profile ? display.creator(profile.creator) : undefined };
}

async function readEditableProfile(userId: string) {
	const { db } = await import("@nuts/db");
	const { users } = await import("@nuts/db/schema/index");
	const { eq } = await import("drizzle-orm");
	const [profile] = await db.select({ handle: users.handle, displayName: users.displayName, bio: users.bio, walletAddress: users.walletAddress }).from(users).where(eq(users.id, userId)).limit(1);
	return profile;
}
