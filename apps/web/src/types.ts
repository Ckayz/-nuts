/**
 * Domain types: PRD §10.3 names, decimal strings and lifecycle enums.
 * Owner notes: LIVE / ENDING / SETTLED are display chips, not domain statuses.
 * TODO-OWNER: ending rules remain undecided; fixtures carry explicit endingSoon.
 * TODO-OWNER: mock contracts and collateral absent from the mockup are nullable
 * (round 2 item C). They must be supplied before constructing ThesisAiContext.
 * Mock records are not validated onchain contexts or database insert payloads.
 *
 * Round 6 (owner 2026-09-05, "a pure text opinion is fine also"): a thesis is a
 * post. Text is required; the market and structure it names are optional; the
 * creator's own backing fill is optional. `ThesisAiContext` below is untouched —
 * it is the frozen shared contract, and only a backed thesis can fill it.
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
    biggestLossUsd: string | null;
};
export interface SideStats {
    pct: number;
    count: number;
    /**
     * Null means the total is unavailable, not zero: a source row that is not a
     * plain decimal (a `numeric` column can legally hold `NaN`) degrades to "—"
     * rather than claiming a figure. Never negative.
     */
    amountUsd: string | null;
    signed: boolean;
}
/** The tradable structure a post names. Optional: a post may be text only. */
export type ThesisStructure = Omit<ThesisAiContext["structure"], "contracts" | "collateralSymbol"> & {
    contracts: string | null;
    collateralSymbol: string | null;
    legs: {
        strikeUsd: string;
        isCall: boolean;
        isLong: boolean;
    }[];
};
/**
 * The creator's own fill behind a post, and the sides other traders took on it.
 * Absent when the creator only wrote an opinion.
 */
export interface ThesisBacking {
    creatorPositionId: string;
    economics: ThesisAiContext["economics"];
    verification: ThesisAiContext["verification"];
    pooledUsd: string | null;
    bull: SideStats;
    bear: SideStats;
    mock: {
        settledAgoMinutes: number | null;
        settledWinner: ThesisDirection | null;
        maxPayoutMultiple: string | null;
        premiumPerContractUsd: string | null;
        payoutPerContractUsd: string | null;
        transactionFragment: string | null;
    };
}
export interface Thesis {
    id: string;
    slug: string;
    creatorUserId: string;
    creator: Creator;
    /**
     * `direction` is null when the post names no structure: DB round 7 keeps the
     * whole structure group (direction included) null-or-complete, so nothing is
     * invented for a pure text opinion. `ThesisAiContext.thesis` above keeps its
     * required `direction`; only a structured post can fill the shared contract.
     */
    thesis: Omit<ThesisAiContext["thesis"], "direction"> & {
        direction: ThesisDirection | null;
    };
    /**
     * Snapshot instant every relative label on this post is measured from. It
     * supplies `ThesisAiContext.market.dataAsOf`, so the shared contract keeps
     * exactly the fields PRD §10.3 lists and there is one source of truth here.
     */
    dataAsOf: string;
    /**
     * Null for a pure text opinion: the post names no market.
     *
     * `expiryAt` is null when the post tags a market but names no structure —
     * the state DB round 7 allows (`tagged_asset` set, every structure column
     * null). Only a fully structured post can fill `ThesisAiContext.market`,
     * whose own `expiryAt` stays required.
     */
    market: (Omit<ThesisAiContext["market"], "dataAsOf" | "expiryAt"> & {
        expiryAt: string | null;
    }) | null;
    /** Null when the post names no tradable structure. */
    structure: ThesisStructure | null;
    /** Null when the creator has not filled a position behind this post. */
    backing: ThesisBacking | null;
    endingSoon: boolean;
    likes: number;
    /** Whether the connected wallet has liked this post. */
    likedByViewer: boolean;
    commentCount: number;
}
export interface Position {
    id: string;
    /** Null for a standalone position (migration 0007). */
    thesisId: string | null;
    userId: string;
    role: "creator" | "participant" | "standalone";
    side: PositionSide;
    status: PositionStatus;
    chainId: 8453;
    walletAddress: string;
    /** Null for a standalone position: migration 0007 made `positions.thesis_id`
     *  nullable, so a fill can belong to no post at all (owner 2026-09-05,
     *  "trade is just trade"). */
    thesisSlug: string | null;
    /** Null for a standalone position, for the same reason. */
    thesisHeadline: string | null;
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
/** The post thread page: the post, what it is tagged to, and the replies. */
export interface ThesisDetail {
    thesis: Thesis;
    shareUrl: string;
    shareHeadline: string;
    /** Null when no settlement wording is available for this thesis. */
    settlementLabel: string | null;
    /** Null when no spot series is available; the database holds no price feed. */
    spotChangePct: string | null;
    participants: Participant[];
    comments: Comment[];
    activity: ActivityItem[];
    activityCount: number;
    participantCount: number;
}
/** One live option structure the OptionBook has liquidity for. */
export interface MarketStructure {
    id: string;
    expiryAt: string;
    productType: string;
    isCall: boolean;
    strikesUsd: string[];
    premiumPerContractUsd: string;
    maxPayoutMultiple: string;
    liquidityLeftUsd: string;
}
/** A per-asset market page: price history, the live book, and the ticket. */
export interface Market {
    slug: string;
    chainId: 8453;
    underlyingAsset: string;
    name: string;
    currentSpotPriceUsd: string;
    changePct: string;
    dataAsOf: string;
    /** Hourly closes, oldest first. `time` is a UTC epoch in SECONDS, the unit
     *  the chart library's `UTCTimestamp` uses. */
    series: {
        time: number;
        priceUsd: string;
    }[];
    structures: MarketStructure[];
    /** Which structure the ticket is quoting; must be one of `structures`. */
    selectedStructureId: string;
    ticket: Ticket;
    /** Slugs of the theses tagged to this market, most recent first. */
    taggedThesisSlugs: string[];
}
