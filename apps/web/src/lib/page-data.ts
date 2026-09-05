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
import { PUBLIC_THESIS_STATUSES } from "./data/constants";
import { usingDatabase } from "./data/source";
import { rankTheses } from "./social/ranking";

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

/** One row of the feed's "Follow top traders" rail. */
export interface LeaderboardEntry {
	creator: View.Creator;
	/** Whether the signed-in viewer already follows this creator. False in mock
	 *  mode and for a signed-out visitor, who is routed to sign-in by the control. */
	following: boolean;
}

/**
 * The three rankings the feed's filter pills select between.
 *
 * They are POSTS, not a separate summary shape: the mockup draws the pills as
 * filters over the post feed, so `trending` / `ending` / `settled` are the same
 * `View.Thesis` objects in the order (and with the membership) the ranking reads
 * give — `lib/social/ranking.ts` `rankTheses`, whose rules carry their own
 * `TODO-OWNER`. Nothing here re-sorts or re-filters them.
 */
export interface RankedTheses {
	trending: View.Thesis[];
	ending: View.Thesis[];
	settled: View.Thesis[];
}

export interface DiscoverData {
	signedIn: boolean;
	databaseMode: boolean;
	leaderboard: LeaderboardEntry[];
	following: View.Thesis[];
	top: View.Thesis[];
	ranked: RankedTheses;
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

/**
 * Domain posts -> view posts WITH their cards.
 *
 * `lib/display.ts` builds everything about a post except its cards; the cards
 * come from the one builder in `lib/position/view.ts` (round-1 fold item 9),
 * which is imported dynamically because it reaches `@nuts/thetanuts` for the
 * risk model and no page should pull the SDK in just to render text.
 */
async function toPosts(rows: readonly Domain.Thesis[]): Promise<View.Thesis[]> {
	if (rows.length === 0) return [];
	const { withCards } = await import("./position/view");
	const asOf = new Date();
	return rows.map((row) => withCards(display.thesis(row), row, asOf));
}

/**
 * The three rankings, over the SAME posts the feed shows.
 *
 * One rule in both modes: `rankTheses` is the ranking the database reads use
 * (`lib/data/reads.ts` `rankedTheses`), applied here to whichever rows the mode
 * supplies. Mock mode therefore orders the fixtures by the product's own rule
 * rather than by a second, hand-written fixture order.
 */
function rankFixtures(rows: readonly Domain.Thesis[], kind: "trending" | "ending" | "settled"): Domain.Thesis[] {
	return rankTheses(
		rows.map((row) => ({
			row,
			id: row.id,
			status: row.thesis.status,
			likes: row.likes,
			comments: row.commentCount,
			// The fixtures carry no participant aggregate; the two side counts on a
			// backed post are the same number the database read sums.
			participants: (row.backing?.bull.count ?? 0) + (row.backing?.bear.count ?? 0),
			expiryAt: row.market?.expiryAt == null ? null : new Date(row.market.expiryAt),
			// No fixture records a settlement instant. `rankTheses` orders those
			// last-first by id, which is the honest "no order information" result.
			settledAt: null,
		})),
		kind,
	).map((entry) => entry.row);
}

export async function discoverData(): Promise<DiscoverData> {
	if (!usingDatabase()) {
		const rows = mockPostsWithTradeLinks();
		const bySlug = new Map(rows.map((row) => [row.slug, row]));
		const cohort = (posts: readonly Domain.Thesis[]) =>
			posts.map((post) => bySlug.get(post.slug) ?? post);
		return {
			signedIn: false, databaseMode: false,
			following: await toPosts(cohort(mockSource.following)),
			top: await toPosts(cohort(mockSource.top)),
			// Mock mode has no viewer, so nobody is followed yet.
			leaderboard: mock.leaderboard.map((creator) => ({ creator, following: false })),
			ranked: {
				trending: await toPosts(rankFixtures(rows, "trending")),
				ending: await toPosts(rankFixtures(rows, "ending")),
				settled: await toPosts(rankFixtures(rows, "settled")),
			},
			yourPositions: mock.yourPositions,
		};
	}
	await connection();
	const { getPortfolio, leaderboard, trending, endingSoon, settled, getFollowState, listPositionsByIds } =
		await import("./data/reads");
	const { following, top } = await import("./social/feeds");
	const signedIn = await viewer();
	const options = { viewerUserId: signedIn?.userId ?? null };
	// One extra query for the whole page: the ids every post's text links, then
	// the positions behind them. A post that links nothing costs nothing, and the
	// three rankings plus the two cohorts are enriched in ONE lookup because they
	// are overlapping views of the same posts.
	const [trendingRows, endingRows, settledRows, followingRows, topRows] = await Promise.all([
		trending(options),
		endingSoon(options),
		settled(options),
		following(options),
		top(options),
	]);
	const enriched = new Map(
		(
			await enrichWithTradeLinks(
				[...trendingRows, ...endingRows, ...settledRows, ...followingRows, ...topRows].filter(
					(row, index, all) => all.findIndex((other) => other.id === row.id) === index,
				),
				(ids) => listPositionsByIds(ids),
			)
		).map((row) => [row.id, row]),
	);
	const withLinks = (rows: readonly Domain.Thesis[]) => rows.map((row) => enriched.get(row.id) ?? row);
	const positions = signedIn === null ? [] : await getPortfolio(signedIn.walletAddress);
	// TODO-OWNER: provisional social/ranking.ts formulas; UI notes retained.
	const ranked = await leaderboard({ window: "1W" });
	return {
		signedIn: signedIn !== null, databaseMode: true,
		leaderboard: await Promise.all(
			ranked.map(async (row) => ({
				creator: display.creator(row),
				following: (await getFollowState(signedIn?.userId ?? null, row.id)).following,
			})),
		),
		following: await toPosts(withLinks(followingRows)),
		top: await toPosts(withLinks(topRows)),
		ranked: {
			trending: await toPosts(withLinks(trendingRows)),
			ending: await toPosts(withLinks(endingRows)),
			settled: await toPosts(withLinks(settledRows)),
		},
		// `getPortfolio` already applies the single fill-status rule, so nothing
		// is filtered by status a second time here.
		yourPositions: positions.map(display.position).filter(isOpen),
	};
}

/**
 * The compact posts every page except the feed carries in its left rail
 * (the mockup's "Latest theses" card).
 *
 * One read, and the smallest one that answers the question: the rail shows the
 * newest posts across the whole product, not the page's own subject, so a page
 * cannot pass its own rows in. It deliberately does NOT build cards — the rail
 * renders a headline, a time and one meta line.
 */
export async function railTheses(limit = 5): Promise<View.Thesis[]> {
	if (!usingDatabase()) return mockSource.theses.slice(0, limit).map(display.thesis);
	await connection();
	const { listFeed } = await import("./data/reads");
	return (await listFeed({ limit })).slice(0, limit).map(display.thesis);
}

/**
 * `lib/display.ts` renders only the two lifecycle states the mockup specifies
 * (`open` and `settled`); every other status has no approved presentation.
 * Rather than throw inside a page render, a thesis in another state is reported
 * as missing so the route returns 404.
 */
function renderableStatus(status: string): boolean {
	// B3: the ONE public-status list, so the thread page and the rankings cannot
	// disagree about which posts exist.
	return PUBLIC_THESIS_STATUSES.some((value) => value === status);
}

export async function thesisDetailData(slug: string): Promise<View.ThesisDetail | undefined> {
	if (!usingDatabase()) {
		const source = mockSource.thesisDetails.find((entry) => entry.thesis.slug === slug);
		if (source === undefined) return undefined;
		const post = mockPostsWithTradeLinks().find((entry) => entry.slug === slug);
		const resolved = post === undefined ? source : { ...source, thesis: post };
		return withThesisCards(display.detail(resolved), resolved.thesis);
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

	return withThesisCards(display.detail({
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
	}), enriched);
}

/** The thread's post carries the same cards a feed post does. */
async function withThesisCards(
	detail: View.ThesisDetail,
	domain: Domain.Thesis,
): Promise<View.ThesisDetail> {
	const { withCards } = await import("./position/view");
	return { ...detail, thesis: withCards(detail.thesis, domain) };
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
		// EXAMPLE prices for the EXAMPLE instrument `lib/position/mock.ts` attaches
		// (round-1 fold item 23), so the mock page is exercised with real values
		// through the real risk model. No live call is made: a mock page never
		// reaches the network. The spot is the mockup's own $79,607.32 at 8
		// decimals; aBasUSDC is valued at its 1 USD peg, the same TODO-OWNER peg
		// `lib/thetanuts/orders.ts` uses in database mode.
		return positionPage({
			detail,
			spotUsd8: detail.instrument === null ? null : "7960732000000",
			collateralUsdPrice8: detail.instrument === null ? null : "100000000",
			asOf: new Date(),
		});
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
			callouts: await toPosts(mockSource.theses.filter((post) => post.creator.handle === handle)),
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
		callouts: await toPosts(profile.theses.filter((thesis) => renderableStatus(thesis.thesis.status))),
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
