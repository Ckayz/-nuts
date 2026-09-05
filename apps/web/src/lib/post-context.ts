import "server-only";

/**
 * C8-r2 (lane C confirming pass, finding 8). What a PUBLIC POST says, with no
 * financial fields at all.
 *
 * `ThesisAiContext` (`packages/db/src/ai-context.ts`, PRD 10.3) is the FROZEN
 * contract shared with the AI track, and it requires a structure and a creator
 * position — `buildThesisAiContextOrUnavailable` returns `no_structure` without
 * them. But the owner's own model is that a post is text (CLAUDE.md: "thesis
 * doesn't really need user to actually put a trade first … a pure text opinion
 * is fine also") and `publishPost` writes exactly that: headline, rationale,
 * tagged asset, no structure. So "Explain this post" could not read ANY post
 * the current composer produces — measured `TEXT_POST_CONTEXT
 * {"available":false,"reason":"no_structure"}`.
 *
 * This is a SEPARATE object beside that contract, not a change to it (PRD 15).
 * It carries nothing economic: a text post has no economics, and inventing
 * fields the frozen shape owns is how two contracts drift apart.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@nuts/db";
import { theses, users } from "@nuts/db/schema/index";
import { PUBLIC_THESIS_STATUSES } from "@/lib/data/constants";

/** The public reading of one post. Text only. */
export interface PublicPostContext {
	readonly id: string;
	readonly slug: string;
	readonly headline: string;
	readonly rationale: string | null;
	/** The market the post tags, uppercase ticker, or null when it tags none. */
	readonly taggedAsset: string | null;
	/** One of `PUBLIC_THESIS_STATUSES`; a draft never reaches here. */
	readonly status: string;
	readonly createdAt: string;
	readonly author: { readonly walletAddress: string; readonly displayName: string | null };
	/** The post's own page, so an answer can link what it is describing. */
	readonly url: string;
}

export type PublicPostResult =
	| { readonly available: true; readonly post: PublicPostContext }
	| { readonly available: false; readonly reason: "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicPostReader {
	findPublicPost(thesisId: string): Promise<PublicPostContext | null>;
}

/**
 * Reads a PUBLISHED post. `PUBLIC_THESIS_STATUSES` is the app's one public-status
 * list (`lib/social/guards.ts` re-exports it as `SOCIAL_PUBLIC_STATUSES`), so a
 * draft or a cancelled post is invisible here exactly as it is everywhere else —
 * the agent must not become a way to read something the site will not show.
 */
export const databasePublicPostReader: PublicPostReader = {
	async findPublicPost(thesisId) {
		const rows = await db
			.select({
				id: theses.id,
				slug: theses.slug,
				headline: theses.headline,
				rationale: theses.rationale,
				taggedAsset: theses.taggedAsset,
				status: theses.status,
				createdAt: theses.createdAt,
				walletAddress: users.walletAddress,
				displayName: users.displayName,
			})
			.from(theses)
			.innerJoin(users, eq(users.id, theses.creatorUserId))
			.where(and(eq(theses.id, thesisId), inArray(theses.status, [...PUBLIC_THESIS_STATUSES])))
			.limit(1);
		const row = rows[0];
		if (!row) return null;
		return {
			id: row.id,
			slug: row.slug,
			headline: row.headline,
			rationale: row.rationale,
			taggedAsset: row.taggedAsset,
			status: row.status,
			createdAt: row.createdAt.toISOString(),
			author: { walletAddress: row.walletAddress, displayName: row.displayName },
			url: `/t/${row.slug}`,
		};
	},
};

export async function getPublicPostContext(
	thesisId: string,
	reader: PublicPostReader = databasePublicPostReader,
): Promise<PublicPostResult> {
	// Never hand arbitrary model text to PostgreSQL's UUID parser.
	if (!UUID.test(thesisId)) return { available: false, reason: "not_found" };
	const post = await reader.findPublicPost(thesisId);
	if (post === null) return { available: false, reason: "not_found" };
	return { available: true, post };
}
