import "server-only";
import { activity } from "@nuts/db/schema/index";
import type { Database } from "../data/reads";
export type ActivityEvent = "thesis_published" | "position_confirmed" | "like" | "follow" | "comment";
/** Call inside the domain write transaction, after the event succeeds. */
export async function recordActivity(database: Database, input: {
	userId: string; eventType: ActivityEvent; thesisId?: string; positionId?: string; targetUserId?: string;
}) {
	if (!input.thesisId && !input.positionId && !input.targetUserId) throw new Error("Activity requires a domain reference");
	await database.insert(activity).values(input);
}
