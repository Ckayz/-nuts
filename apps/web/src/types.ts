/**
 * Domain types: PRD §10.2 names, decimal strings and lifecycle enums.
 * Owner notes: LIVE / ENDING / SETTLED are display chips, not domain statuses.
 * TODO-OWNER: ending rules remain undecided; fixtures carry explicit endingSoon.
 * TODO-OWNER: mock contracts and collateral absent from the mockup are nullable
 * (round 2 item C). They must be supplied before constructing ThesisAiContext.
 * Mock records are not validated onchain contexts or database insert payloads.
 */
export type ThesisDirection = "bull" | "bear";
export type ThesisStatus = "draft" | "pending" | "open" | "expired" | "settled" | "cancelled";
export type PositionSide = "back" | "counter";
export type PositionStatus = "pending" | "confirmed" | "indexed" | "expired" | "settled" | "failed";
/** Exact shared interface; never change without updating PRD and teammate. */
export interface ThesisAiContext {
    thesis: {
        id: string;
        headline: string;
        rationale: string | null;
        direction: ThesisDirection;
        status: ThesisStatus;
        createdAt: string;
    };
    creator: {
        walletAddress: string;
        displayName: string | null;
    };
    market: {
        chainId: 8453;
        underlyingAsset: string;
        currentSpotPriceUsd: string | null;
        expiryAt: string;
        dataAsOf: string;
    };
    structure: {
        productType: string;
        isCall: boolean;
        isLong: boolean;
        strikesUsd: string[];
        collateralSymbol: string;
        contracts: string;
    };
    economics: {
        entryPremiumUsd: string | null;
        entryFeesUsd: string | null;
        maximumLossUsd: string | null;
        maximumPayoutUsd: string | null;
        breakEvenPricesUsd: string[];
        estimatedPnlUsd: string | null;
        finalPnlUsd: string | null;
        settlementPriceUsd: string | null;
    };
    verification: {
        transactionHash: string | null;
        optionAddress: string | null;
        confirmedOnchain: boolean;
    };
}
export type Creator = ThesisAiContext["creator"] & {
    id: string;
    handle: string;
    initials: string;
    mockWalletFragment: string | null;
    sinceLabel: string | null;
    winRatePct: number | null;
    thesesCount: number | null;
    followers: number | null;
    netPnlUsd: string | null;
    verifiedPnl30dUsd: string | null;
    creatorPayoutsUsd: string | null;
    biggestLossUsd: string | null;
};
export interface SideStats {
    pct: number;
    count: number;
    amountUsd: string;
    signed: boolean;
}
export interface Thesis extends Omit<ThesisAiContext, "creator" | "structure"> {
    id: string;
    slug: string;
    creatorUserId: string;
    creatorPositionId: string | null;
    creator: Creator;
    structure: Omit<ThesisAiContext["structure"], "contracts" | "collateralSymbol"> & {
        contracts: string | null;
        collateralSymbol: string | null;
        legs: {
            strikeUsd: string;
            isCall: boolean;
            isLong: boolean;
        }[];
    };
    endingSoon: boolean;
    mock: {
        settledAgoMinutes: number | null;
        settledWinner: ThesisDirection | null;
        maxPayoutMultiple: string | null;
        premiumPerContractUsd: string | null;
        payoutPerContractUsd: string | null;
        transactionFragment: string | null;
    };
    pooledUsd: string | null;
    bull: SideStats;
    bear: SideStats;
    earningsUsd: string;
    fills: number;
    likes: number;
    commentCount: number;
}
export interface Position {
    id: string;
    thesisId: string;
    userId: string;
    role: "creator" | "participant";
    side: PositionSide;
    status: PositionStatus;
    chainId: 8453;
    walletAddress: string;
    thesisSlug: string;
    thesisHeadline: string;
    underlyingAsset: string;
    contracts: string | null;
    entrySpotPriceUsd: string | null;
    economics: ThesisAiContext["economics"];
    verification: ThesisAiContext["verification"];
    createdAt: string;
    mockTransactionFragment: string | null;
}
export interface Participant extends Position {
    creator: Creator;
    says: string;
}
export interface Comment {
    creator: Creator;
    createdAt: string;
    body: string;
}
export interface ActivityItem {
    creator: Creator;
    action: string;
    side: PositionSide | null;
    amountUsd: string;
    contracts: string | null;
    soldStructure: string | null;
    transactionHash: string | null;
    mockTransactionFragment: string | null;
}
export interface TrendingItem {
    slug: string;
    underlyingAsset: string;
    headline: string;
    creatorHandle: string;
    remainingDays: number;
    estimatedPnlUsd: string;
    bullPct: number;
}
export interface Ticket {
    sideNote: string;
    maximumLossUsd: string;
    collateralSymbol: string;
    presetsUsd: string[];
    orderLabel: string;
    contracts: string;
    maximumPayoutUsd: string;
    breakEvenPricesUsd: string[];
    liquidityLeftUsd: string;
}
export interface ThesisDetail {
    thesis: Thesis;
    shareUrl: string;
    shareHeadline: string;
    settlementLabel: string;
    spotChangePct: string;
    participants: Participant[];
    comments: Comment[];
    activity: ActivityItem[];
    activityCount: number;
    participantCount: number;
    ticket: Ticket;
}
