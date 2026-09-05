/**
 * Database rows -> the domain types in `apps/web/src/types.ts` that
 * `lib/display.ts` consumes. Pure functions over already-fetched rows.
 *
 * Rules held here:
 *  - money and quantities cross as decimal strings, converted from base units
 *    with `decimalFromBaseUnits`, exactly as `packages/db/src/ai-context.ts` does;
 *  - a value the database does not hold stays null. Nothing is estimated;
 *  - a value the database holds but that is not a plain decimal (a `numeric`
 *    column can legally hold `NaN`) degrades to null — "unavailable" — and never
 *    reaches `BigInt()`.
 *
 * A thesis is a post (owner 2026-09-05). DB round 7 made the whole structure
 * group nullable as one unit (`theses_structure_all_or_nothing`) and added
 * `tagged_asset`, and a backing position is optional
 * (`theses_backing_requires_structure`). So this maps three states:
 *   text only — `market`, `structure` and `backing` all null;
 *   tagged    — `market` from `tagged_asset` with a null `expiryAt`, no structure;
 *   structured — `market` and `structure` from the structure group, `backing`
 *                present only when `creator_position_id` is linked.
 *
 * TODO-OWNER items surfaced by the domain type, each left null/false/0 here:
 *  - `endingSoon` (PRD 8.3 "ending soon" rule is undecided);
 *  - creator `winRatePct`, `netPnlUsd`, `verifiedPnl30dUsd`, `biggestLossUsd`
 *    (leaderboard formula and windows are owner decisions, PRD 19);
 *  - `mock.settledWinner`, `maxPayoutMultiple`, `premiumPerContractUsd`,
 *    `payoutPerContractUsd` (no column, and each needs a definition);
 *  - `SideStats.amountUsd` is summed from `positions.entry_premium_usd`; whether
 *    the split bar should count premium spent or maximum loss is undecided.
 *
 * SCHEMA FOLLOW-UP: `Position.entrySpotPriceUsd` is always null; `positions` has
 * no entry-spot column.
 */
import { buildPriceFeedSymbolMap } from "@thetanuts-finance/thetanuts-client";
import type { Comment as CommentRow, Position as PositionRow, Thesis as ThesisRow, User as UserRow } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import { decimalFromBaseUnits, decimalFromNullableBaseUnits, sumDecimals, usdDecimalOrNull } from "./decimal";
import { creatorHandle, creatorInitials, thesisSlug } from "./identity";

/** Aggregates a caller computed for one thesis. */
export interface ThesisAggregates {
	backCount: number;
	counterCount: number;
	/**
	 * Sum of `entry_premium_usd` over filled Back positions, decimal string.
	 * Null means the total is unavailable (see `usdDecimalOrNull`), not zero.
	 */
	backAmountUsd: string | null;
	counterAmountUsd: string | null;
	commentCount: number;
	likeCount: number;
	/** Whether the signed-in viewer has liked this thesis. False when nobody is. */
	likedByViewer: boolean;
}

export const emptyAggregates: ThesisAggregates = {
	backCount: 0,
	counterCount: 0,
	backAmountUsd: "0",
	counterAmountUsd: "0",
	commentCount: 0,
	likeCount: 0,
	likedByViewer: false,
};

/** Counts a user has on their profile; null where the formula is the owner's. */
export interface CreatorCounts {
	thesesCount: number | null;
	followers: number | null;
}

function sinceLabel(createdAt: Date): string {
	// Matches the mockup's "since Jun 26" exactly; derived, not invented.
	const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(createdAt);
	return `since ${month} ${String(createdAt.getUTCFullYear()).slice(-2)}`;
}

export function mapCreator(row: UserRow, counts: CreatorCounts = { thesesCount: null, followers: null }): Domain.Creator {
	const walletAddress = row.walletAddress.toLowerCase();
	return {
		id: row.id,
		walletAddress,
		displayName: row.displayName,
		handle: creatorHandle(walletAddress),
		initials: creatorInitials(row.displayName, walletAddress),
		mockWalletFragment: null,
		sinceLabel: sinceLabel(row.createdAt),
		winRatePct: null,
		thesesCount: counts.thesesCount,
		followers: counts.followers,
		netPnlUsd: null,
		verifiedPnl30dUsd: null,
		biggestLossUsd: null,
	};
}

