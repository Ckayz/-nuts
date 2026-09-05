import "server-only";

/**
 * Server reads for the feed, thread, portfolio and creator pages.
 *
 * Every table and column referenced here was read from `packages/db/src/schema`
 * before use. Nothing writes; nothing calls the Thetanuts SDK. Money and
 * quantities leave this layer as decimal strings (see `./decimal`).
 *
 * One rule for position status, used by every read in this file:
 * `FILLED_POSITION_STATUSES`. The board totals, the participants table, the
 * portfolio and the creator page therefore agree — a `pending` or `failed`
 * transaction is never presented as somebody's filled position.
 *
 * Page sizes are TODO-OWNER placeholders in `./constants`.
 */
import { activity as activityRows } from "@nuts/db/schema/index";
import { SOCIAL_PUBLIC_STATUSES } from "../social/guards";
import { rankCreators, rankTheses } from "../social/ranking";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { comments, follows, likes, positions, theses, users } from "@nuts/db/schema/index";
import type { Position as PositionRow, Thesis as ThesisRow, User as UserRow } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import {
	CREATOR_PAGE_SIZE,
	FEED_PAGE_SIZE,
	FILLED_POSITION_STATUSES,
	PORTFOLIO_PAGE_SIZE,
	PUBLIC_THESIS_STATUSES,
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

/** The shared handle, or a transaction handle from `db.transaction` (tests). */
export type Database =
	| typeof defaultDb
	| Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Options every read takes. `viewerUserId` drives `likedByViewer` only. */
export interface ReadOptions {
	database?: Database;
	/** `users.id` of the signed-in visitor, or null/undefined for anonymous. */
	viewerUserId?: string | null;
}

/** A session carries a uuid; anything else is treated as anonymous, never queried. */
function viewerId(options: ReadOptions): string | null {
	const value = options.viewerUserId;
	return typeof value === "string" && UUID.test(value) ? value : null;
}

function count(value: unknown): number {
	// count(*) is bigint; node-postgres hands it over as a string.
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `entry_premium_usd` values fit to be added up: present, not `NaN` (a `numeric`
 * column can legally hold it) and not negative (a negative premium spend has no
 * meaning and would give the split bar a negative width). A NULL premium is not
 * "bad" — it is a fill the indexer has not priced yet — so it is neither summed
 * nor counted as unusable.
 */
const USABLE_PREMIUM = sql`${positions.entryPremiumUsd} is not null and ${positions.entryPremiumUsd} <> 'NaN'::numeric and ${positions.entryPremiumUsd} >= 0`;

/**
 * Per-thesis participation totals over positions that represent a real fill,
 * plus comment and like counts.
 *
 * A side whose rows include an unusable premium reports `null` rather than a
 * total that silently omits it: the figure is either exactly right or shown as
 * unavailable.
 *
 * TODO-OWNER: the amount is summed from `positions.entry_premium_usd` — the USD
 * a taker actually spent. Whether the Bull/Bear split should measure premium
 * spent or maximum loss is the owner's call.
 */
async function aggregatesByThesis(
	database: Database,
	thesisIds: readonly string[],
	viewerUserId: string | null,
): Promise<Map<string, ThesisAggregates>> {
	const result = new Map<string, ThesisAggregates>();
	if (thesisIds.length === 0) return result;
	const ids = [...thesisIds];

	const sides = await database
		.select({
			thesisId: positions.thesisId,
			side: positions.side,
			fills: sql<string>`count(*)`,
			amountUsd: sql<string>`coalesce(sum(${positions.entryPremiumUsd}) filter (where ${USABLE_PREMIUM}), 0)::text`,
			unusable: sql<string>`count(*) filter (where ${positions.entryPremiumUsd} is not null and not (${USABLE_PREMIUM}))`,
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

	const likeCounts = await database
		.select({ thesisId: likes.thesisId, total: sql<string>`count(*)` })
		.from(likes)
		.where(inArray(likes.thesisId, ids))
		.groupBy(likes.thesisId);

	const viewerLikes =
		viewerUserId === null
			? []
			: await database
					.select({ thesisId: likes.thesisId })
					.from(likes)
					.where(and(inArray(likes.thesisId, ids), eq(likes.userId, viewerUserId)));

	for (const id of ids) result.set(id, { ...emptyAggregates });
	for (const row of sides) {
		const current = result.get(row.thesisId);
		if (current === undefined) continue;
		const amountUsd = count(row.unusable) > 0 ? null : row.amountUsd;
		if (row.side === "back") {
			current.backCount = count(row.fills);
			current.backAmountUsd = amountUsd;
		} else {
			current.counterCount = count(row.fills);
			current.counterAmountUsd = amountUsd;
		}
	}
	for (const row of commentCounts) {
		const current = result.get(row.thesisId);
		if (current !== undefined) current.commentCount = count(row.total);
	}
	for (const row of likeCounts) {
		const current = result.get(row.thesisId);
		if (current !== undefined) current.likeCount = count(row.total);
	}
	for (const row of viewerLikes) {
		const current = result.get(row.thesisId);
		if (current !== undefined) current.likedByViewer = true;
	}
	return result;
}

/**
 * Open theses, newest first, with their creator and — when one is linked — the
 * creator's own position.
 *
 * Only `open` is returned: PRD 8.3's feed is public theses. Since DB round 7 a
 * post may carry no structure and no backing position at all
 * (`theses_structure_all_or_nothing`, `theses_backing_requires_structure`), so
 * the join to `positions` is a LEFT join and an unbacked post is a normal card.
 */
export async function listFeed(
	options: ReadOptions & { limit?: number } = {},
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

	const aggregates = await aggregatesByThesis(
		database,
		rows.map((row) => row.thesis.id),
		viewerId(options),
	);
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
	/** Public events on this thread; social rows carry no transaction link. */
	activity: Domain.ActivityItem[];
	participantCount: number;
	activityCount: number;
}

/** Thesis + creator + every filled position on it + comments. Null when the id is unknown. */
export async function getThread(
	thesisId: string,
	options: ReadOptions = {},
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
		// Same status rule as the board totals above: a `pending` or `failed`
		// transaction is not a position anybody holds, so it is not a participant.
		.where(
			and(
				eq(positions.thesisId, thesisId),
				inArray(positions.status, [...FILLED_POSITION_STATUSES]),
			),
		)
		.orderBy(desc(positions.createdAt));

	const commentRows = await database
		.select({ comment: comments, user: users })
		.from(comments)
		.innerJoin(users, eq(users.id, comments.userId))
		.where(eq(comments.thesisId, thesisId))
		.orderBy(desc(comments.createdAt))
		// TODO-OWNER: THREAD_COMMENT_PAGE_SIZE is a placeholder page size.
		.limit(THREAD_COMMENT_PAGE_SIZE);

	const aggregates = await aggregatesByThesis(database, [thesisId], viewerId(options));
	const events = await listActivity(row.creator.id, { ...options, thesisId });
	const creatorFollow = await getFollowState(viewerId(options), row.creator.id, options);

	return {
		thesis: mapThesis({
			thesis: row.thesis,
			creator: row.creator,
			creatorPosition: row.creatorPosition,
			aggregates: aggregates.get(thesisId) ?? { ...emptyAggregates },
			creatorCounts: { thesesCount: null, followers: creatorFollow.followers, following: creatorFollow.followingCount },
			dataAsOf,
		}),
		participants: positionRows.map((entry) =>
			mapParticipant({ position: entry.position, thesis: row.thesis, user: entry.user }),
		),
		comments: commentRows.map((entry) => mapComment({ comment: entry.comment, user: entry.user })),
		activity: events,
		participantCount: positionRows.length,
		activityCount: events.length,
	};
}

/** Every filled position held by a wallet, newest first, with the thesis it belongs to. */
export async function getPortfolio(
	walletAddress: string,
	options: ReadOptions & { limit?: number } = {},
): Promise<Domain.Position[]> {
	const database = options.database ?? defaultDb;
	const address = walletAddress.trim().toLowerCase();
	const rows = await database
		.select({ position: positions, thesis: theses })
		.from(positions)
		.innerJoin(theses, eq(theses.id, positions.thesisId))
		.where(
			and(
				eq(positions.walletAddress, address),
				inArray(positions.status, [...FILLED_POSITION_STATUSES]),
			),
		)
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
	options: ReadOptions = {},
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

	const followState = await getFollowState(viewerId(options), user.id, options);
	const creator = mapCreator(user, {
		thesesCount: count(thesesCount?.total),
		followers: count(followerCount?.total),
		following: followState.followingCount,
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
		.where(and(eq(theses.creatorUserId, user.id), inArray(theses.status, [...PUBLIC_THESIS_STATUSES])))
		.orderBy(desc(theses.createdAt))
		// TODO-OWNER: CREATOR_PAGE_SIZE is a placeholder page size.
		.limit(CREATOR_PAGE_SIZE);

	const aggregates = await aggregatesByThesis(
		database,
		thesisRows.map((row) => row.thesis.id),
		viewerId(options),
	);

	const positionRows = await database
		.select({ position: positions, thesis: theses })
		.from(positions)
		.innerJoin(theses, eq(theses.id, positions.thesisId))
		.where(
			and(
				eq(positions.userId, user.id),
				// Same position rule as everywhere else, and only positions on
				// public theses: a `draft` or `cancelled` headline must not reach a
				// public profile through a participant row.
				inArray(positions.status, [...FILLED_POSITION_STATUSES]),
				inArray(theses.status, [...PUBLIC_THESIS_STATUSES]),
			),
		)
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

/** Counts are independent, so joins cannot multiply relationships. */
export async function getFollowState(viewerUserId: string | null, userId: string, options: ReadOptions = {}) {
	if (!UUID.test(userId)) return { following: false, followers: 0, followingCount: 0 };
	const database = options.database ?? defaultDb;
	const [counts] = await database.select({
		followers: sql<string>`count(*) filter (where ${follows.followedUserId} = ${userId})`,
		followingCount: sql<string>`count(*) filter (where ${follows.followerUserId} = ${userId})`,
	}).from(follows);
	const match = viewerUserId && UUID.test(viewerUserId) ? await database.select().from(follows).where(and(eq(follows.followerUserId, viewerUserId), eq(follows.followedUserId, userId))).limit(1) : [];
	return { following: match.length > 0, followers: count(counts?.followers), followingCount: count(counts?.followingCount) };
}

/** Public activity only; a draft headline or failed fill must not leak here. */
export async function listActivity(userId: string, options: ReadOptions & { thesisId?: string } = {}): Promise<Domain.ActivityItem[]> {
	if (!UUID.test(userId) || (options.thesisId !== undefined && !UUID.test(options.thesisId))) return [];
	const database = options.database ?? defaultDb;
	const rows = await database.select({ event: activityRows, user: users, thesis: theses, position: positions })
		.from(activityRows).innerJoin(users, eq(users.id, activityRows.userId))
		.leftJoin(positions, eq(positions.id, activityRows.positionId))
		.innerJoin(theses, eq(theses.id, sql`coalesce(${activityRows.thesisId}, ${positions.thesisId})`))
		.where(and(options.thesisId ? eq(theses.id, options.thesisId) : eq(activityRows.userId, userId), inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES])))
		.orderBy(desc(activityRows.createdAt), activityRows.id);
	return rows.filter(row => row.event.eventType !== "position_confirmed" || (row.position !== null && FILLED_POSITION_STATUSES.some(s => s === row.position!.status) && row.position.confirmedAt !== null))
		.filter(row => ["like", "comment", "thesis_published", "position_confirmed"].includes(row.event.eventType))
		.map(row => ({
			id: row.event.id, createdAt: row.event.createdAt.toISOString(), socialDetail: row.thesis.headline,
			creator: mapCreator(row.user), action: row.event.eventType === "thesis_published" ? "launched" : row.event.eventType === "position_confirmed" ? "joined" : row.event.eventType,
			// Legacy required money field is not displayed: socialDetail selects
			// the event presentation with no fabricated amount or contracts.
			side: row.position?.side ?? null, amountUsd: "0", contracts: null, soldStructure: null,
			transactionHash: row.position?.txHash ?? null, mockTransactionFragment: null,
		}));
}

/** TODO-OWNER: provisional formula/window specified in social/ranking.ts. */
export async function leaderboard(options: ReadOptions & { window: "1W"; now?: Date }): Promise<Domain.Creator[]> {
	const database = options.database ?? defaultDb;
	const rows = await database.select({ user: users, position: positions }).from(positions)
		.innerJoin(users, eq(users.id, positions.userId)).innerJoin(theses, eq(theses.id, positions.thesisId))
		.where(inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES]));
	const ranked = rankCreators(rows.map(row => row.position), options.now ?? new Date(), options.window);
	const byId = new Map(rows.map(row => [row.user.id, row.user]));
	return Promise.all(ranked.map(async row => {
		const state = await getFollowState(options.viewerUserId ?? null, row.userId, options);
		return { ...mapCreator(byId.get(row.userId)!, { thesesCount: null, followers: state.followers, following: state.followingCount }), netPnlUsd: row.pnl };
	}));
}

async function rankedTheses(kind: "trending" | "ending" | "settled", options: ReadOptions): Promise<Domain.Thesis[]> {
	const database = options.database ?? defaultDb;
	const rows = await database.select({ thesis: theses, creator: users, creatorPosition: positions }).from(theses)
		.innerJoin(users, eq(users.id, theses.creatorUserId)).leftJoin(positions, eq(positions.id, theses.creatorPositionId))
		.where(inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES]));
	const aggregates = await aggregatesByThesis(database, rows.map(row => row.thesis.id), viewerId(options));
	const ranked = rankTheses(rows.map(row => {
		const totals = aggregates.get(row.thesis.id) ?? { ...emptyAggregates };
		return { ...row, id: row.thesis.id, status: row.thesis.status, expiryAt: row.thesis.expiryAt, settledAt: row.thesis.settledAt,
			likes: totals.likeCount, comments: totals.commentCount, participants: totals.backCount + totals.counterCount };
	}), kind);
	return ranked.map(row => mapThesis({ ...row, aggregates: aggregates.get(row.id) ?? { ...emptyAggregates }, dataAsOf: new Date() }));
}
export async function trending(options: ReadOptions = {}) { return rankedTheses("trending", options); }
export async function endingSoon(options: ReadOptions = {}) { return rankedTheses("ending", options); }
export async function settled(options: ReadOptions = {}) { return rankedTheses("settled", options); }
