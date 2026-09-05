/**
 * What the feed says when a tab has no posts.
 *
 * Replaces the bare string "Nothing here yet.", which told a visitor nothing
 * about WHY the list was empty and offered no way out of it. Two facts per
 * state: what is true, and the one thing the visitor can do about it.
 *
 * The audience tabs and the ranking pills mean different things when empty, so
 * they get different lines. An empty "Following" is a fact about who the viewer
 * follows; an empty "Settled" is a fact about the clock; an empty "Trending" on
 * a brand-new product is a fact about the whole database. Collapsing all three
 * into one sentence would state the wrong cause.
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
	/** What is true. One sentence, no apology, no speculation. */
	line: string;
	/** The call to action on the link to `/new`. */
	action: string;
}

/** TODO-OWNER: provisional. The action never changes; only the reason does. */
const ACTION = "Write the first thesis";

/**
 * The empty line for one (audience, ranking) pair.
 *
 * Audience is checked first: "you follow nobody who has posted" is a more
 * specific and more actionable fact than "nothing is trending", and it is true
 * regardless of which ranking is selected.
 */
export function feedEmptyState(audience: number, ranking: number): FeedEmptyState {
	if (audience === AUDIENCE_FOLLOWING) {
		return { line: "Nobody you follow has posted a thesis yet.", action: ACTION };
	}
	if (audience === AUDIENCE_TOP) {
		return { line: "No top trader has posted a thesis yet.", action: ACTION };
	}
	if (ranking === RANKING_ENDING) {
		return { line: "No thesis is close to expiry right now.", action: ACTION };
	}
	if (ranking === RANKING_SETTLED) {
		return { line: "No thesis has settled yet. Settled ones stay here, win or lose.", action: ACTION };
	}
	return { line: "No theses yet.", action: ACTION };
}