function economics(position: PositionRow | null): Domain.ThesisAiContext["economics"] {
	if (position === null) {
		return {
			entryPremiumUsd: null,
			entryFeesUsd: null,
			maximumLossUsd: null,
			maximumPayoutUsd: null,
			breakEvenPricesUsd: [],
			estimatedPnlUsd: null,
			finalPnlUsd: null,
			settlementPriceUsd: null,
		};
	}
	return {
		entryPremiumUsd: usdDecimalOrNull(position.entryPremiumUsd),
		entryFeesUsd: usdDecimalOrNull(position.entryFeesUsd),
		maximumLossUsd: usdDecimalOrNull(position.maximumLossUsd),
		maximumPayoutUsd: usdDecimalOrNull(position.maximumPayoutUsd),
		breakEvenPricesUsd: position.breakEvenPricesUsd
			.map(usdDecimalOrNull)
			.filter((value): value is string => value !== null),
		estimatedPnlUsd: usdDecimalOrNull(position.estimatedPnlUsd),
		finalPnlUsd: usdDecimalOrNull(position.finalPnlUsd),
		settlementPriceUsd: usdDecimalOrNull(position.settlementPriceUsd),
	};
}

function verification(position: PositionRow | null): Domain.ThesisAiContext["verification"] {
	if (position === null) {
		return { transactionHash: null, optionAddress: null, confirmedOnchain: false };
	}
	return {
		transactionHash: position.txHash,
		optionAddress: position.optionAddress,
		confirmedOnchain: position.confirmedAt !== null,
	};
}

/**
 * A side total fit to be summed and split: a plain decimal string that is not
 * negative. Anything else (`NaN`, `1e5`, `+3`, `-500.00`, a stray space) becomes
 * null, which the display renders as "—". A negative premium spend has no
 * meaning here and drawing it would give the split bar a negative width, so it
 * degrades the same way rather than being clamped to a number nobody chose.
 */
export function sideAmountOrNull(value: string | null): string | null {
	const decimal = usdDecimalOrNull(value);
	if (decimal === null) return null;
	return decimal.startsWith("-") ? null : decimal;
}

/**
 * Whole percent of the Back side; the Bear half is the remainder, so the two
 * always sum to 100. Both inputs are validated non-negative decimals, so the
 * `BigInt()` calls below cannot see `NaN` and the result cannot be negative.
 * Returns 0 when either total is unavailable: no bar is drawn from a half-known
 * split.
 */
function backPercent(backAmountUsd: string | null, counterAmountUsd: string | null): number {
	if (backAmountUsd === null || counterAmountUsd === null) return 0;
	const scale = (value: string) => {
		const [integer = "0", fraction = ""] = value.split(".");
		return { integer, fraction };
	};
	const back = scale(backAmountUsd);
	const counter = scale(counterAmountUsd);
	const places = Math.max(back.fraction.length, counter.fraction.length);
	const toInt = (parts: { integer: string; fraction: string }) =>
		BigInt(parts.integer + parts.fraction.padEnd(places, "0"));
	const b = toInt(back);
	const total = b + toInt(counter);
	if (total === 0n) return 0;
	// Round half-up in integer arithmetic.
	return Number((b * 200n + total) / (total * 2n));
}

export interface MapThesisInput {
	thesis: ThesisRow;
	creator: UserRow;
	creatorPosition: PositionRow | null;
	aggregates: ThesisAggregates;
	creatorCounts?: CreatorCounts;
	/** Snapshot instant every relative label on the card is measured against. */
	dataAsOf: Date;
}

