import "server-only";

import { db } from "@nuts/db";
import {
	buildThesisAiContextOrUnavailable,
	type ThesisAiContextAvailability,
} from "@nuts/db/ai-context";

export type ThesisContextResult =
	| ThesisAiContextAvailability
	| { available: false; reason: "not_found" };

/** Read persisted context by UUID; the current theses schema has no slug column. */
export async function getThesisContext(thesisId: string): Promise<ThesisContextResult> {
	// Avoid sending arbitrary model text to PostgreSQL's UUID parser.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thesisId)) {
		return { available: false, reason: "not_found" };
	}

	// One relational query reads the creator and the exact referenced position
	// in the same statement snapshot, including a null creatorPosition.
	const thesis = await db.query.theses.findFirst({
		where: (table, { eq }) => eq(table.id, thesisId),
		with: { creator: true, creatorPosition: true },
	});
	if (!thesis) return { available: false, reason: "not_found" };

	return buildThesisAiContextOrUnavailable({
		thesis,
		creator: thesis.creator,
		creatorPosition: thesis.creatorPosition,
		dataAsOf: new Date(),
	});
}
