import "server-only";

/**
 * Server reads for the feed, thread, portfolio and creator pages.
 *
 * Every table and column referenced here was read from `packages/db/src/schema`
 * before use. Nothing writes; nothing calls the Thetanuts SDK. Money and
 * quantities leave this layer as decimal strings (see `./decimal`).
 *
 * Page sizes are TODO-OWNER placeholders in `./constants`.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { comments, follows, positions, theses, users } from "@nuts/db/schema/index";
import type { Position as PositionRow, Thesis as ThesisRow, User as UserRow } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import {
	CREATOR_PAGE_SIZE,
	FEED_PAGE_SIZE,
	FILLED_POSITION_STATUSES,
	PORTFOLIO_PAGE_SIZE,
	THREAD_COMMENT_PAGE_SIZE,
} from "./constants";
import {
	emptyAggregates,
	mapComment,
	mapCreator,
	mapParticipant,
	mapPosition,
	mapThesis,
	type ThesisAggregates,
} from "./map";

type Database = typeof defaultDb;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function count(value: unknown): number {
	// count(*) is bigint; node-postgres hands it over as a string.
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Per-thesis participation totals over positions that represent a real fill.
 *
 * TODO-OWNER: the amount is summed from `positions.entry_premium_usd` — the USD
 * a taker actually spent. Whether the Bull/Bear split should measure premium
 * spent or maximum loss is the owner's call.
 */
async function aggregatesByThesis(
	database: Database,
	thesisIds: readonly string[],
): Promise<Map<string, ThesisAggregates>> {
	const result = new Map<string, ThesisAggregates>();
	if (thesisIds.length === 0) return result;
	const ids = [...thesisIds];

	const sides = await database
		.select({
			thesisId: positions.thesisId,
			side: positions.side,
			fills: sql<string>`count(*)`,
			amountUsd: sql<string>`coalesce(sum(${positions.entryPremiumUsd}), 0)::text`,
		})
		.from(positions)
		.where(
			and(
				inArray(positions.thesisId, ids),
				inArray(positions.status, [...FILLED_POSITION_STATUSES]),
			),
		)
		.groupBy(positions.thesisId, positions.side);

	const commentCounts = await database
		.select({ thesisId: comments.thesisId, total: sql<string>`count(*)` })
		.from(comments)
		.where(inArray(comments.thesisId, ids))
		.groupBy(comments.thesisId);

	for (const id of ids) result.set(id, { ...emptyAggregates });
	for (const row of sides) {
		const current = result.get(row.thesisId);
		if (current === undefined) continue;
		if (row.side === "back") {
			current.backCount = count(row.fills);
			current.backAmountUsd = row.amountUsd;
		} else {
			current.counterCount = count(row.fills);
			current.counterAmountUsd = row.amountUsd;
		}
	}
	for (const row of commentCounts) {
		const current = result.get(row.thesisId);
		if (current !== undefined) current.commentCount = count(row.total);
	}
	return result;
}

/**
 * Open theses, newest first, with their creator and the creator's own position.
 *
 * Only `open` is returned: PRD 8.3's feed is public theses, and the
 * `theses_public_creator_position_required` CHECK guarantees an open thesis has
 * a creator position, so no card is built from an unbacked thesis.
 */
export async function listFeed(
	options: { limit?: number; database?: Database } = {},
): Promise<Domain.Thesis[]> {
	const database = options.database ?? defaultDb;
	const dataAsOf = new Date();
	const rows = await database
		.select({ thesis: theses, creator: users, creatorPosition: positions })
		.from(theses)
		.innerJoin(users, eq(users.id, theses.creatorUserId))
		.leftJoin(positions, eq(positions.id, theses.creatorPositionId))
		.where(eq(theses.status, "open"))
		.orderBy(desc(theses.createdAt))
		// TODO-OWNER: FEED_PAGE_SIZE is a placeholder page size.
		.limit(options.limit ?? FEED_PAGE_SIZE);

	const aggregates = await aggregatesByThesis(database, rows.map((row) => row.thesis.id));
	return rows.map((row) =>
		mapThesis({
			thesis: row.thesis,
			creator: row.creator,
			creatorPosition: row.creatorPosition,
			aggregates: aggregates.get(row.thesis.id) ?? { ...emptyAggregates },
			dataAsOf,
		}),
	);
}

export interface Thread {
	thesis: Domain.Thesis;
	participants: Domain.Participant[];
	comments: Domain.Comment[];
	/**
	 * Always empty in this round. The `activity` table holds only `event_type`
	 * plus foreign keys, and nothing writes to it yet; `ActivityItem` needs a
	 * rendered verb and a dollar amount that no column supplies. FOLLOW-UP.
	 */
	activity: Domain.ActivityItem[];
	participantCount: number;
	activityCount: number;
}

