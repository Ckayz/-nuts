import "server-only";

/**
 * Publishing a text post.
 *
 * Owner 2026-09-05: "a pure text opinion is fine also". PRD §8.2 step 1: the
 * post text is required; rationale, market tag, structure and backing are all
 * optional, and a text-only post publishes immediately.
 *
 * Split from `./actions` the same way `social/writes.ts` is split from
 * `social/actions.ts`: everything here takes its database handle as an
 * argument, so the integration tests drive it inside a transaction that rolls
 * back, and nothing here reads a cookie or a session.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — `creator_position_id` stays NULL.
 * The composer cannot link a position it did not create, and this is measured,
 * not assumed. On a database migrated through `0006`, with a confirmed creator
 * position on thesis A:
 *   - inserting a text-only thesis B with `creator_position_id` set is rejected
 *     by CHECK `theses_backing_requires_structure`;
 *   - inserting thesis C with the whole structure group copied across is
 *     rejected by trigger `enforce_thesis_creator_position`
 *     ("invalid creator position for thesis ..."), because the trigger requires
 *     `position.thesis_id = thesis.id` and the position still belongs to A.
 * Making it pass would mean re-parenting somebody's existing position
 * (`UPDATE positions SET thesis_id = <new post>, role = 'creator'`), which
 * silently takes the trade away from the post it is already the backing of.
 * That is a product decision about what "linking a trade" means, and it is the
 * owner's, not this round's. The orchestrator reached the same conclusion
 * independently on main `8e9c495`: with migration `0007_standalone_positions` a
 * standalone position has `role = 'standalone'` and `thesis_id` NULL, so the
 * frozen 0002 trigger (`role <> 'creator'`, `thesis_id <> thesis.id`) can never
 * accept one. The verified badge for a post that links a standalone trade needs
 * a schema decision from the owner. Separately, `theses.underlying_asset` is a ticker
 * ("BTC") and the position's order snapshot holds token ADDRESSES only, so the
 * structure group cannot even be derived offline — it needs the SDK's
 * `buildPriceFeedSymbolMap(8453)`.
 *
 * None of that costs the feature anything: a trade card is an unfurled LINK,
 * not a backing relationship, so the card renders either way. `packages/db`'s
 * README says the same thing about this round of the schema: "This round does
 * not introduce an editing/backing workflow."
 */
import { z } from "zod";
import { theses } from "@nuts/db/schema/index";
import { deriveSlug } from "@nuts/db/slug";
import type { Database } from "../data/reads";
import { recordActivity } from "../social/activity";

/** Errors the composer can show. Same shape as `social/guards.ts`. */
export type PublishError = {
	error: "sign_in_required" | "blank_headline" | "invalid_tag" | "slug_conflict";
};

export interface PublishedPost {
	id: string;
	slug: string;
}

/**
 * `z.string().trim().min(1)` is exactly the database contract: CHECK
 * `theses_headline_nonblank` uses `btrim` over the ECMAScript
 * WhiteSpace + LineTerminator set (DB round 9), which is the set
 * `String.prototype.trim` strips — so the two agree by construction and a
 * headline this accepts cannot be rejected by the CHECK.
 *
 * TODO-OWNER: no maximum length. The schema defines none and the owner has set
 * no content limit; inventing one here would be inventing a product number.
 */
const headlineSchema = z.string().trim().min(1);

/**
 * Optional prose. Blank becomes NULL rather than an empty string, matching the
 * nullable `rationale` column.
 *
 * TODO-OWNER: no maximum length, for the same reason as the headline.
 */
const rationaleSchema = z.string().trim();

/**
 * A market tag is uppercased before validation, so "btc" and "BTC" both pass
 * CHECK `theses_tagged_asset_uppercase`. The format rule below is a format rule
 * and not a list: the owner's standing decision is "every market Thetanuts has
 * liquidity for … never hardcode an asset list".
 *
 * TODO-OWNER: whether a post may tag an asset the OptionBook has no liquidity
 * for is undecided; nothing here checks the live book.
 */
const taggedAssetSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]+$/);

export interface PublishPostInput {
	userId: string;
	headline: unknown;
	rationale?: unknown;
	taggedAsset?: unknown;
}

/**
 * A unique violation on the slug index specifically; anything else re-throws.
 *
 * The cause chain is walked because drizzle-orm 0.45 wraps driver errors:
 * MEASURED against this schema, a duplicate slug arrives as a
 * `DrizzleQueryError` whose own `code` and `constraint` are `undefined`, with
 * the `DatabaseError` carrying `code: "23505"`, `constraint:
 * "theses_slug_unique"` one level down in `.cause`. Reading only the top level
 * silently never matched — the retry looked implemented and was not.
 *
 * Matching the CONSTRAINT NAME and not just the SQLSTATE matters: any other
 * 23505 (`positions_chain_id_tx_hash_unique`, `likes_pkey`, …) is a real bug
 * and must propagate rather than be retried away under a different slug.
 */
function isSlugConflict(error: unknown): boolean {
	// Bounded so a self-referential cause cannot spin.
	for (let current: unknown = error, depth = 0; depth < 8; depth++) {
		if (typeof current !== "object" || current === null) return false;
		const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (candidate.code === "23505") return candidate.constraint === "theses_slug_unique";
		current = candidate.cause;
	}
	return false;
}

/**
 * Insert one published post and its `thesis_published` activity row in a single
 * transaction, so a post can never appear without its event or the reverse.
 *
 * The uuid is generated up front because the slug is derived from it
 * (`deriveSlug(headline, id)`); on a slug collision the whole transaction is
 * retried once with a longer hex suffix, which is exactly the recovery
 * `packages/db/src/slug.ts` documents ("A writer must still handle a
 * unique-index conflict and retry against the refreshed occupied set").
 */
export async function writePost(
	database: Database,
	input: PublishPostInput,
): Promise<PublishedPost | PublishError> {
	const headline = headlineSchema.safeParse(input.headline);
	if (!headline.success) return { error: "blank_headline" };

	const rationaleRaw = input.rationale === undefined || input.rationale === null ? "" : input.rationale;
	const rationaleParsed = rationaleSchema.safeParse(rationaleRaw);
	if (!rationaleParsed.success) return { error: "blank_headline" };
	const rationale = rationaleParsed.data === "" ? null : rationaleParsed.data;

	let taggedAsset: string | null = null;
	if (input.taggedAsset !== undefined && input.taggedAsset !== null && input.taggedAsset !== "") {
		const parsed = taggedAssetSchema.safeParse(input.taggedAsset);
		if (!parsed.success) return { error: "invalid_tag" };
		taggedAsset = parsed.data;
	}

	const id = crypto.randomUUID();
	const occupied = new Set<string>();
	// Two attempts: the derived slug, then the same slug with one more hex
	// character. `deriveSlug` extends the suffix against the occupied set.
	for (let attempt = 0; attempt < 2; attempt++) {
		const slug = deriveSlug(headline.data, id, occupied);
		try {
			return await database.transaction(async (tx) => {
				const [row] = await tx
					.insert(theses)
					.values({
						id,
						slug,
						creatorUserId: input.userId,
						headline: headline.data,
						rationale,
						status: "open",
						taggedAsset,
						publishedAt: new Date(),
						// Structure, order snapshot and creator position all stay NULL:
						// see the header comment. A post is text.
					})
					.returning({ id: theses.id, slug: theses.slug });
				if (row === undefined) throw new Error("Thesis insert returned no row");
				await recordActivity(tx, {
					userId: input.userId,
					thesisId: row.id,
					eventType: "thesis_published",
				});
				return row;
			});
		} catch (error) {
			if (!isSlugConflict(error)) throw error;
			occupied.add(slug);
		}
	}
	return { error: "slug_conflict" };
}
