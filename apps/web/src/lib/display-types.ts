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
    id?: string;
    followerCount?: number;
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
/**
 * The creator's own fill behind a post. Present only on a backed post, which is
 * the only post that shows the verified badge and the position card.
 */
export interface Backing {
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
    settled: boolean;
}
/** Where a post's market/structure chips link to, and what they read. */
export interface Tag {
    /** Market page slug, e.g. "btc"; the href is built as `/m/${slug}` so
     *  Next's typedRoutes can check it. */
    slug: string;
    /** Asset ticker as rendered, e.g. "BTC". */
    asset: string;
    /** Structure chip copy, e.g. "78,000 / 74,000 P · 11 SEP"; null when the
     *  post names a market but no structure. */
    structureLabel: string | null;
}
export interface Thesis {
    id: string;
    slug: string;
    headline: string;
    /** PRD `thesis.rationale`. */
    note: string | null;
    creator: Creator;
    /** Null on a pure text opinion: the post names no market. */
    asset: string | null;
    /** Null when there is no expiry to count a chip down from. */
    status: ThesisStatus | null;
    /** Status chip copy, e.g. "LIVE · 6d 14h". */
    statusLabel: string | null;
    /** Relative time as rendered in the post byline, e.g. "· 18m". */
    postedLabel: string;
    /** Null when the post names no market. */
    tag: Tag | null;
    /** Null when the post names no tradable structure. */
    structure: Structure | null;
    /** Null when the creator has not backed the post with their own fill. */
    backing: Backing | null;
    likes: number;
    likedByViewer: boolean;
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
    id?: string;
    offchain?: boolean;
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
/** Everything the post thread page renders beyond the feed-level `Thesis`. */
export interface ThesisDetail {
    thesis: Thesis;
    /** Share URL as rendered, e.g. "thesis.fun/t/btc-nfp-4a2c". */
    shareUrl: string;
    /** Truncated headline used on the share card. */
    shareHeadline: string;
    /** Expiry as rendered in the hero, e.g. "11 Sep 26 08:00 UTC"; null with no market. */
    expiryLabel: string | null;
    /** Null when no settlement wording is available; the database holds none. */
    settlementLabel: string | null;
    launchedLabel: string;
    maxPayoutUsd: DisplayAmount;
    breakEvenUsd: DisplayAmount;
    participants: Participant[];
    comments: Comment[];
    activity: ActivityItem[];
    activityCount: number;
    participantCount: number;
}
/** The "Take a side" ticket. It lives on the market page, never inside a post. */
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
/** One row of the market page's live-structures table. */
export interface MarketStructure {
    id: string;
    /** e.g. "11 SEP". */
    expiryLabel: string;
    /** Sentence-case product, e.g. "Put spread". */
    productType: string;
    /** e.g. "78,000 / 74,000 P". */
    strikesLabel: string;
    premiumPerContractUsd: DisplayAmount;
    /** e.g. "4.6×". */
    maxPayoutLabel: string;
    liquidityLeftUsd: DisplayAmount;
    selected: boolean;
}
/** One point of the price chart. Both fields are numbers only because the chart
 *  library draws pixels from them; neither is used for trading math. `time` is a
 *  UTC epoch in seconds. */
export interface SeriesPoint {
    time: number;
    value: number;
}
export interface MarketSummary {
    slug: string;
    asset: string;
    name: string;
    spotUsd: DisplayAmount;
    /** Change as rendered, e.g. "+1.65%". */
    changeLabel: string;
    changeClass: string;
}
export interface Market extends MarketSummary {
    /** Venue chip copy, e.g. "Base · Thetanuts OptionBook". */
    venueLabel: string;
    /** e.g. "12 structures · 4 expiries". */
    bookLabel: string;
    structureCount: number;
    expiryCount: number;
    series: SeriesPoint[];
    structures: MarketStructure[];
    ticket: Ticket;
    /** The selected structure, spelled out above the ticket. */
    selectedLabel: string;
    /** Expiry of the selected structure, e.g. "11 Sep 26 08:00 UTC". */
    selectedExpiryLabel: string;
}
