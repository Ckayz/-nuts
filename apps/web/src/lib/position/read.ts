import "server-only";

/**
 * The read behind `/p/[id]`: one position, its owner, the instrument it is a
 * position in, and the post it backs when it backs one.
 *
 * MERGE NOTE — this file is TEMPORARY, but it cannot simply be deleted.
 *
 * `src/lib/data/reads.ts` on main now exports
 *   `interface PositionDetail { position: Domain.Position; owner: Domain.Creator }`
 *   `getPosition(id, options?): Promise<PositionDetail | null>`
 * and this file's `readPositionDetail` runs the same query with the same fences
 * (uuid-validated, no status filter, LEFT join to `theses`). What it returns is a
 * SUPERSET, and the extra two fields are the reason it exists:
 *
 *   `instrument`  strikes, call/put, taker side, collateral, expiry — read from
 *                 `positions.order_snapshot`;
 *   `quantities`  the raw base-unit fill amounts and their decimals columns.
 *
 * Neither is on `Domain.Position`, and without them the P&L card has no payoff to
 * compute and no premium to value: it could only ever print the P&L columns the
 * indexer happened to fill in. So at merge, EITHER
 *   (a) keep this reader and let `getPosition` serve the callers that need only
 *       `{ position, owner }` (the trade-card unfurl), or
 *   (b) widen `reads.PositionDetail` with `instrument` and `quantities` — the two
 *       mappers below are pure and move as they are — and delete this file.
 * Deleting it and calling `getPosition` unchanged silently downgrades every
 * `/p/[id]` P&L to "unavailable" wherever the indexer has not written one.
 *
 * Unlike every list read in `reads.ts`, this one applies NO status filter.
 * `FILLED_POSITION_STATUSES` exists so a `pending` or `failed` transaction is
 * never presented in a feed as somebody's filled position; a position's own page
 * must still show it, because the owner arrived at that URL from their own
 * wallet and PRD 13 requires the failed and unconfirmed states to be visible
 * rather than absent. What the page must never do is call one of those a
 * position — see `lib/position/pnl.ts`.
 */
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { positions, theses, users } from "@nuts/db/schema/index";
import type { Position as PositionRow, Thesis as ThesisRow } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import { mapCreator, mapPosition, publicThesisOrNull } from "@/lib/data/map";
import { positionInstrument } from "./instrument";
import type { PositionPageDetail } from "./types";

export type { PositionPageDetail, PositionQuantities } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Database =
	| typeof defaultDb
	| Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];

export interface ReadOptions {
	readonly database?: Database;
}

/**
 * `mapPosition` in `lib/data/map.ts` takes a non-null thesis in THIS tree; main's
 * version already accepts null for a standalone position. Until the two meet, a
 * standalone row is mapped through the same function with a placeholder whose
 * every contribution is overwritten on the next line — so the economics,
 * verification and unit conversions stay in ONE implementation rather than being
 * copied here and drifting. MERGE: drop `NO_THESIS` and pass `row.thesis`.
 */
const NO_THESIS: Pick<ThesisRow, "id" | "slug" | "headline" | "underlyingAsset" | "taggedAsset"> = {
	id: "",
	slug: "",
	headline: "",
	underlyingAsset: null,
	taggedAsset: null,
};

/**
 * The row -> page mapping, pure and exported so it survives either merge route
 * above: give it the same three rows `getPosition` selects and it produces
 * everything `/p/[id]` renders.
 */
export function positionPageDetailFromRow(row: {
	position: PositionRow;
	thesis: ThesisRow | null;
	user: Parameters<typeof mapCreator>[0];
}): PositionPageDetail {
	const instrument = positionInstrument(row.position.orderSnapshot);
	// B6. A `draft` or `cancelled` post's headline must never leave the database.
	// The position is still public; only the post's words are withheld, which
	// leaves exactly the shape a standalone position already has.
	const thesisRow = publicThesisOrNull(row.thesis);
	const mapped = mapPosition({ position: row.position, thesis: thesisRow ?? NO_THESIS });
	const position: Domain.Position =
		thesisRow === null
			? {
					...mapped,
					thesisId: null,
					thesisSlug: null,
					thesisHeadline: null,
					// A standalone fill takes its ticker from the order it filled,
					// resolved through the SDK's price-feed map. Empty when unmapped:
					// never an invented ticker.
					underlyingAsset: instrument?.asset ?? "",
				}
			: mapped;
	return {
		position,
		owner: mapCreator(row.user),
		instrument,
		quantities: {
			contracts: row.position.contracts,
			contractDecimals: row.position.contractDecimals,
			premium: row.position.premium,
			premiumDecimals: row.position.premiumDecimals,
			fees: row.position.fees,
			feeDecimals: row.position.feeDecimals,
			collateral: row.position.collateral,
			collateralDecimals: row.position.collateralDecimals,
		},
		thesis: thesisRow === null ? null : { slug: thesisRow.slug, headline: thesisRow.headline },
	};
}

/** Null for an unknown id, and for anything that is not a uuid — never a query. */
export async function readPositionDetail(
	id: string,
	options: ReadOptions = {},
): Promise<PositionPageDetail | null> {
	if (!UUID.test(id)) return null;
	const database = options.database ?? defaultDb;
	const rows = await database
		.select({ position: positions, thesis: theses, user: users })
		.from(positions)
		.innerJoin(users, eq(users.id, positions.userId))
		.leftJoin(theses, eq(theses.id, positions.thesisId))
		.where(eq(positions.id, id.toLowerCase()))
		.limit(1);
	const row = rows[0];
	return row === undefined ? null : positionPageDetailFromRow(row);
}
