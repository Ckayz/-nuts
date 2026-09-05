import "server-only";

import { db } from "@nuts/db";
import {
	buildThesisAiContextOrUnavailable,
	type BuildThesisAiContextInput,
	type ThesisAiContextAvailability,
} from "@nuts/db/ai-context";

export type ThesisContextResult =
	| ThesisAiContextAvailability
	| { available: false; reason: "not_found" };

/** The thesis row with the two relations the context builder needs. */
export type ThesisContextRow = Pick<BuildThesisAiContextInput, "thesis" | "creator" | "creatorPosition">;

/**
 * The database boundary, injectable so tests never replace the `@nuts/db`
 * module for the whole `bun test` process (a module mock is global in bun and
 * broke every real-database test that ran after it).
 */
export interface ThesisContextReader {
	findThesisWithRelations(thesisId: string): Promise<ThesisContextRow | undefined>;
}

/**
 * One relational query reads the creator and the exact referenced position in
 * the same statement snapshot, including a null creatorPosition.
 */
export const databaseThesisContextReader: ThesisContextReader = {
	async findThesisWithRelations(thesisId) {
		const thesis = await db.query.theses.findFirst({
			where: (table, { eq }) => eq(table.id, thesisId),
			with: { creator: true, creatorPosition: true },
		});
		if (!thesis) return undefined;
		const { creator, creatorPosition, ...row } = thesis;
		return { thesis: row, creator, creatorPosition };
	},
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read persisted context by UUID; the current theses schema has no slug column. */
export async function getThesisContext(
	thesisId: string,
	reader: ThesisContextReader = databaseThesisContextReader,
): Promise<ThesisContextResult> {
	// Avoid sending arbitrary model text to PostgreSQL's UUID parser.
	if (!UUID.test(thesisId)) return { available: false, reason: "not_found" };

	const row = await reader.findThesisWithRelations(thesisId);
	if (!row) return { available: false, reason: "not_found" };

	return buildThesisAiContextOrUnavailable({ ...row, dataAsOf: new Date() });
}
