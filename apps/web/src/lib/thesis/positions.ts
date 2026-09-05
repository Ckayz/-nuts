import "server-only";

/**
 * TEMPORARY batch position read for the trade-card unfurl.
 *
 * `listPositionsByIds(ids, options?)` now exists on `main` (orchestrator,
 * 2026-09-05, main `8e9c495`) in `lib/data/reads.ts`, returning
 * `Promise<Map<string, PositionDetail>>` with `PositionDetail = { position:
 * Domain.Position; owner: Domain.Creator }` — field-identical to
 * `Domain.LinkedPosition` here. That file is another worker's fence this round
 * and main could not be merged into this worktree (overlapping uncommitted
 * edits), so the same contract is implemented here.
 *
 * MERGE INSTRUCTION: delete this file and change the four call sites from
 *   `import { getPositionsByIds } from "./positions"` (or "./thesis/positions")
 * to `import { listPositionsByIds } from "../data/reads"`. The name is the only
 * difference: the parameter list, the option shape and the returned map are
 * already identical, deliberately. Call sites:
 *   `lib/page-data.ts` (discoverData, thesisDetailData),
 *   `lib/thesis/composer-data.ts`,
 *   `lib/thesis/thesis.integration.test.ts`.
 *
 * Differences that are deliberate and must survive the merge:
 *  - `positions.thesis_id` is still NOT NULL in this worktree (migration
 *    `0007_standalone_positions` on main relaxes it), so the join to `theses`
 *    is an INNER join here and a LEFT join there. Theirs is the correct one
 *    after the merge: a standalone position belongs to no post and must still
 *    unfurl, which is the whole point of the card. Nothing in the card mapper
 *    depends on the difference — `display.tradeCard` already renders a missing
 *    asset as "—".
 *  - Any status is returned, including `pending` and `failed`. A trade card is
 *    a link to one specific position the author chose to show, not a claim that
 *    it filled: the card prints the status verbatim and the P&L as "—" when the
 *    database holds none. The FILLED_POSITION_STATUSES rule stays where it
 *    belongs — the board totals, the participants table and the portfolio.
 *  - No viewer scoping. A position is public exactly like the post that links
 *    it; nothing here reads a session.
 */
import { eq, inArray } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { positions, theses, users } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import type { ReadOptions } from "../data/reads";
import { mapCreator, mapPosition } from "../data/map";

/** Same UUID grammar as `lib/data/reads.ts`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Positions by id, keyed by the lowercased id. One query for a whole feed.
 *
 * Ids that are not UUIDs are dropped before the query rather than handed to
 * Postgres, so a post containing junk cannot raise `22P02` and blank the feed.
 * An id that matches no row is simply absent from the map: its link stays a
 * link and no card is drawn.
 */
export async function getPositionsByIds(
	ids: readonly string[],
	options: ReadOptions = {},
): Promise<Map<string, Domain.LinkedPosition>> {
	const wanted = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
	const found = new Map<string, Domain.LinkedPosition>();
	if (wanted.length === 0) return found;

	const database = options.database ?? defaultDb;
	const rows = await database
		.select({ position: positions, thesis: theses, user: users })
		.from(positions)
		.innerJoin(users, eq(users.id, positions.userId))
		.innerJoin(theses, eq(theses.id, positions.thesisId))
		.where(inArray(positions.id, wanted));

	for (const row of rows) {
		found.set(row.position.id.toLowerCase(), {
			position: mapPosition({ position: row.position, thesis: row.thesis }),
			owner: mapCreator(row.user),
		});
	}
	return found;
}