/**
 * The structure group is null-or-complete (`theses_structure_all_or_nothing`),
 * so one column decides it for all of them. `underlyingAsset` is the column the
 * `theses_backing_requires_structure` and `theses_tagged_asset_matches_structure`
 * CHECKs are written against, so it is the one read here.
 */
function hasStructure(thesis: ThesisRow): boolean {
	return thesis.underlyingAsset !== null;
}

function mapMarket(thesis: ThesisRow): Domain.Thesis["market"] {
	const asset = thesis.underlyingAsset ?? thesis.taggedAsset;
	if (asset === null) return null;
	return {
		chainId: 8453,
		underlyingAsset: asset,
		// No spot source in the database; the price feed is a Thetanuts read.
		currentSpotPriceUsd: null,
		expiryAt: thesis.expiryAt === null ? null : thesis.expiryAt.toISOString(),
	};
}

function mapStructure(thesis: ThesisRow, creatorPosition: PositionRow | null): Domain.ThesisStructure | null {
	if (
		!hasStructure(thesis) ||
		thesis.productType === null ||
		thesis.isCall === null ||
		thesis.isLong === null ||
		thesis.strikes === null ||
		thesis.strikeDecimals === null
	) {
		return null;
	}
	const isCall = thesis.isCall;
	const isLong = thesis.isLong;
	const strikeDecimals = thesis.strikeDecimals;
	const strikesUsd = thesis.strikes.map((strike) => decimalFromBaseUnits(strike, strikeDecimals));
	return {
		productType: thesis.productType,
		isCall,
		isLong,
		strikesUsd,
		collateralSymbol: thesis.collateralSymbol,
		contracts:
			creatorPosition === null
				? null
				: decimalFromNullableBaseUnits(creatorPosition.contracts, creatorPosition.contractDecimals),
		// `theses` carries one is_call / is_long pair for the whole structure, so
		// every leg repeats them. Per-leg direction is a schema follow-up.
		legs: strikesUsd.map((strikeUsd) => ({ strikeUsd, isCall, isLong })),
	};
}

/**
 * The creator's own fill and the sides other traders took on it. Null when the
 * post carries no linked creator position — the state DB round 7 permits.
 */
function mapBacking(
	thesis: ThesisRow,
	creatorPosition: PositionRow | null,
	aggregates: ThesisAggregates,
	dataAsOf: Date,
): Domain.ThesisBacking | null {
	if (thesis.creatorPositionId === null || creatorPosition === null) return null;
	const backAmountUsd = sideAmountOrNull(aggregates.backAmountUsd);
	const counterAmountUsd = sideAmountOrNull(aggregates.counterAmountUsd);
	const backPct = backPercent(backAmountUsd, counterAmountUsd);
	const fills = aggregates.backCount + aggregates.counterCount;
	// Null means "nothing filled yet" or "not a figure we can add up", which the
	// display renders as "—". A real zero would claim the pool is empty when
	// positions exist without a usable USD price.
	const pooledUsd =
		fills === 0 || backAmountUsd === null || counterAmountUsd === null
			? null
			: sumDecimals([backAmountUsd, counterAmountUsd]);

	return {
		creatorPositionId: thesis.creatorPositionId,
		economics: economics(creatorPosition),
		verification: verification(creatorPosition),
		pooledUsd,
		bull: { pct: backPct, count: aggregates.backCount, amountUsd: backAmountUsd, signed: false },
		bear: {
			pct: backAmountUsd === null || counterAmountUsd === null ? 0 : 100 - backPct,
			count: aggregates.counterCount,
			amountUsd: counterAmountUsd,
			signed: false,
		},
		mock: {
			settledAgoMinutes:
				thesis.settledAt === null
					? null
					: Math.max(0, Math.floor((dataAsOf.getTime() - thesis.settledAt.getTime()) / 60000)),
			settledWinner: null,
			maxPayoutMultiple: null,
			premiumPerContractUsd: null,
			payoutPerContractUsd: null,
			transactionFragment: null,
		},
	};
}

