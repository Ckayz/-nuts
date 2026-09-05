import "server-only";
import { activity } from "@nuts/db/schema/index";
import type { Database } from "../data/reads";
export type ActivityEvent = "thesis_published" | "position_confirmed" | "like" | "follow" | "comment";
/** Call inside the domain write transaction, after the event succeeds.
 * Follow events cannot currently be stored: activity_domain_reference_required
 * requires a thesis or position and the schema has no followed-user reference.
 */
export async function recordActivity(database: Database, input: {
	userId: string; eventType: ActivityEvent; thesisId?: string; positionId?: string;
}) {
	if (!input.thesisId && !input.positionId) throw new Error("Activity requires a domain reference");
	await database.insert(activity).values(input);
}
