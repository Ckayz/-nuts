import type { Thesis } from "./display-types";

/**
 * What KIND of post this is, as a badge.
 *
 * fomo marks every feed post with a type pill — `Thesis`, `Buy`, `Sell`
 * (docs/design/FOMO-DIGEST.md, "Feed"). Their words are not ours: this app has
 * no buy/sell verb on a post at all (owner 2026-09-05: "trade is just trade.
 * post(thesis) is it's own thing" — there is no trade button inside a post).
 * Our two states are the ones the data already carries:
 *
 *   Thesis        a pure text opinion — the post names no structure, so it
 *                 states no direction. Owner 2026-09-05: "a pure text opinion
 *                 is fine also";
 *   Bull / Bear   the post names a structure, and `theses.direction` is the
 *                 direction its author took. Same two words the ticket and the
 *                 position rows already use.
 *
 * WHERE THE DIRECTION COMES FROM, and the two places it must NOT come from,
 * both measured at the bytes on 2026-09-06:
 *
 *   `Thesis.structure.side`   `lib/display.ts` `structure()` returns
 *                             `side: "bull"` unconditionally, for every post.
 *   `Thesis.backingCard.side` `lib/position/view.ts` `backingCard()` passes
 *                             `side: "back"` unconditionally ("the creator
 *                             backs their own thesis"), which `display.ts:337`
 *                             then prints as "Bull". A bear post backed by its
 *                             author reads "Bull" on its own card.
 *
 * Reading either would print a direction that is a constant, not a fact. So the
 * badge reads `Thesis.direction`, which is `theses.direction` — the column the
 * composer writes with the structure and the shared AI contract requires.
 *
 * There is no third case. A post with no structure is a thesis; that is a real
 * state in this product, not a placeholder for a value we failed to find.
 */
export interface PostTypeBadge {
	/** The word on the pill, e.g. "Thesis", "Bull", "Bear". */
	label: string;
	/**
	 * Which dot colour the pill carries. `neutral` gets the muted dot; `bull`
	 * and `bear` are the money vocabulary and get `--gain` / `--loss`.
	 */
	tone: "neutral" | "bull" | "bear";
}

/** The label used when the post names no structure, so states no direction. */
export const THESIS_BADGE: PostTypeBadge = { label: "Thesis", tone: "neutral" };

/**
 * The product's own words for the two directions. The same pair
 * `components/feed/thesis-list.tsx` and the ticket print; not a second
 * vocabulary invented here.
 */
export const DIRECTION_LABEL = { bull: "Bull", bear: "Bear" } as const;

export function postTypeBadge(post: Pick<Thesis, "direction">): PostTypeBadge {
	const direction = post.direction;
	if (direction === null || direction === undefined) return THESIS_BADGE;
	return { label: DIRECTION_LABEL[direction], tone: direction };
}