export function mapThesis(input: MapThesisInput): Domain.Thesis {
	const { thesis, creatorPosition, aggregates, dataAsOf } = input;

	return {
		id: thesis.id,
		slug: thesisSlug(thesis.id),
		creatorUserId: thesis.creatorUserId,
		creator: mapCreator(input.creator, input.creatorCounts),
		thesis: {
			id: thesis.id,
			headline: thesis.headline,
			rationale: thesis.rationale,
			// Null on a post without a structure: the direction column is part of
			// the `theses_structure_all_or_nothing` group. The shared AI contract
			// requires a direction, so an unstructured post cannot fill it —
			// reason `no_structure` in `packages/db/src/ai-context.ts`.
			direction: thesis.direction,
			status: thesis.status,
			createdAt: thesis.createdAt.toISOString(),
		},
		dataAsOf: dataAsOf.toISOString(),
		market: mapMarket(thesis),
		structure: mapStructure(thesis, creatorPosition),
		backing: mapBacking(thesis, creatorPosition, aggregates, dataAsOf),
		endingSoon: false,
		likes: aggregates.likeCount,
		likedByViewer: aggregates.likedByViewer,
		commentCount: aggregates.commentCount,
	};
}

export interface MapPositionInput {
	position: PositionRow;
	/**
	 * Null for a standalone position: migration 0007 made `positions.thesis_id`
	 * nullable, so a fill can belong to no post (owner 2026-09-05, "trade is just
	 * trade"). The asset then comes from the position's own order snapshot.
	 */
	thesis: Pick<ThesisRow, "id" | "headline" | "underlyingAsset" | "taggedAsset"> | null;
}

/**
 * The underlying ticker of a standalone position, from the price feed its order
 * names. `buildPriceFeedSymbolMap` is the same source the market page uses; an
 * unmapped feed yields an empty ticker rather than a guess.
 */
function assetFromOrderSnapshot(snapshot: PositionRow["orderSnapshot"]): string {
	const feed = snapshot.rawApiData?.["priceFeed"];
	if (typeof feed !== "string") return "";
	return buildPriceFeedSymbolMap(8453)[feed.toLowerCase()] ?? "";
}

export function mapPosition(input: MapPositionInput): Domain.Position {
	const { position, thesis } = input;
	if (position.chainId !== 8453) {
		throw new Error(`Position ${position.id} is not on Base mainnet (chain ${position.chainId})`);
	}
	return {
		id: position.id,
		thesisId: position.thesisId,
		userId: position.userId,
		role: position.role,
		side: position.side,
		status: position.status,
		chainId: 8453,
		walletAddress: position.walletAddress.toLowerCase(),
		thesisSlug: thesis === null ? null : thesisSlug(thesis.id),
		thesisHeadline: thesis === null ? null : thesis.headline,
		// A position on a post carries the post's asset; a standalone position
		// carries the asset of the order it filled, resolved from the SDK's price
		// feed map. Nothing is invented when neither resolves.
		underlyingAsset: thesis === null
			? assetFromOrderSnapshot(position.orderSnapshot)
			: thesis.underlyingAsset ?? thesis.taggedAsset ?? "",
		contracts: decimalFromNullableBaseUnits(position.contracts, position.contractDecimals),
		// `positions` has no entry-spot column; nothing is estimated here.
		entrySpotPriceUsd: null,
		economics: economics(position),
		verification: verification(position),
		createdAt: position.createdAt.toISOString(),
		mockTransactionFragment: null,
	};
}

export function mapParticipant(input: MapPositionInput & { user: UserRow }): Domain.Participant {
	return {
		...mapPosition(input),
		creator: mapCreator(input.user),
		// No column holds a participant's note; "—" is the placeholder the mock
		// portfolio already renders for an absent one.
		says: "—",
	};
}

export function mapComment(input: { comment: CommentRow; user: UserRow }): Domain.Comment {
	return {
		creator: mapCreator(input.user),
		createdAt: input.comment.createdAt.toISOString(),
		body: input.comment.body,
	};
}
