import "server-only";
import { asc, ilike, like, or } from "drizzle-orm";
import { users } from "@nuts/db/schema/index";
import type { Database } from "../data/reads";
import { mapCreator } from "../data/map";
import { escapeLike, normalizeQuery, PEOPLE_RESULT_LIMIT, personResult, walletQuery } from "./query";

export async function searchPeople(value: unknown, options: { database?: Database } = {}) {
	const query = normalizeQuery(value);
	if (!query) return [];
	const database = options.database ?? (await import("@nuts/db")).db;
	const escaped = escapeLike(query);
	const rows = await database.select().from(users).where(or(
		ilike(users.handle, `${escaped}%`),
		ilike(users.displayName, `%${escaped}%`),
		walletQuery(query) ? like(users.walletAddress, `${escaped}%`) : undefined,
	))
		// TODO-OWNER: deterministic wallet order, not a relevance ranking.
		.orderBy(asc(users.walletAddress)).limit(PEOPLE_RESULT_LIMIT);
	return rows.map(row => personResult(mapCreator(row)));
}
