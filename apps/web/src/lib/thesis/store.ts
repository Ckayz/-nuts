import "server-only";

/**
 * HANDOVER (trade round, 2026-09-05). The composer and `publishPost` left this
 * round's scope mid-flight; these files are left on disk for the writer who
 * takes them over. Nothing in the trade path imports them any more — the ticket
 * uses `src/lib/trade/store.ts` instead, because a fill from the ticket belongs
 * to no post (migration 0007).
 *
 * Every column and constraint below was read from `packages/db/src/schema/theses.ts`
 * and migrations 0002–0005:
 *  - `theses_structure_all_or_nothing`: the twelve structure columns are set
 *    together or not at all, so a text-only post leaves every one of them null;
 *  - `theses_tagged_asset_matches_structure` + `theses_tagged_asset_uppercase`:
 *    a structured post's `tagged_asset` equals `underlying_asset` and is
 *    uppercase, so an unresolved feed symbol must be refused, not written;
 *  - `theses_slug_unique` / `theses_slug_format`: the slug comes from
 *    `deriveSlug` in `@nuts/db/slug`, which needs the row's uuid, so the uuid is
 *    generated here and inserted with the row;
 *  - `theses_headline_nonblank`: same emptiness rule as the zod contract in
 *    `packages/db/src/ai-context.ts`.
 *
 * NOT IMPLEMENTED, and blocked by the schema — flagged for the owner: linking a
 * post's `creator_position_id` to a position the author already holds. The
 * deferred trigger `enforce_thesis_creator_position` (migration 0002) requires
 * the linked position to have `role = 'creator'` AND `thesis_id = <that thesis>`,
 * and `theses_backing_requires_structure` requires the post to carry the whole
 * structure group. A standalone position has `role = 'standalone'` and a null
 * `thesis_id`, so it can never be linked as it stands. Making it possible needs
 * either an owner-approved conversion (UPDATE the position to
 * `role = 'creator'`, `thesis_id = <post>` in the same transaction, deriving the
 * structure columns from its order snapshot) or a change to the frozen trigger.
 */
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { activity, theses, type Thesis } from "@nuts/db/schema/index";
import { deriveSlug, slugPrefix } from "@nuts/db/slug";
import type { OrderSnapshotV1 } from "@nuts/db/order-snapshot";
import type { Database } from "@/lib/auth/store";

export const ACTIVITY_EVENTS = {
	thesisPublished: "thesis_published",
	positionConfirmed: "position_confirmed",
} as const;

/**
 * The headline contract, taken from the database side rather than restated:
 * `packages/db/src/ai-context.ts` validates `z.string().trim().min(1)`.
 * TODO-OWNER: maximum headline and rationale length are content limits nobody
 * has set (PRD 19), so none is imposed here.
 */
export function normalizeHeadline(input: string): string {
	const trimmed = input.trim();
	if (trimmed.length === 0) throw new Error("A post needs some text.");
	return trimmed;
}

export function normalizeRationale(input: string | null | undefined): string | null {
	if (input === undefined || input === null) return null;
	const trimmed = input.trim();
	return trimmed.length === 0 ? null : trimmed;
}

/** Uppercase ticker, or null. Anything the feed could not resolve is refused. */
export function normalizeAsset(input: string | null | undefined): string | null {
	if (input === undefined || input === null) return null;
	const upper = input.trim().toUpperCase();
	if (upper === "") return null;
	if (!/^[A-Z0-9]+$/.test(upper)) throw new Error(`Unresolved market symbol: ${input}`);
	return upper;
}

interface InsertThesisInput {
	readonly creatorUserId: string;
	readonly headline: string;
	readonly rationale: string | null;
	readonly status: "draft" | "open";
	readonly taggedAsset: string | null;
	readonly structure: {
		readonly direction: "bull" | "bear";
		readonly underlyingAsset: string;
		readonly expiryAt: Date;
		readonly productType: string;
		readonly isCall: boolean;
		readonly isLong: boolean;
		readonly strikes: string[];
		readonly strikeDecimals: number;
		readonly collateralAddress: string;
		readonly collateralSymbol: string;
		readonly collateralDecimals: number;
		readonly creatorOrderSnapshot: OrderSnapshotV1;
	} | null;
}

/**
 * Inserts one thesis, allocating its slug. `deriveSlug` extends a four-hex
 * suffix until it finds a free slug, so the occupied set is read first; a
 * concurrent writer can still take the same slug, which surfaces as a
 * `theses_slug_unique` violation, so the whole allocation is retried.
 */
export async function insertThesis(database: Database, input: InsertThesisInput): Promise<Thesis> {
	const prefix = slugPrefix(input.headline);
	for (let attempt = 0; attempt < 4; attempt++) {
		const id = randomUUID();
		const taken = prefix === ""
			? []
			: await database.select({ slug: theses.slug }).from(theses).where(like(theses.slug, `${prefix}-%`));
		const slug = deriveSlug(input.headline, id, new Set(taken.map((row) => row.slug)));
		try {
			const [row] = await database
				.insert(theses)
				.values({
					id,
					slug,
					creatorUserId: input.creatorUserId,
					headline: input.headline,
					rationale: input.rationale,
					status: input.status,
					taggedAsset: input.taggedAsset,
					publishedAt: input.status === "open" ? new Date() : null,
					...(input.structure === null ? {} : input.structure),
				})
				.returning();
			if (row) return row;
			throw new Error("Insert returned no thesis row");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("theses_slug_unique")) throw error;
		}
	}
	throw new Error("Could not allocate a unique slug for this post");
}

/** `activity_domain_reference_required` needs a thesis or a position. */
export async function recordActivity(
	database: Database,
	input: { userId: string; eventType: string; thesisId?: string | null; positionId?: string | null },
): Promise<void> {
	await database.insert(activity).values({
		userId: input.userId,
		eventType: input.eventType,
		thesisId: input.thesisId ?? null,
		positionId: input.positionId ?? null,
	});
}

/** Publishes a text-first post: no structure, no backing, open immediately. */
export async function publishTextPost(
	database: Database,
	input: { creatorUserId: string; headline: string; rationale?: string | null; taggedAsset?: string | null },
): Promise<Thesis> {
	const thesis = await insertThesis(database, {
		creatorUserId: input.creatorUserId,
		headline: normalizeHeadline(input.headline),
		rationale: normalizeRationale(input.rationale),
		status: "open",
		taggedAsset: normalizeAsset(input.taggedAsset),
		structure: null,
	});
	await recordActivity(database, {
		userId: input.creatorUserId,
		eventType: ACTIVITY_EVENTS.thesisPublished,
		thesisId: thesis.id,
	});
	return thesis;
}

/** Marks a draft public. Kept for the writer taking this over; unused today. */
export async function publishBackedThesis(
	database: Database,
	input: { thesisId: string; creatorUserId: string; creatorPositionId: string },
): Promise<void> {
	const updated = await database
		.update(theses)
		.set({ status: "open", publishedAt: new Date(), creatorPositionId: input.creatorPositionId })
		.where(and(eq(theses.id, input.thesisId), eq(theses.creatorUserId, input.creatorUserId)))
		.returning({ id: theses.id });
	if (updated.length !== 1) throw new Error(`Could not publish thesis ${input.thesisId}`);
}

export { defaultDb };
