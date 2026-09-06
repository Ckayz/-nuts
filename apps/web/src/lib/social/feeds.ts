import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@nuts/db";
import { follows } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import { UUID } from "./guards";
import { endingSoon, settled, trending, type ReadOptions } from "../data/reads";

/**
 * The three rankings, for one audience.
 *
 * B-P3-1 (Astra lane B, pass 3). Following and Top used to be ONE list each,
 * read with `statuses: ["open"]`, and `components/feed/callout-tabs.tsx`
 * intersected that list with the separately limited global ranking. Two things
 * were wrong and both were measured:
 *
 *   READER {"global":["post-0",…,"post-5"],"following":["post-6"]}
 *   ALL_RENDERED 6
 *   FOLLOWING_RENDERED 0
 *
 * — a followed author's eligible post outside the global top six disappeared,
 * because the intersection could only ever narrow the global list; and
 * Following/Top + Settled were ALWAYS empty, because an open-only read can
 * contain no settled post.
 *
 * So each audience now reads its own three ranked lists, through the same
 * `lib/data/reads.ts` readers, with the same limits and the same eligibility
 * rules (`RANKED_THESIS_LIMIT`, `rankedTheses`; every number stays TODO-OWNER),
 * and the tabs render `audience[ranking]` directly instead of intersecting.
 */
export interface RankedFeed {
	trending: Domain.Thesis[];
	ending: Domain.Thesis[];
	settled: Domain.Thesis[];
}

/**
 * The three ranked readers, as a seam. `lib/data/reads.ts` owns every ranking
 * rule and every limit; nothing here re-sorts or re-filters what they return.
 */
export interface RankedReaders {
	trending: typeof trending;
	ending: typeof endingSoon;
	settled: typeof settled;
}

export const DEFAULT_READERS: RankedReaders = { trending, ending: endingSoon, settled };

export const EMPTY_FEED: RankedFeed = { trending: [], ending: [], settled: [] };

/**
 * Membership, not order: the SQL already restricts the rows to these creators
 * (`rankedTheses`, `creatorIds`), and this keeps that true for any reader a test
 * substitutes. The ORDER is the ranking's — it always was, because the feed
 * rendered the ranking's list and used the cohort only as a membership test.
 */
/**
 * The status scope each ranking is read with, for an AUDIENCE tab.
 *
 * Carried EXACTLY as it was, deliberately: both audience reads used to pass
 * `statuses: ["open"]` to one reader, so the Trending pill of Following and Top
 * shows open posts only while the All tab's Trending pill shows the whole public
 * set. That difference predates this fold and is not a call this fold may make —
 * TODO-OWNER: whether Following/Top Trending should include settled posts.
 *
 * What DID change is the other two: `rankedTheses` fixes `ending` to
 * open-with-an-expiry and `settled` to settled, so an `["open"]` override made
 * Following + Settled and Top + Settled EMPTY BY CONSTRUCTION. They now carry no
 * override and read exactly what their ranking is eligible for.
 */
const AUDIENCE_SCOPE = {
	trending: { statuses: ["open"] as Domain.ThesisStatus[] },
	ending: {},
	settled: {},
} as const;

export function followingRows(rows: readonly Domain.Thesis[], creatorIds: readonly string[]): Domain.Thesis[] {
	const followed = new Set(creatorIds);
	return rows.filter((row) => followed.has(row.creatorUserId));
}

export async function following(
	options: ReadOptions = {},
	readers: RankedReaders = DEFAULT_READERS,
): Promise<RankedFeed> {
	if (!options.viewerUserId || !UUID.test(options.viewerUserId)) return EMPTY_FEED;
	const database = options.database ?? db;
	const creators = await database
		.select({ id: follows.followedUserId })
		.from(follows)
		.where(eq(follows.followerUserId, options.viewerUserId));
	if (creators.length === 0) return EMPTY_FEED;
	const creatorIds = creators.map((creator) => creator.id);
	// Eligibility BEFORE the cap: the creator restriction goes into the same
	// query that applies the limit, so a followed author's post is never dropped
	// by a cap it was never measured against.
	const [rankTrending, rankEnding, rankSettled] = await Promise.all([
		readers.trending({ ...options, creatorIds, ...AUDIENCE_SCOPE.trending }),
		readers.ending({ ...options, creatorIds, ...AUDIENCE_SCOPE.ending }),
		readers.settled({ ...options, creatorIds, ...AUDIENCE_SCOPE.settled }),
	]);
	return {
		trending: followingRows(rankTrending, creatorIds),
		ending: followingRows(rankEnding, creatorIds),
		settled: followingRows(rankSettled, creatorIds),
	};
}

/**
 * TODO-OWNER: the Top cohort. Today it is the same ranking rule the All tab
 * uses — `lib/social/ranking.ts`'s provisional likes + comments + filled
 * participants — over every public post, so the two tabs agree by construction
 * until the owner names a different cohort. It reads through the same seam so
 * that rule lives in exactly one place.
 */
export async function top(
	options: ReadOptions = {},
	readers: RankedReaders = DEFAULT_READERS,
): Promise<RankedFeed> {
	const [rankTrending, rankEnding, rankSettled] = await Promise.all([
		readers.trending({ ...options, ...AUDIENCE_SCOPE.trending }),
		readers.ending({ ...options, ...AUDIENCE_SCOPE.ending }),
		readers.settled({ ...options, ...AUDIENCE_SCOPE.settled }),
	]);
	return { trending: rankTrending, ending: rankEnding, settled: rankSettled };
}