/** Thesis + creator + every position on it + comments. Null when the id is unknown. */
export async function getThread(
	thesisId: string,
	options: { database?: Database } = {},
): Promise<Thread | null> {
	const database = options.database ?? defaultDb;
	// `theses.id` is a uuid column: a non-uuid slug would make Postgres raise
	// `invalid input syntax for type uuid` and turn a 404 into a 500.
	if (!UUID.test(thesisId)) return null;
	const dataAsOf = new Date();

	const head = await database
		.select({ thesis: theses, creator: users, creatorPosition: positions })
		.from(theses)
		.innerJoin(users, eq(users.id, theses.creatorUserId))
		.leftJoin(positions, eq(positions.id, theses.creatorPositionId))
		.where(eq(theses.id, thesisId))
		.limit(1);
	const row = head[0];
	if (row === undefined) return null;

	const positionRows = await database
		.select({ position: positions, user: users })
		.from(positions)
		.innerJoin(users, eq(users.id, positions.userId))
		.where(eq(positions.thesisId, thesisId))
		.orderBy(desc(positions.createdAt));

	const commentRows = await database
		.select({ comment: comments, user: users })
		.from(comments)
		.innerJoin(users, eq(users.id, comments.userId))
		.where(eq(comments.thesisId, thesisId))
		.orderBy(desc(comments.createdAt))
		// TODO-OWNER: THREAD_COMMENT_PAGE_SIZE is a placeholder page size.
		.limit(THREAD_COMMENT_PAGE_SIZE);

	const aggregates = await aggregatesByThesis(database, [thesisId]);

	return {
		thesis: mapThesis({
			thesis: row.thesis,
			creator: row.creator,
			creatorPosition: row.creatorPosition,
			aggregates: aggregates.get(thesisId) ?? { ...emptyAggregates },
			dataAsOf,
		}),
		participants: positionRows.map((entry) =>
			mapParticipant({ position: entry.position, thesis: row.thesis, user: entry.user }),
		),
		comments: commentRows.map((entry) => mapComment({ comment: entry.comment, user: entry.user })),
		activity: [],
		participantCount: positionRows.length,
		activityCount: 0,
	};
}

/** Every position held by a wallet, newest first, with the thesis it belongs to. */
export async function getPortfolio(
	walletAddress: string,
	options: { limit?: number; database?: Database } = {},
): Promise<Domain.Position[]> {
	const database = options.database ?? defaultDb;
	const address = walletAddress.trim().toLowerCase();
	const rows = await database
		.select({ position: positions, thesis: theses })
		.from(positions)
		.innerJoin(theses, eq(theses.id, positions.thesisId))
		.where(eq(positions.walletAddress, address))
		.orderBy(desc(positions.createdAt))
		// TODO-OWNER: PORTFOLIO_PAGE_SIZE is a placeholder page size.
		.limit(options.limit ?? PORTFOLIO_PAGE_SIZE);
	return rows.map((row) => mapPosition({ position: row.position, thesis: row.thesis }));
}

export interface CreatorProfile {
	creator: Domain.Creator;
	theses: Domain.Thesis[];
	positions: Domain.Participant[];
}

/**
 * `handleOrAddress` is a wallet address today. `users` has no `handle` column
 * (verified in packages/db/src/schema/users.ts), so `/u/[handle]` addresses a
 * creator by their lowercase address. Adding a handle column is a schema
 * follow-up for the owner.
 */
export async function getCreator(
	handleOrAddress: string,
	options: { database?: Database } = {},
): Promise<CreatorProfile | null> {
	const database = options.database ?? defaultDb;
	const address = handleOrAddress.trim().toLowerCase();
	if (!/^0x[0-9a-f]{40}$/.test(address)) return null;

	const found = await database.select().from(users).where(eq(users.walletAddress, address)).limit(1);
	const user: UserRow | undefined = found[0];
	if (user === undefined) return null;

	const [thesesCount] = await database
		.select({ total: sql<string>`count(*)` })
		.from(theses)
		.where(eq(theses.creatorUserId, user.id));
	const [followerCount] = await database
		.select({ total: sql<string>`count(*)` })
		.from(follows)
		.where(eq(follows.followedUserId, user.id));

	const creator = mapCreator(user, {
		thesesCount: count(thesesCount?.total),
		followers: count(followerCount?.total),
	});

	const dataAsOf = new Date();
	const thesisRows = await database
		.select({ thesis: theses, creatorPosition: positions })
		.from(theses)
		.leftJoin(positions, eq(positions.id, theses.creatorPositionId))
		// Open and settled: the two states lib/display.ts can render, so a
		// creator's profile shows their finished calls as well as their live ones
		// (PRD 8.5: "the creator's public history updates from confirmed settled
		// positions"). Losing theses cannot be hidden.
		.where(and(eq(theses.creatorUserId, user.id), inArray(theses.status, ["open", "settled"])))
		.orderBy(desc(theses.createdAt))
		// TODO-OWNER: CREATOR_PAGE_SIZE is a placeholder page size.
		.limit(CREATOR_PAGE_SIZE);

	const aggregates = await aggregatesByThesis(database, thesisRows.map((row) => row.thesis.id));

	const positionRows = await database
		.select({ position: positions, thesis: theses })
		.from(positions)
		.innerJoin(theses, eq(theses.id, positions.thesisId))
		.where(eq(positions.userId, user.id))
		.orderBy(desc(positions.createdAt))
		.limit(CREATOR_PAGE_SIZE);

	return {
		creator,
		theses: thesisRows.map((row: { thesis: ThesisRow; creatorPosition: PositionRow | null }) =>
			mapThesis({
				thesis: row.thesis,
				creator: user,
				creatorPosition: row.creatorPosition,
				aggregates: aggregates.get(row.thesis.id) ?? { ...emptyAggregates },
				creatorCounts: { thesesCount: creator.thesesCount, followers: creator.followers },
				dataAsOf,
			}),
		),
		positions: positionRows.map((row) =>
			mapParticipant({ position: row.position, thesis: row.thesis, user }),
		),
	};
}
