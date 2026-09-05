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
import { sumDecimals } from "./decimal";
import { rankTheses } from "../social/ranking";
import { and, desc, eq, gte, lte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@nuts/db";
import { comments, follows, likes, positions, theses, users } from "@nuts/db/schema/index";
import type { Position as PositionRow, Thesis as ThesisRow, User as UserRow } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import {
	ACTIVITY_PAGE_SIZE,
	CREATOR_PAGE_SIZE,
	RANKED_THESIS_LIMIT,
	LEADERBOARD_LIMIT,
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
	publicThesisOrNull,
	type ThesisAggregates,
} from "./map";
import type { PositionInstrument, PositionQuantities } from "@/lib/position/types";

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
 * meaning and would give the split bar a negative width).
 *
 * B5. A NULL premium USED to be neither summed NOR counted as unusable, which
 * made it invisible: a side holding [known, null] reported `fills = 2` and the
 * KNOWN row's amount, so a partial total was printed as if it were the whole
 * pool. "The indexer has not priced this fill yet" is precisely a reason the
 * total cannot be stated, so a null now marks the side unavailable like any
 * other unusable value — `count(*) filter (where not (USABLE_PREMIUM))` counts
 * nulls, because `not (x is not null and ...)` is TRUE when x is null.
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
			unusable: sql<string>`count(*) filter (where not (${USABLE_PREMIUM}))`,
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
		// `inArray` already excludes the standalone rows, whose `thesis_id` is null.
		if (row.thesisId === null) continue;
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

/**
 * Every open thesis tagged to one asset, newest first.
 *
 * The market page used to build this list by taking `listFeed()` — the newest
 * FEED_PAGE_SIZE posts ACROSS EVERY MARKET — and filtering by asset in JS. A
 * thesis about BTC that was older than 50 site-wide posts therefore never
 * appeared on the BTC page at all, however few BTC posts existed. The filter
 * belongs in SQL, which is what this is.
 *
 * `taggedAsset` is stored uppercase (the `theses_tagged_asset_uppercase` check
 * in the schema enforces it), so the asset is uppercased here rather than
 * lowered on the column, which would defeat the index.
 */
