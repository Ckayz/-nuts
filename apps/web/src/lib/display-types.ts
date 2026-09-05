/** Presentation-only values, produced by lib/display.ts. Never pass to the shared AI contract. */
import type { TextToken } from "./thesis/links";
export type { TextToken };
export interface DisplayAmount {
    raw: string;
    usd: string;
    usd2: string;
    signed: string;
    /** Signed to two decimals, e.g. "+$39.95". ADDED for the position page's hero
     *  figure, where rounding a P&L to whole dollars would hide real cents. */
    signed2: string;
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
    /** Route segment: the stored handle, or the full lowercase wallet address when none is set. */
    handle: string;
    /** What is printed after "@": the handle, or the address shortened (`0xd990…512e`) when the handle IS the address. */
    handleLabel: string;
    /** The display name, or the shortened address when the person has not set one. Never "—". */
    displayName: string;
    /** Two-letter monogram used by the `.av` avatar. */
    initials: string;
    /** Full lowercase wallet address, else creator id, else handle; stable across profile edits. */
    avatarSeed: string;
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
    /**
     * The direction the author took, from `theses.direction`. Null on a post
     * that names no structure — the column is part of the null-or-complete
     * structure group (`lib/data/map.ts`), so "no structure" and "no direction"
     * are the same state.
     *
     * This is the ONLY honest direction a post carries. `structure.side` is
     * hard-coded `"bull"` by `lib/display.ts`, and `backingCard.side` is
     * hard-coded `"back"` by `lib/position/view.ts` ("the creator backs their
     * own thesis"), so neither of those two says anything about the market.
     */
    direction: Side | null;
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
    /**
     * `note` split into text and `/p/<uuid>` link tokens. ADDED for the trade
     * card; optional so a `Thesis` built before this round stays valid. Absent
     * means "render `note` as plain text".
     */
    noteTokens?: TextToken[];
    /** One card per linked position that resolved, in link order. Same shape as
     *  every other card in the product (round-1 fold item 9). */
    tradeCards?: PnlCard[];
    /**
     * The creator's own fill, as the same card. Null when the post is not backed.
     * `backing` above still carries the rail's one-line meta and the sides; this
     * is the card the post renders.
     */
    backingCard?: PnlCard | null;
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
    /** `positions.id`. Every position has its own page at `/p/<id>`. */
    id: string;
    /** Null for a standalone position, which belongs to no post. */
    thesisSlug: string | null;
    /** Null for a standalone position. */
    thesisHeadline: string | null;
    asset: string;
    side: Side;
    riskedUsd: DisplayAmount;
    livePnlUsd: DisplayAmount;
    contracts?: string;
    entryUsd?: DisplayAmount;
    tx?: TxRef;
    settled: boolean;
    /**
     * D5. The lifecycle vocabulary and the P&L basis, so a list row does not
     * render an EXPIRED position identically to an open one.
     *
     * These rows used to carry `settled: boolean` alone: "Open · syncing",
     * "Settlement pending" and "Failed" all looked the same, and the number
     * beside them was printed with no statement of where it came from. Same
     * words as the share card (`POSITION_STATUS_DISPLAY`, PRD 8.5), so a
     * position reads the same in a list as on its own page.
     */
    statusLabel: string;
    statusTone: ThesisStatus;
    /** "Result" once settled, "Live P&L" otherwise — the card's own wording. */
    pnlLabel: string;
    /** One factual sentence naming where the number came from. */
    pnlBasisLabel: string;
    basis: PnlBasis;
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
    structures: MarketStructure[];
    ticket: Ticket;
    /** The selected structure, spelled out above the ticket. */
    selectedLabel: string;
    /** Expiry of the selected structure, e.g. "11 Sep 26 08:00 UTC". */
    selectedExpiryLabel: string;
}

/**
 * How a position's P&L number was arrived at. Rendered as its own sentence next
 * to the number so an estimate is never read as a settled result (PRD 14).
 */
export type PnlBasis = "settled" | "estimate" | "derived" | "unavailable";
/** One of the three tiles under the big P&L figure. */
export interface PnlStat {
    label: string;
    /** Already formatted, "—" when unavailable. */
    value: string;
}
/**
 * The share card a trader copies a link to: owner, status, instrument, one big
 * signed P&L figure, three stat tiles. Same shape at both sizes; `compact` is a
 * render option, not a different card.
 */
export interface PnlCard {
    /** `positions.id`; this card's own page is `/p/<id>`. */
    id: string;
    owner: Creator;
    /** Status chip copy, e.g. "Open" or "Settlement pending". */
    statusLabel: string;
    /** Which chip tone to use; reuses the post chip classes. */
    statusTone: ThesisStatus;
    /** Date the fill was recorded, e.g. "5 Sep 2026". */
    dateLabel: string;
    /** The card's title line, e.g. "BTC put spread"; the mockup's `.tc-inst`
     *  and `.sc-inst`. Never empty. */
    instrumentLabel: string;
    /** Null when the order snapshot does not name the underlying. */
    asset: string | null;
    /** Strikes as rendered, e.g. "78,000 / 74,000 P"; null when unknown. The
     *  mockup puts them on the sub-line, not in the title. */
    strikesLabel: string | null;
    /** Expiry chip, e.g. "11 Sep"; the mockup's top-right slot on the compact
     *  card. Null when the record names no expiry. */
    expiryLabel: string | null;
    /** Expiry in full, e.g. "11 Sep 26 08:00 UTC"; the share card's sub-line. */
    expiryFullLabel: string | null;
    /** Market direction. Null when the option identity could not be read. */
    side: Side | null;
    /** "Bull" / "Bear" as rendered. */
    /** Null when the option identity was unreadable: no direction is printed. */
    sideLabel: string | null;
    /** The big number. `"—"` in every field when no honest value exists. */
    pnl: DisplayAmount;
    /** "Result" once settled, "Live P&L" while the option is open. */
    pnlLabel: string;
    /** Percent in brackets with its denominator, e.g. "+38.4% of max loss"; null
     *  when not computable. The share card prints this in full. */
    pnlPctLabel: string | null;
    /** The same percent WITHOUT the denominator, e.g. "+38.4%". The mockup's
     *  compact card prints the bare number and names the denominator on the
     *  basis line under it, so nothing is left unsaid at either size. */
    pnlPctValue: string | null;
    /** What the percent is a percentage OF, e.g. "of max loss"; null with no percent. */
    pnlPctBasis: string | null;
    /** One sentence saying exactly where the number came from. */
    pnlBasisLabel: string;
    basis: PnlBasis;
    /** Left to right under the figure. */
    stats: readonly [PnlStat, PnlStat, PnlStat];
    /** Present only for a fill confirmed onchain (PRD 7.3). */
    tx?: TxRef;
    verified: boolean;
}
/** Everything `/p/[id]` renders. */
export interface PositionPage {
    card: PnlCard;
    /** `users.handle` or wallet address of the owner; the href is built as `/u/${ownerHandle}`. */
    ownerHandle: string;
    /** The post this position backs; null for a standalone fill. */
    thesis: { slug: string; headline: string } | null;
    /** Market page slug, e.g. "btc"; null when the underlying is unknown. */
    marketSlug: string | null;
    /** Structure id to preselect on the market page; null when the option has expired
     *  or the instrument is unknown, so the link never points at nothing. */
    structureId: string | null;
    /** Label + value rows under the card. */
    facts: readonly { label: string; value: string }[];
}
