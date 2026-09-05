/**
 * What the feed says when a tab has no posts.
 *
 * Replaces the bare string "Nothing here yet.", which told a visitor nothing
 * about WHY the list was empty and offered no way out of it.
 *
 * D-n3 (lane D confirming pass). The earlier lines asserted facts this function
 * cannot know. `callout-tabs.tsx` filters the SELECTED RANKING by the audience
 * cohort, so with one followed creator whose post is not settled, the
 * Following + Settled tab printed "Nobody you follow has posted a thesis yet."
 * — measured by the reviewer as
 * {"existingFollowingPosts":1,"visibleSettledPosts":0,
 *  "ui":{"line":"Nobody you follow has posted a thesis yet.", …}} — which was
 * simply untrue. All this function is given is a pair of tab indices, so all it
 * may say is that the current selection is empty.
 *
 * Pure and tested (`empty-state.test.ts`) so the copy cannot silently drift out
 * of step with the tab indices in `callout-tabs.tsx`.
 *
 * TODO-OWNER: every line below is provisional. The owner writes final copy.
 */

/** Tab indices, mirroring `AUDIENCE` and `RANKING` in `callout-tabs.tsx`. */
export const AUDIENCE_ALL = 0;
export const AUDIENCE_FOLLOWING = 1;
export const AUDIENCE_TOP = 2;
export const RANKING_TRENDING = 0;
export const RANKING_ENDING = 1;
export const RANKING_SETTLED = 2;

export interface FeedEmptyState {
	/** What is true: this selection is empty. Nothing about why. */
	line: string;
	/** The call to action on the link to `/new`. */
	action: string;
}

/**
 * TODO-OWNER: provisional. "Write the first thesis" claimed the database was
 * empty, which a filtered tab has no way of knowing either.
 */
const ACTION = "Write a thesis";

/**
 * TODO-OWNER: how each ranking pill names itself in the empty line.
 *
 * Indexed by the RANKING_* constants above, so a new pill cannot be added
 * without a word for it.
 */
const RANKING_WORD: readonly string[] = ["trending", "ending soon", "settled"];

/**
 * TODO-OWNER: how each audience tab names itself in the empty line. The All
 * tab adds nothing, because the selection is already the whole feed.
 */
const AUDIENCE_CLAUSE: readonly string[] = ["", " from creators you follow", " from top traders"];

/**
 * The empty line for one (audience, ranking) pair.
 *
 * It states ONLY that the current selection is empty, because that is the only
 * thing the pair of indices proves. An unknown index falls back to the widest
 * wording rather than throwing.
 */
export function feedEmptyState(audience: number, ranking: number): FeedEmptyState {
	const word = RANKING_WORD[ranking] ?? RANKING_WORD[RANKING_TRENDING] ?? "";
	const clause = AUDIENCE_CLAUSE[audience] ?? "";
	return { line: `Nothing ${word}${clause} right now.`, action: ACTION };
}
