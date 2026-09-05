/**
 * Database rows -> the domain types in `apps/web/src/types.ts` that
 * `lib/display.ts` consumes. Pure functions over already-fetched rows.
 *
 * Rules held here:
 *  - money and quantities cross as decimal strings, converted from base units
 *    with `decimalFromBaseUnits`, exactly as `packages/db/src/ai-context.ts` does;
 *  - a value the database does not hold stays null. Nothing is estimated.
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
 * SCHEMA FOLLOW-UP: `likes` is always 0. There is no likes table in today's
 * schema; the in-flight `packages/db` round adds one. `Position.entrySpotPriceUsd`
 * is always null: `positions` has no entry-spot column.
 */
import type { Comment as CommentRow, Position as PositionRow, Thesis as ThesisRow, User as UserRow } from "@nuts/db/schema/index";
import type * as Domain from "@/types";
import { decimalFromBaseUnits, decimalFromNullableBaseUnits, sumDecimals, usdDecimalOrNull } from "./decimal";
import { creatorHandle, creatorInitials, thesisSlug } from "./identity";

/** Aggregates a caller computed for one thesis. */
export interface ThesisAggregates {
	backCount: number;
	counterCount: number;
	/** Sum of `entry_premium_usd` over filled Back positions, decimal string. */
	backAmountUsd: string;
	counterAmountUsd: string;
	commentCount: number;
}

export const emptyAggregates: ThesisAggregates = {
	backCount: 0,
	counterCount: 0,
	backAmountUsd: "0",
	counterAmountUsd: "0",
	commentCount: 0,
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

/** Whole percent of the Back side; the Bear half is the remainder, so the two always sum to 100. */
function backPercent(backAmountUsd: string, counterAmountUsd: string): number {
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

export function mapThesis(input: MapThesisInput): Domain.Thesis {
	const { thesis, creatorPosition, aggregates, dataAsOf } = input;
	const strikesUsd = thesis.strikes.map((strike) => decimalFromBaseUnits(strike, thesis.strikeDecimals));
	const backPct = backPercent(aggregates.backAmountUsd, aggregates.counterAmountUsd);
	const fills = aggregates.backCount + aggregates.counterCount;
	// Null means "nothing filled yet", which the display renders as "—". A real
	// zero would claim the pool is empty when positions exist without a USD price.
	const pooledUsd =
		fills === 0 ? null : sumDecimals([aggregates.backAmountUsd, aggregates.counterAmountUsd]);

	return {
		id: thesis.id,
		slug: thesisSlug(thesis.id),
		creatorUserId: thesis.creatorUserId,
		creatorPositionId: thesis.creatorPositionId,
		creator: mapCreator(input.creator, input.creatorCounts),
		thesis: {
			id: thesis.id,
			headline: thesis.headline,
			rationale: thesis.rationale,
			direction: thesis.direction,
			status: thesis.status,
			createdAt: thesis.createdAt.toISOString(),
		},
		market: {
			chainId: 8453,
			underlyingAsset: thesis.underlyingAsset,
			// No spot source in the database; the price feed is a Thetanuts read.
			currentSpotPriceUsd: null,
			expiryAt: thesis.expiryAt.toISOString(),
			dataAsOf: dataAsOf.toISOString(),
		},
		structure: {
			productType: thesis.productType,
			isCall: thesis.isCall,
			isLong: thesis.isLong,
			strikesUsd,
			collateralSymbol: thesis.collateralSymbol,
			contracts:
				creatorPosition === null
					? null
					: decimalFromBaseUnits(creatorPosition.contracts, creatorPosition.contractDecimals),
			// `theses` carries one is_call / is_long pair for the whole structure, so
			// every leg repeats them. Per-leg direction is a schema follow-up.
			legs: strikesUsd.map((strikeUsd) => ({
				strikeUsd,
				isCall: thesis.isCall,
				isLong: thesis.isLong,
			})),
		},
		economics: economics(creatorPosition),
		verification: verification(creatorPosition),
		endingSoon: false,
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
		pooledUsd,
		bull: {
			pct: backPct,
			count: aggregates.backCount,
			amountUsd: aggregates.backAmountUsd,
			signed: false,
		},
		bear: {
			pct: 100 - backPct,
			count: aggregates.counterCount,
			amountUsd: aggregates.counterAmountUsd,
			signed: false,
		},
		fills,
		likes: 0,
		commentCount: aggregates.commentCount,
	};
}

export interface MapPositionInput {
	position: PositionRow;
	thesis: Pick<ThesisRow, "id" | "headline" | "underlyingAsset">;
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
		thesisSlug: thesisSlug(thesis.id),
		thesisHeadline: thesis.headline,
		underlyingAsset: thesis.underlyingAsset,
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
