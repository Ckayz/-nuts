/**
 * The single read boundary the pages call. `DATA_SOURCE` (see `./data/source`)
 * decides whether it serves the typed fixtures or the database.
 *
 * Mock is the default and its output is byte-identical to what `view-data.ts`
 * exported before, so no page changes appearance unless the flag is set.
 *
 * The database branch imports `./data/reads` dynamically so a mock build never
 * pulls `@nuts/db` (and its eager connection pool) into the module graph.
 */
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

/** Wallet of the signed-in visitor, or null. Only consulted in database mode. */
async function sessionWallet(): Promise<string | null> {
	const { getSession } = await import("./auth/session");
	const session = await getSession();
	return session?.walletAddress ?? null;
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
	const { listFeed, getPortfolio } = await import("./data/reads");
	const theses = await listFeed();
	const wallet = await sessionWallet();
	const positions = wallet === null ? [] : await getPortfolio(wallet);
	return {
		// TODO-OWNER: the leaderboard formula and window, and the trending and
		// ending-soon rules, are undecided (PRD 19). Both rails stay empty in
		// database mode rather than ranking by a rule nobody approved. The pages
		// already render their TODO-OWNER notes underneath.
		leaderboard: [],
		theses: theses.map(display.thesis),
		trending: [],
		yourPositions: positions
			.filter((position) => position.status !== "failed")
			.map(display.position)
			.filter(isOpen),
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

	const { getThread } = await import("./data/reads");
	const thread = await getThread(slug);
	if (thread === null) return undefined;
	if (!renderableStatus(thread.thesis.thesis.status)) return undefined;

	return display.detail({
		thesis: thread.thesis,
		shareUrl: `thesis.fun/t/${thread.thesis.slug}`,
		shareHeadline: thread.thesis.thesis.headline,
		// TODO-OWNER: settlement wording, the spot series and the "Take a side"
		// ticket all come from outside the database — settlement copy is the
		// owner's, and spot and quote data are Thetanuts reads. Null keeps those
		// parts of the page hidden instead of stating something unverified.
		settlementLabel: null,
		spotChangePct: null,
		participants: thread.participants,
		comments: thread.comments,
		activity: thread.activity,
		activityCount: thread.activityCount,
		participantCount: thread.participantCount,
		ticket: null,
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
	const { getCreator } = await import("./data/reads");
	const profile = await getCreator(handle);
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
	const wallet = await sessionWallet();
	if (wallet === null) {
		return { openPositions: [], settledPositions: [], currentUser: null };
	}
	const { getCreator, getPortfolio } = await import("./data/reads");
	const positions = await getPortfolio(wallet);
	const profile = await getCreator(wallet);
	const rows = positions.filter((position) => position.status !== "failed").map(display.position);
	return {
		openPositions: rows.filter(isOpen),
		settledPositions: rows.filter((position) => !isOpen(position)),
		currentUser: profile === null ? null : display.creator(profile.creator),
	};
}

/**
 * Route params for the pre-rendered thesis and creator pages. Database mode
 * returns none, so those routes render on demand instead of being enumerated at
 * build time against a database that may not be reachable.
 */
export function staticThesisSlugs(): { slug: string }[] {
	return usingDatabase() ? [] : mock.thesisDetails.map((detail) => ({ slug: detail.thesis.slug }));
}

export function staticCreatorHandles(): { handle: string }[] {
	return usingDatabase() ? [] : mock.allCreators.map((creator) => ({ handle: creator.handle }));
}
