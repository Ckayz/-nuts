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
import { connection } from "next/server";
import type * as View from "./display-types";
import * as display from "./display";
import * as mock from "./view-data";
import { usingDatabase } from "./data/source";

/**
 * A `failed` fill is not a position anyone holds, so it never appears in a
 * positions list. `pending`, `confirmed`, `indexed` and `expired` are all still
 * running (PRD 8.5 calls an expired one "settlement pending"); `settled` is done.
 */
function isOpen(position: View.Position): boolean {
	return !position.settled;
}

export interface DiscoverData {
	leaderboard: View.Creator[];
	theses: View.Thesis[];
	trending: View.TrendingItem[];
	yourPositions: View.Position[];
}

export interface CreatorPageData {
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
			leaderboard: mock.leaderboard,
			theses: mock.theses,
			trending: mock.trending,
			yourPositions: mock.yourPositions,
		};
	}
	await connection();
	const { listFeed, getPortfolio } = await import("./data/reads");
	const signedIn = await viewer();
	const theses = await listFeed({ viewerUserId: signedIn?.userId ?? null });
	const positions = signedIn === null ? [] : await getPortfolio(signedIn.walletAddress);
	return {
		// TODO-OWNER: the leaderboard formula and window, and the trending and
		// ending-soon rules, are undecided (PRD 19). Both rails stay empty in
		// database mode rather than ranking by a rule nobody approved. The pages
		// already render their TODO-OWNER notes underneath.
		leaderboard: [],
		theses: theses.map(display.thesis),
		// `getPortfolio` already applies the single fill-status rule, so nothing
		// is filtered by status a second time here.
		yourPositions: positions.map(display.position).filter(isOpen),
		trending: [],
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
	if (!usingDatabase()) return mock.thesisDetailBySlug(slug);

	await connection();
	const { getThread } = await import("./data/reads");
	const signedIn = await viewer();
	const thread = await getThread(slug, { viewerUserId: signedIn?.userId ?? null });
	if (thread === null) return undefined;
	if (!renderableStatus(thread.thesis.thesis.status)) return undefined;

	return display.detail({
		thesis: thread.thesis,
		shareUrl: `thesis.fun/t/${thread.thesis.slug}`,
		shareHeadline: thread.thesis.thesis.headline,
		// TODO-OWNER: settlement wording and the spot series both come from
		// outside the database — settlement copy is the owner's, and spot is a
		// Thetanuts read. Null keeps those parts of the page hidden instead of
		// stating something unverified. The ticket is not here at all: since round
		// 6 a post carries no ticket and trading happens on the market page.
		settlementLabel: null,
		spotChangePct: null,
		participants: thread.participants,
		comments: thread.comments,
		activity: thread.activity,
		activityCount: thread.activityCount,
		participantCount: thread.participantCount,
	});
}

export async function creatorPageData(handle: string): Promise<CreatorPageData | undefined> {
	if (!usingDatabase()) {
		const creator = mock.creatorByHandle(handle);
		if (!creator) return undefined;
		return {
			creator,
			callouts: mock.thesesByCreator(handle),
			positions: mock.participantsByCreator(handle),
			activity: mock.activityByCreator(handle),
		};
	}
	await connection();
	const { getCreator } = await import("./data/reads");
	const signedIn = await viewer();
	const profile = await getCreator(handle, { viewerUserId: signedIn?.userId ?? null });
	if (profile === null) return undefined;
	return {
		creator: display.creator(profile.creator),
		callouts: profile.theses
			.filter((thesis) => renderableStatus(thesis.thesis.status))
			.map(display.thesis),
		positions: profile.positions.map(display.participant),
		// FOLLOW-UP: the `activity` table has no writer yet and holds no rendered
		// verb or amount; see `data/reads.ts`.
		activity: [],
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
