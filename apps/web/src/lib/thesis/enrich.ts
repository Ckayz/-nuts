/**
 * Fill `Thesis.linkedPositions` from the `/p/<uuid>` links in each post's text.
 *
 * Kept out of `lib/data/reads.ts` on purpose: that file is shared with other
 * writers this round, and this step is one batch lookup layered over whatever
 * `listFeed`/`getThread` already returned. Adding it here means the read layer
 * is unchanged and the enrichment is a pure function of (posts, lookup).
 *
 * The lookup is injected, so the pure part is testable offline and the database
 * form (`./positions`) is only imported by the caller that needs it.
 */
import type * as Domain from "@/types";
import { extractTradeLinks } from "./links";

/** Resolves position ids to positions; ids it cannot find are simply absent. */
export type PositionLookup = (
	ids: readonly string[],
) => Promise<ReadonlyMap<string, Domain.LinkedPosition>>;

/** Every distinct position id linked by these posts, in first-seen order. */
export function linkedPositionIds(
	posts: readonly Domain.Thesis[],
	siteOrigin?: string | readonly string[],
): string[] {
	const ids: string[] = [];
	for (const post of posts) {
		for (const id of extractTradeLinks(`${post.thesis.headline}\n${post.thesis.rationale ?? ""}`, siteOrigin)) {
			if (!ids.includes(id)) ids.push(id);
		}
	}
	return ids;
}

/**
 * Attach the resolved positions to each post, in the order its text links them.
 *
 * Returns new objects; the inputs are never mutated, so a shared fixture stays
 * shared. A link whose position is missing (deleted, a stale id, someone else's
 * typo) contributes no card — the link is still rendered as a link, which is
 * the owner's "no error state" behaviour.
 */
export function attachLinkedPositions<T extends Domain.Thesis>(
	posts: readonly T[],
	resolved: ReadonlyMap<string, Domain.LinkedPosition>,
	siteOrigin?: string | readonly string[],
): T[] {
	return posts.map((post) => {
		const linked = extractTradeLinks(`${post.thesis.headline}\n${post.thesis.rationale ?? ""}`, siteOrigin)
			.map((id) => resolved.get(id))
			.filter((value): value is Domain.LinkedPosition => value !== undefined);
		return linked.length === 0 ? post : { ...post, linkedPositions: linked };
	});
}

/** The two steps together: collect the ids, look them up once, attach them. */
export async function enrichWithTradeLinks<T extends Domain.Thesis>(
	posts: readonly T[],
	lookup: PositionLookup,
	siteOrigin?: string | readonly string[],
): Promise<T[]> {
	const ids = linkedPositionIds(posts, siteOrigin);
	if (ids.length === 0) return [...posts];
	return attachLinkedPositions(posts, await lookup(ids), siteOrigin);
}