export async function listThesesByAsset(
	asset: string,
	options: ReadOptions & { limit?: number } = {},
): Promise<Domain.Thesis[]> {
	const wanted = asset.trim().toUpperCase();
	if (wanted === "") return [];
	const database = options.database ?? defaultDb;
	const dataAsOf = new Date();
	const rows = await database
		.select({ thesis: theses, creator: users, creatorPosition: positions })
		.from(theses)
		.innerJoin(users, eq(users.id, theses.creatorUserId))
		.leftJoin(positions, eq(positions.id, theses.creatorPositionId))
		// Same status predicate as `listFeed`, deliberately: the market page's
		// list and the feed must not disagree about what is public.
		.where(and(eq(theses.status, "open"), eq(theses.taggedAsset, wanted)))
		.orderBy(desc(theses.createdAt))
		// TODO-OWNER: the market page's own page size.
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

/** Thesis + creator + every filled position on it + comments. Null when the id or slug is unknown. */
export async function getThread(
	idOrSlug: string,
	options: ReadOptions = {},
): Promise<Thread | null> {
	const database = options.database ?? defaultDb;
	const identity = idOrSlug.toLowerCase();
	if (!UUID.test(identity) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(identity)) return null;
	const dataAsOf = new Date();

	// B-m1. SLUG FIRST, then id. A slug is user-derived text and can be
	// UUID-SHAPED (a headline of hex-looking words produces one), and this used
	// to send every UUID-shaped identity straight to the `id` column — so that
	// post's own URL resolved to nothing. The id lookup is kept as the fallback
	// so `/t/<uuid>` still works for a post whose slug is unknown.
	const byIdentity = async (where: SQL) =>
		database
			.select({ thesis: theses, creator: users, creatorPosition: positions })
			.from(theses)
			.innerJoin(users, eq(users.id, theses.creatorUserId))
			.leftJoin(positions, eq(positions.id, theses.creatorPositionId))
			.where(where)
			.limit(1);

	let head = await byIdentity(eq(theses.slug, identity));
	if (head[0] === undefined && UUID.test(identity)) head = await byIdentity(eq(theses.id, identity));
	const row = head[0];
	if (row === undefined) return null;
	const thesisId = row.thesis.id;

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

/** Every filled position held by a wallet, newest first, with an optional linked thesis. */
export async function getPortfolio(
	walletAddress: string,
	options: ReadOptions & { limit?: number } = {},
): Promise<Domain.Position[]> {
	const database = options.database ?? defaultDb;
	const address = walletAddress.trim().toLowerCase();
	const rows = await database
		.select({ position: positions, thesis: theses })
		.from(positions)
		.leftJoin(theses, eq(theses.id, positions.thesisId))
		.where(
			and(
				eq(positions.walletAddress, address),
				inArray(positions.status, [...FILLED_POSITION_STATUSES]),
			),
		)
		.orderBy(desc(positions.createdAt))
		// TODO-OWNER: PORTFOLIO_PAGE_SIZE is a placeholder page size.
		.limit(options.limit ?? PORTFOLIO_PAGE_SIZE);
	// B6: a `draft` or `cancelled` post's headline never leaves the database,
	// even on the owner's own portfolio row.
	return rows.map((row) => mapPosition({ position: row.position, thesis: publicThesisOrNull(row.thesis) }));
}

export interface CreatorProfile {
	creator: Domain.Creator;
	theses: Domain.Thesis[];
	positions: Domain.Participant[];
	/**
	 * Owner decision 6 (2026-09-06): the profile bio, rendered under the name and
	 * handle on `/u/<handle>`. It was WRITE-ONLY before — `users.bio` was
	 * collected by the profile editor and displayed nowhere (fold-final-D §5).
	 *
	 * It rides on the user row `getCreator` already selects, so showing it costs
	 * no query. It is deliberately NOT on `Domain.Creator`: that type extends the
	 * FROZEN `ThesisAiContext["creator"]` contract (PRD §10.3), which neither
	 * side changes unilaterally, and a bio is a profile-page fact rather than
	 * something every creator reference carries.
	 */
	bio: string | null;
}

/** Resolve a stored handle, or a wallet address for existing links and handle-less users. */
export async function getCreator(
	handleOrAddress: string,
	options: ReadOptions = {},
): Promise<CreatorProfile | null> {
	const database = options.database ?? defaultDb;
	const address = handleOrAddress.trim().toLowerCase();
	const isAddress = /^0x[0-9a-f]{40}$/.test(address);

	const found = await database.select().from(users).where(isAddress ? eq(users.walletAddress, address) : eq(users.handle, address)).limit(1);
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
		.leftJoin(theses, eq(theses.id, positions.thesisId))
		.where(
			and(
				eq(positions.userId, user.id),
				// Same position rule as everywhere else, standalone positions or positions on
				// public theses: a `draft` or `cancelled` headline must not reach a
				// public profile through a participant row.
				inArray(positions.status, [...FILLED_POSITION_STATUSES]),
				or(isNull(positions.thesisId), inArray(theses.status, [...PUBLIC_THESIS_STATUSES])),
			),
		)
		.orderBy(desc(positions.createdAt))
		.limit(CREATOR_PAGE_SIZE);

	return {
		creator,
		bio: user.bio ?? null,
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

/** One query for the entire creator set, including counts and viewer state. */
export async function getFollowStates(viewerUserId: string | null, userIds: readonly string[], options: ReadOptions = {}) {
	const wanted = [...new Set(userIds.filter(id => UUID.test(id)).map(id => id.toLowerCase()))];
	const result = new Map<string, { following: boolean; followers: number; followingCount: number }>();
	if (wanted.length === 0) return result;
	for (const id of wanted) result.set(id, { following: false, followers: 0, followingCount: 0 });
	const database = options.database ?? defaultDb;
	const viewer = viewerId({ viewerUserId });
	const rows = await database.select({
		id: users.id,
		followers: sql<string>`(select count(*) from ${follows} where ${follows.followedUserId} = ${users.id})`,
		followingCount: sql<string>`(select count(*) from ${follows} where ${follows.followerUserId} = ${users.id})`,
		following: viewer === null ? sql<boolean>`false` : sql<boolean>`exists(select 1 from ${follows} where ${follows.followedUserId} = ${users.id} and ${follows.followerUserId} = ${viewer})`,
	}).from(users).where(inArray(users.id, wanted));
	for (const row of rows) result.set(row.id, { following: row.following, followers: count(row.followers), followingCount: count(row.followingCount) });
	return result;
}

/** Public activity only; a draft headline or failed fill must not leak here. */
export async function listActivity(userId: string, options: ReadOptions & { thesisId?: string; limit?: number } = {}): Promise<Domain.ActivityItem[]> {
	if (!UUID.test(userId) || (options.thesisId !== undefined && !UUID.test(options.thesisId))) return [];
	const database = options.database ?? defaultDb;
	const target = alias(users, "activity_target_user");
	const rows = await database.select({ event: activityRows, user: users, target, thesis: theses, position: positions })
		.from(activityRows).innerJoin(users, eq(users.id, activityRows.userId))
		.leftJoin(positions, eq(positions.id, activityRows.positionId))
		.leftJoin(target, eq(target.id, activityRows.targetUserId))
		.leftJoin(theses, eq(theses.id, sql`coalesce(${activityRows.thesisId}, ${positions.thesisId})`))
		.where(and(options.thesisId ? eq(theses.id, options.thesisId) : eq(activityRows.userId, userId), or(
			inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES]),
			and(eq(activityRows.eventType, "follow"), isNull(activityRows.thesisId), isNull(activityRows.positionId), sql`${target.id} is not null`),
		)))
		.orderBy(desc(activityRows.createdAt), activityRows.id)
		// TODO-OWNER: ACTIVITY_PAGE_SIZE is a placeholder page size. The
		// filters below run in JS over this page, so a page can render FEWER
		// than the bound; the bound is on what the database returns.
		.limit(options.limit ?? ACTIVITY_PAGE_SIZE);
	return rows.filter(row => row.event.eventType !== "position_confirmed" || (row.position !== null && FILLED_POSITION_STATUSES.some(s => s === row.position!.status) && row.position.confirmedAt !== null))
		.filter(row => ["like", "comment", "follow", "thesis_published", "position_confirmed"].includes(row.event.eventType))
		.map(row => ({
			id: row.event.id, createdAt: row.event.createdAt.toISOString(),
			// TODO-OWNER: minimum follow activity label; final copy remains owner-defined.
			socialDetail: row.event.eventType === "follow" && row.target ? mapCreator(row.target).handle : row.thesis?.headline ?? "",
			thesisSlug: row.event.eventType === "follow" ? undefined : row.thesis?.slug,
			creator: mapCreator(row.user), action: row.event.eventType === "thesis_published" ? "launched" : row.event.eventType === "position_confirmed" ? "joined" : row.event.eventType,
			// Legacy required money field is not displayed: socialDetail selects
			// the event presentation with no fabricated amount or contracts.
			side: row.position?.side ?? null, amountUsd: "0", contracts: null, soldStructure: null,
			transactionHash: row.position?.txHash ?? null, mockTransactionFragment: null,
		}));
}

/**
 * WHICH position rows the 1W leaderboard is built from.
 *
 * Extracted so the aggregate below and `leaderboardPositions` cannot drift: the
 * live P&L the cell prints (owner decision 9) has to be summed over EXACTLY the
 * rows the ranking totalled, or the number and its position in the table would
 * describe different sets of fills.
 */
function leaderboardEligible(since: Date, now: Date) {
	return and(
		or(isNull(positions.thesisId), inArray(theses.status, [...PUBLIC_THESIS_STATUSES])),
		inArray(positions.status, [...FILLED_POSITION_STATUSES]),
		gte(positions.confirmedAt, since), lte(positions.confirmedAt, now),
	);
}

/** TODO-OWNER: existing 1W window copied from social/ranking.ts:12. */
function leaderboardSince(now: Date): Date {
	return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

/**
 * Owner decision 9 (2026-09-06): the position rows behind each listed trader's
 * leaderboard total, so the cell can print the SAME live P&L the list rows
 * print instead of the recorded-column aggregate — which is `—` for every
 * trader until the indexer has written an `estimated_pnl_usd`.
 *
 * The RANKING is untouched: it is still `leaderboard()`'s SQL sum over the
 * stored columns, and this read only supplies the rows for the figure in the
 * cell. Same window, same statuses, same thesis-visibility rule, by
 * construction (`leaderboardEligible`).
 *
 * Returns a map keyed by user id. A trader with no eligible row is absent, not
 * an empty array, so the caller can tell "no rows" from "rows that priced to
 * nothing".
 */
export async function leaderboardPositions(
	userIds: readonly string[],
	options: ReadOptions & { window: "1W"; now?: Date } ,
): Promise<Map<string, Domain.Position[]>> {
	const wanted = [...new Set(userIds.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
	const result = new Map<string, Domain.Position[]>();
	if (wanted.length === 0) return result;
	const database = options.database ?? defaultDb;
	const now = options.now ?? new Date();
	const rows = await database
		.select({ position: positions, thesis: theses })
		.from(positions)
		.leftJoin(theses, eq(theses.id, positions.thesisId))
		.where(and(inArray(positions.userId, wanted), leaderboardEligible(leaderboardSince(now), now)));
	for (const row of rows) {
		const userId = row.position.userId.toLowerCase();
		const list = result.get(userId) ?? [];
		// B6: a draft or cancelled post's headline never leaves the database, on
		// this path either.
		list.push(mapPosition({ position: row.position, thesis: publicThesisOrNull(row.thesis) }));
		result.set(userId, list);
	}
	return result;
}

/** Same 1W eligibility and exact decimal sum as social/ranking.ts, before LIMIT. */
export async function leaderboard(options: ReadOptions & { window: "1W"; now?: Date; limit?: number }): Promise<(Domain.Creator & { followingByViewer: boolean })[]> {
	const database = options.database ?? defaultDb;
	const now = options.now ?? new Date();
	const since = leaderboardSince(now);
	const component = sql`case when ${positions.status} = 'settled' then ${positions.finalPnlUsd} else ${positions.estimatedPnlUsd} end`;
	// usdDecimalOrNull rejects NULL and non-decimal numeric values. Any such
	// component makes the entire creator total unavailable, sorted last.
	const pnl = sql<string | null>`case when bool_and(coalesce((${component})::text ~ '^-?[0-9]+(\\.[0-9]+)?$', false)) then sum(${component}) else null end`;
	const rows = await database.select({ user: users, pnl: sql<string | null>`(${pnl})::text` }).from(positions)
		.innerJoin(users, eq(users.id, positions.userId)).leftJoin(theses, eq(theses.id, positions.thesisId))
		.where(leaderboardEligible(since, now))
		.groupBy(users.id)
		.orderBy(sql`${pnl} desc nulls last`, users.id)
		.limit(options.limit ?? LEADERBOARD_LIMIT);
	const states = await getFollowStates(options.viewerUserId ?? null, rows.map(row => row.user.id), options);
	return rows.map(row => {
		const state = states.get(row.user.id)!;
		return { ...mapCreator(row.user, { thesesCount: null, followers: state.followers, following: state.followingCount }), netPnlUsd: row.pnl === null ? null : sumDecimals([row.pnl]), followingByViewer: state.following };
	});
}

export interface RankedReadOptions extends ReadOptions {
	limit?: number;
	creatorIds?: string[];
	statuses?: Domain.ThesisStatus[];
}

async function rankedTheses(kind: "trending" | "ending" | "settled", options: RankedReadOptions): Promise<Domain.Thesis[]> {
	if (options.creatorIds?.length === 0 || options.statuses?.length === 0) return [];
	const database = options.database ?? defaultDb;
	// Rank the full eligible population in SQL before bounding the result.
	// Same engagement sum and tie-break as rankTheses; no join multiplication.
	const engagement = sql`(select count(*) from ${likes} where ${likes.thesisId} = ${theses.id})
		+ (select count(*) from ${comments} where ${comments.thesisId} = ${theses.id})
		+ (select count(*) from ${positions} where ${positions.thesisId} = ${theses.id} and ${inArray(positions.status, [...FILLED_POSITION_STATUSES])})`;
	const eligible = kind === "ending" ? and(eq(theses.status, "open"), sql`${theses.expiryAt} is not null`)
		: kind === "settled" ? eq(theses.status, "settled") : inArray(theses.status, [...SOCIAL_PUBLIC_STATUSES]);
	const ordering = kind === "trending" ? desc(engagement) : kind === "ending" ? theses.expiryAt : sql`${theses.settledAt} desc nulls last`;
	const rows = await database.select({ thesis: theses, creator: users, creatorPosition: positions }).from(theses)
		.innerJoin(users, eq(users.id, theses.creatorUserId)).leftJoin(positions, eq(positions.id, theses.creatorPositionId))
		.where(and(
			eligible,
			options.creatorIds === undefined ? undefined : inArray(theses.creatorUserId, options.creatorIds),
			options.statuses === undefined ? undefined : inArray(theses.status, options.statuses),
		))
		.orderBy(ordering, theses.id)
		.limit(options.limit ?? RANKED_THESIS_LIMIT);
	const aggregates = await aggregatesByThesis(database, rows.map(row => row.thesis.id), viewerId(options));
	const ranked = rankTheses(rows.map(row => {
		const totals = aggregates.get(row.thesis.id) ?? { ...emptyAggregates };
		return { ...row, id: row.thesis.id, status: row.thesis.status, expiryAt: row.thesis.expiryAt, settledAt: row.thesis.settledAt,
			likes: totals.likeCount, comments: totals.commentCount, participants: totals.backCount + totals.counterCount };
	}), kind);
	return ranked.map(row => mapThesis({ ...row, aggregates: aggregates.get(row.id) ?? { ...emptyAggregates }, dataAsOf: new Date() }));
}
/**
 * B-P3-1 (pass 3): all three take `RankedReadOptions`. `endingSoon` and
 * `settled` used to take only `{ limit }`, so the Following audience could not
 * be read for them at all and the tabs intersected instead — which dropped a
 * followed author's post whenever it sat outside the GLOBAL top `limit`.
 * `rankedTheses` has always applied `creatorIds` inside the same query as the
 * limit; only these two signatures were narrower than the implementation.
 */
export async function trending(options: RankedReadOptions = {}) { return rankedTheses("trending", options); }
export async function endingSoon(options: RankedReadOptions = {}) { return rankedTheses("ending", options); }
export async function settled(options: RankedReadOptions = {}) { return rankedTheses("settled", options); }

/**
 * One position and its owner, for `/p/[id]` and for the trade cards a post's
 * text unfurls (owner 2026-09-05). ADDED in the trade round; nothing above was
 * restructured.
 *
 * The join to `theses` is a LEFT join because a standalone position belongs to
 * no post (migration 0007). F29: this comment used to say `getPortfolio` still
 * inner-joined and dropped standalone positions; it left-joins (`:294`, read
 * 2026-09-05), so standalone positions ARE listed.
 */
export interface PositionDetail {
	position: Domain.Position;
	owner: Domain.Creator;
	/**
	 * C8. Decoded from the stored order snapshot, so a trade card states the
	 * same side, asset and amounts as that position's own page. Optional
	 * because `getPosition` below returns the same shape for callers that only
	 * need the row.
	 */
	instrument?: PositionInstrument | null;
	quantities?: PositionQuantities | null;
}

export async function getPosition(id: string, options: ReadOptions = {}): Promise<PositionDetail | null> {
	if (!UUID.test(id)) return null;
	const rows = await listPositionsByIds([id], options);
	return rows.get(id.toLowerCase()) ?? null;
}

/** Batch form, so a feed of posts unfurls its trade cards in one query. */
export async function listPositionsByIds(
	ids: readonly string[],
	options: ReadOptions = {},
): Promise<Map<string, PositionDetail>> {
	const wanted = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
	const result = new Map<string, PositionDetail>();
	if (wanted.length === 0) return result;
	const database = options.database ?? defaultDb;
	const rows = await database
		.select({ position: positions, thesis: theses, user: users })
		.from(positions)
		.innerJoin(users, eq(users.id, positions.userId))
		.leftJoin(theses, eq(theses.id, positions.thesisId))
		.where(inArray(positions.id, wanted));
	const { positionPageDetailFromRow } = await import("@/lib/position/read");
	for (const row of rows) {
		// C8. The SAME mapper `/p/[id]` uses, so a linked trade card and that
		// position's own page cannot state different things about one fill: the
		// taker side, the asset and the raw amounts all come from the stored
		// order snapshot instead of being left null.
		const detail = positionPageDetailFromRow(row);
		result.set(row.position.id.toLowerCase(), {
			position: detail.position,
			owner: detail.owner,
			instrument: detail.instrument,
			quantities: detail.quantities,
		});
	}
	return result;
}
