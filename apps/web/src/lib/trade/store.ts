import "server-only";

/**
 * The two database reads and one write the trade path needs, kept inside this
 * round's fence so the ticket does not depend on `src/lib/thesis/**`, which
 * another writer now owns.
 */
import { eq } from "drizzle-orm";
import { activity, theses, type Thesis } from "@nuts/db/schema/index";
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
