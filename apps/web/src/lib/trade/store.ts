import "server-only";

/**
 * The two database reads and one write the trade path needs, kept inside this
 * round's fence so the ticket does not depend on `src/lib/thesis/**`, which
 * another writer now owns.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { activity, positions, theses, type Thesis } from "@nuts/db/schema/index";
import type { Database } from "@/lib/auth/store";

/** Event names this round writes; the socials writer uses the same set. */
export const ACTIVITY_EVENTS = {
	thesisPublished: "thesis_published",
	positionConfirmed: "position_confirmed",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findThesis(database: Database, id: string): Promise<Thesis | null> {
	if (!UUID.test(id)) return null;
	const rows = await database.select().from(theses).where(eq(theses.id, id)).limit(1);
	return rows[0] ?? null;
}

/** `activity_domain_reference_required` needs a thesis or a position; a standalone fill has only a position. */
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

/**
 * C#2. How long an unrecorded `pending` fill blocks the wallet from preparing
 * another one.
 *
 * A `pending` row is written the moment a transaction hash exists and is moved
 * to `confirmed` or `failed` by `recordTrade`, so a row that is still pending
 * means money left the wallet and nothing durable was written for it. Preparing
 * a second fill in that state is how the reviewer's remount produced
 * `{"sends":2}` — the browser fence (`held-fill.ts`) closes the common case,
 * and this closes it for a browser whose storage was cleared, a second tab, or
 * another device.
 *
 * The window is bounded on purpose: it self-heals, so a row that can never be
 * recorded cannot lock the wallet out forever.
 *
 * TODO-OWNER: 10 minutes is this file's choice, not a decided number. Nothing
 * in docs/PRD.md sets a recording window.
 */
export const UNRECORDED_FILL_WINDOW_MS = 10 * 60 * 1000;

/**
 * C#2. The wallet's most recent `pending` position newer than the window, or
 * null. Fails LOUD: the caller must not treat a read error as "no such row".
 */
export async function findUnrecordedFill(
	database: Database,
	wallet: string,
	now: Date,
): Promise<{ txHash: string; createdAt: Date } | null> {
	const since = new Date(now.getTime() - UNRECORDED_FILL_WINDOW_MS);
	const rows = await database
		.select({ txHash: positions.txHash, createdAt: positions.createdAt })
		.from(positions)
		.where(
			and(
				eq(positions.walletAddress, wallet.toLowerCase()),
				eq(positions.status, "pending"),
				gt(positions.createdAt, since),
			),
		)
		.orderBy(desc(positions.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

/** C#2. The sentence the ticket shows for that refusal. TODO-OWNER: wording. */
export function unrecordedFillReason(txHash: string): string {
	return `Your last fill (${txHash.slice(0, 10)}…${txHash.slice(-8)}) is not recorded yet. Finish recording it before sending another trade.`;
}
