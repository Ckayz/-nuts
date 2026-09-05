/** Presentation-only values, produced by lib/display.ts. Never pass to the shared AI contract. */
export interface DisplayAmount {
    raw: string;
    usd: string;
    usd2: string;
    signed: string;
    pnlClass: string;
}
export type Side = "bull" | "bear";
/** Display status, from the mockup's `.live` / `.live.ending` / `.live.settled` chips. */
export type ThesisStatus = "live" | "ending" | "settled";
export interface TxRef {
    /** Truncated hash as rendered, e.g. "0x5d…aa". */
    label: string;
    href: string;
}
export interface Creator {
    handle: string;
    displayName: string;
    /** Two-letter monogram used by the `.av` avatar. */
    initials: string;
    walletAddress?: string;
    /** Rendered verbatim next to the address, e.g. "since Jun 26". */
    sinceLabel?: string;
    winRatePct?: number;
    thesesCount?: number;
    followers?: string;
    /** Leaderboard net P&L over the selected window. */
    netPnlUsd?: DisplayAmount;
    verifiedPnl30dUsd?: DisplayAmount;
    biggestLossUsd?: DisplayAmount;
}
export interface StructureLeg {
    strikeUsd: string;
    isCall: boolean;
    isLong: boolean;
}
export interface Structure {
    /** e.g. "put spread", "put", "call spread". */
    productType: string;
    isCall: boolean;
    isLong: boolean;
    legs: StructureLeg[];
    strikesUsd: string[];
    /** ISO 8601 instant the option expires. */
    expiryAt: string;
    /** Expiry chip copy, e.g. "11 SEP". */
    expiryLabel: string;
    /** Strike chip copy, e.g. "78,000 / 74,000 P". */
    strikesLabel: string;
    side: Side;
    collateralSymbol: string | null;
    contracts: string | null;
    /** Venue chip copy, e.g. "Base · OptionBook". */
    venueLabel: string;
}
export interface SideStats {
    pct: number;
    count: number;
    /** Dollar figure exactly as rendered, e.g. "$7,920" or "+$3,455". */
    amountLabel: string;
}
export interface Thesis {
    id: string;
    slug: string;
    headline: string;
    /** PRD `thesis.rationale`. */
    note: string | null;
    asset: string;
    chainId: 8453;
    creator: Creator;
    status: ThesisStatus;
    /** Status chip copy, e.g. "LIVE · 6d 14h". */
    statusLabel: string;
    /** Relative time as rendered in the post byline, e.g. "· 18m". */
    postedLabel: string;
    structure: Structure;
    /** Sub-line of the position card, joined with " · " when rendered. */
    detailParts: string[];
    detailTx?: TxRef;
    creatorRiskedUsd: DisplayAmount;
    creatorLivePnlUsd: DisplayAmount;
    /** "Live P&L" while open, "Result" once settled. */
    creatorPnlLabel: string;
    pooledUsd: DisplayAmount;
    bull: SideStats;
    bear: SideStats;
    fills: number;
    likes: number;
    commentCount: number;
}
export interface Participant {
    creator: Creator;
    side: Side;
    riskedUsd: DisplayAmount;
    /** Optional: a row can exist before the indexer has the fill detail. */
    contracts?: string;
    entryUsd?: DisplayAmount;
    livePnlUsd: DisplayAmount;
    says: string;
    tx?: TxRef;
    isCreator?: boolean;
}
export interface Position {
    thesisSlug: string;
    thesisHeadline: string;
    asset: string;
    side: Side;
    riskedUsd: DisplayAmount;
    livePnlUsd: DisplayAmount;
    contracts?: string;
    entryUsd?: DisplayAmount;
    tx?: TxRef;
    settled: boolean;
}
export interface ActivityItem {
    creator: Creator;
    /** Verb as rendered, e.g. "joined", "took", "launched". */
    action: string;
    side?: Side;
    /** Sub-line as rendered, e.g. "$250 · 0.0031 ct". */
    detail: string;
    tx: TxRef;
}
export interface Comment {
    creator: Creator;
    /** Relative time as rendered, e.g. "· 11m". */
    postedLabel: string;
    body: string;
}
export interface TrendingItem {
    slug: string;
    asset: string;
    headline: string;
    creatorHandle: string;
    /** Time-left chip, e.g. "6d". */
    timeLabel: string;
    pnlUsd: DisplayAmount;
    bullPct: number;
}
/** Everything the thesis page renders beyond the feed-level `Thesis`. */
export interface ThesisDetail {
    thesis: Thesis;
    /** Share URL as rendered, e.g. "thesis.fun/t/btc-nfp-4a2c". */
    shareUrl: string;
    /** Truncated headline used on the share card. */
    shareHeadline: string;
    /** Expiry as rendered in the hero, e.g. "11 Sep 26 08:00 UTC". */
    expiryLabel: string;
    settlementLabel: string | null;
    launchedLabel: string;
    spotUsd: DisplayAmount;
    /** Spot change as rendered, e.g. "+1.65%"; null when there is no spot series. */
    spotChangeLabel: string | null;
    maxPayoutUsd: DisplayAmount;
    breakEvenUsd: DisplayAmount;
    participants: Participant[];
    comments: Comment[];
    activity: ActivityItem[];
    activityCount: number;
    participantCount: number;
    ticket: Ticket | null;
}
/** The "Take a side" ticket. */
export interface Ticket {
    /** Copy under the Bull/Bear segmented control. */
    sideNote: string;
    maxLossUsd: DisplayAmount;
    collateralSymbol: string;
    presetsUsd: DisplayAmount[];
    orderLabel: string;
    contracts: string;
    maxPayoutUsd: DisplayAmount;
    breakEvenUsd: DisplayAmount;
    liquidityLeftUsd: DisplayAmount;
}
