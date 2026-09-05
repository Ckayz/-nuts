/** Pure domain → presentation boundary. Decimal values are never used for trading math. */
import type * as Domain from "@/types";
import type * as View from "./display-types";
import { renderTextWithLinks, tradeLinkHref } from "./thesis/links";
/** Validate and split decimal strings without a binary floating-point conversion. */
function decimal(value: string) {
    if (!/^-?\d+(?:\.\d+)?$/.test(value))
        throw new Error(`Invalid display decimal: ${value}`);
    const negative = value.startsWith("-");
    const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const nonzero = /[1-9]/.test(integer! + fraction);
    return { integer: integer!.replace(/^0+(?=\d)/, ""), fraction, sign: nonzero ? negative ? -1 : 1 : 0 };
}
/** Round magnitude half-up in decimal arithmetic, then group the integer digits. */
function group(value: string, digits = 0): string {
    const { integer, fraction } = decimal(value);
    let scaled = BigInt(integer + fraction.slice(0, digits).padEnd(digits, "0"));
    if ((fraction[digits] ?? "0") >= "5") scaled += BigInt(1);
    const rounded = scaled.toString().padStart(digits + 1, "0");
    const whole = digits ? rounded.slice(0, -digits) : rounded;
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (digits ? `.${rounded.slice(-digits)}` : "");
}
export function amount(value: string | null): View.DisplayAmount {
    if (value === null)
        return { raw: "—", usd: "—", usd2: "—", signed: "—", signed2: "—", pnlClass: "" };
    const { sign } = decimal(value);
    const minus = sign < 0 ? "−" : "";
    return { raw: value, usd: `${minus}$${group(value)}`, usd2: `${minus}$${group(value, 2)}`, signed: `${sign > 0 ? "+" : minus}$${group(value)}`, signed2: `${sign > 0 ? "+" : minus}$${group(value, 2)}`, pnlClass: sign > 0 ? "bull" : sign < 0 ? "bear" : "" };
}
function optionalAmount(value: string | null) { return value === null ? undefined : amount(value); }
/** Preserve the exact input when a nonzero quantity would round to zero. */
export function quantity(value: string | null) {
    if (value === null) return undefined;
    const { sign } = decimal(value);
    const rounded = group(value, 4);
    if (sign !== 0 && rounded === "0.0000") return value;
    return `${sign < 0 ? "-" : ""}${rounded}`;
}
function fragment(value: string, leading = 6, trailing = 4) { return value.length > leading + trailing + 1 ? `${value.slice(0, leading)}…${value.slice(-trailing)}` : value; }
/** Exported for the position page (lib/position), which renders one position's
 *  own transaction link. One implementation, so the truncation and the BaseScan
 *  URL cannot drift between a post and a position. */
export function tx(hash: string | null, mockFragment: string | null): View.TxRef | undefined {
    if (!hash && !mockFragment)
        return undefined;
    return { label: `${hash ? fragment(hash) : mockFragment} ↗`, href: hash ? `https://basescan.org/tx/${hash}` : "#" };
}
function elapsed(createdAt: string, asOf: string) {
    const minutes = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(createdAt)) / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}
/** Exported for the live market page (lib/market), which builds the market View
 *  from OptionBook orders instead of a Domain.Market fixture. Same wording, one
 *  implementation: the mock page and the live page must not drift apart. */
export function expiryLabel(value: string, full = false) {
    const date = new Date(value);
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
    // "11 Sep", not "11 SEP": the mockup writes the month in title case
    // (docs/mockups/thesis-fun-mockup.html, the market table and the trade card).
    if (!full)
        return `${day} ${month}`;
    return `${day} ${month} ${String(date.getUTCFullYear()).slice(-2)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}
function pctLabel(value: string) { return `${decimal(value).sign > 0 ? "+" : ""}${value}%`; }
/** Exported for the live market page (lib/market), which builds the market View
 *  from OptionBook orders instead of a Domain.Market fixture. Same wording, one
 *  implementation: the mock page and the live page must not drift apart. */
export function strikesLabel(strikesUsd: string[], isCall: boolean | null) {
    const strikes = strikesUsd.map(v => group(v)).join(" / ");
    // `null` means the product is neither a call nor a put, so no suffix is
    // printed. See `strikeSide` below.
    return isCall === null ? strikes : `${strikes} ${isCall ? "C" : "P"}`;
}
/**
 * Which suffix a product's strikes carry, or null for none.
 *
 * A RANGER pays inside a band between two strikes: it is neither a call nor a
 * put, and the mockup's market table prints its strikes bare ("72,000 / 88,000",
 * docs/mockups/thesis-fun-mockup.html `#market`). Every other product the book
 * lists is one or the other, and `isCall` decides.
 */
export function strikeSide(productType: string | null, isCall: boolean): boolean | null {
    return productType !== null && /ranger/i.test(productType) ? null : isCall;
}
/** Market slugs are derived from the asset: the book, not a hardcoded list. */
export function marketSlug(asset: string) { return asset.toLowerCase(); }
export function creator(value: Domain.Creator): View.Creator {
    // A person with no name is shown by their shortened address, never by a
    // dash (walkthrough 2026-09-05 F4/F5: "—" reached bylines, the rail, the
    // profile heading and the page <title>; the raw 42-character address as the
    // handle overflowed the rail). The route keeps the full address in `handle`;
    // only the printed text is shortened. TODO-OWNER: the wording for an unnamed
    // person, if anything other than the address.
    const address = value.walletAddress || value.mockWalletFragment || null;
    const handleLabel = /^0x[0-9a-f]{40}$/i.test(value.handle) ? fragment(value.handle) : value.handle;
    return { id: value.id, followerCount: value.followers ?? undefined, handle: value.handle, handleLabel,
        displayName: value.displayName ?? (address === null ? handleLabel : fragment(address)), initials: value.initials,
        avatarSeed: value.walletAddress ? value.walletAddress.toLowerCase() : value.id || value.handle,
        walletAddress: value.walletAddress ? fragment(value.walletAddress) : value.mockWalletFragment ?? undefined,
        sinceLabel: value.sinceLabel ?? undefined, winRatePct: value.winRatePct ?? undefined, thesesCount: value.thesesCount ?? undefined,
        followers: value.followers === null ? undefined : new Intl.NumberFormat("en-US").format(value.followers),
        netPnlUsd: optionalAmount(value.netPnlUsd), verifiedPnl30dUsd: optionalAmount(value.verifiedPnl30dUsd), biggestLossUsd: optionalAmount(value.biggestLossUsd) };
}
function structure(value: Domain.ThesisStructure, expiryAt: string): View.Structure {
    return { ...value, expiryAt, expiryLabel: expiryLabel(expiryAt), strikesLabel: strikesLabel(value.strikesUsd, strikeSide(value.productType, value.isCall)), side: "bull", venueLabel: "Base · OptionBook" };
}
/** The position card's sub-line and side stats; only a backed post has one. */
function backing(value: Domain.Thesis, settled: boolean): View.Backing {
    const back = value.backing!;
    const details: string[] = [];
    if (settled && back.economics.settlementPriceUsd !== null)
        details.push(`Settled ${group(back.economics.settlementPriceUsd, 2)}`);
    else if (value.market?.currentSpotPriceUsd != null)
        details.push(`Spot ${group(value.market.currentSpotPriceUsd, value.market.currentSpotPriceUsd.includes(".") ? value.market.currentSpotPriceUsd.split(".")[1]!.length : 0)}`);
    if (back.mock.payoutPerContractUsd !== null)
        details.push(`payout ${group(back.mock.payoutPerContractUsd)} / ct`);
    else if (value.structure?.contracts != null)
        details.push(`${value.structure.contracts} ct`);
    else if (back.mock.premiumPerContractUsd !== null)
        details.push(`premium ${back.mock.premiumPerContractUsd} / ct`);
    if (back.mock.maxPayoutMultiple !== null)
        details.push(`max payout ${back.mock.maxPayoutMultiple}×`);
    else if (!settled && back.economics.breakEvenPricesUsd[0])
        details.push(`break-even ${back.economics.breakEvenPricesUsd[0]}`);
    if (!settled)
        details.push("Base · OptionBook");
    const stats = (v: Domain.SideStats): View.SideStats => ({ pct: v.pct, count: v.count, amountLabel: v.signed ? amount(v.amountUsd).signed : amount(v.amountUsd).usd });
    return { detailParts: details, detailTx: tx(back.verification.transactionHash, back.mock.transactionFragment),
        creatorRiskedUsd: amount(back.economics.maximumLossUsd),
        creatorLivePnlUsd: amount(settled ? back.economics.finalPnlUsd : back.economics.estimatedPnlUsd),
        creatorPnlLabel: settled ? "Result" : "Live P&L", pooledUsd: amount(back.pooledUsd),
        bull: stats(back.bull), bear: stats(back.bear), settled };
}
/**
 * `siteOrigin` lets an absolute `https://<site>/p/<uuid>` in a rationale be
 * recognised as our own link. It is a SEPARATE function rather than a second
 * parameter of `thesis` because `theses.map(display.thesis)` would otherwise
 * hand the array index in as the origin (the compiler caught exactly that).
 *
 */
export function thesisWithOrigin(value: Domain.Thesis, siteOrigin: string | readonly string[] | undefined): View.Thesis {
    // B3. `expired` is PUBLIC (the rankings admit it) and used to throw here, so
    // one expired post crashed the whole feed. It renders with the settlement-
    // pending presentation the PRD already words (§8.5.3), reusing
    // POSITION_STATUS_DISPLAY.expired so the vocabulary lives in one place.
    // TODO-OWNER: the mockup specifies no presentation for other PRD lifecycle
    // states, so `draft` and `cancelled` still throw — they must never reach a
    // page, and PUBLIC_THESIS_STATUSES keeps them out.
    if (value.thesis.status !== "open" && value.thesis.status !== "settled" && value.thesis.status !== "expired")
        throw new Error(`No mockup presentation for ${value.thesis.status}`);
    const settled = value.thesis.status === "settled";
    const expired = value.thesis.status === "expired";
    // The LIVE / ENDING / SETTLED chip is counted off the expiry, so a post that
    // names no market carries no chip at all rather than an invented one.
    let status: View.ThesisStatus | null = null;
    let statusLabel: string | null = null;
    if (settled) {
        status = "settled";
        statusLabel = `SETTLED · ${value.backing?.mock.settledWinner?.toUpperCase() ?? "—"} WON`;
    } else if (expired) {
        // B3: the option's expiry has passed but Thetanuts has published no
        // settlement, so the post says exactly that and asserts no winner.
        status = POSITION_STATUS_DISPLAY.expired.tone;
        statusLabel = POSITION_STATUS_DISPLAY.expired.label.toUpperCase();
    } else if (value.market !== null && value.market.expiryAt !== null) {
        status = value.endingSoon ? "ending" : "live";
        const hours = Math.max(0, Math.floor((Date.parse(value.market.expiryAt) - Date.parse(value.dataAsOf)) / 3600000));
        statusLabel = `${status.toUpperCase()} · ${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
    }
    // A structure always carries its own expiry (the database keeps the whole
    // structure group null-or-complete), so no expiry means no structure chip.
    const struct = value.structure === null || value.market === null || value.market.expiryAt === null ? null : structure(value.structure, value.market.expiryAt);
    return { id: value.id, slug: value.slug, headline: value.thesis.headline, note: value.thesis.rationale,
        asset: value.market?.underlyingAsset ?? null, creator: creator(value.creator), status, statusLabel,
        postedLabel: settled ? `· settled ${value.backing?.mock.settledAgoMinutes ?? "—"}m` : `· ${elapsed(value.thesis.createdAt, value.dataAsOf)}`,
        tag: value.market === null ? null : { slug: marketSlug(value.market.underlyingAsset), asset: value.market.underlyingAsset, structureLabel: struct === null ? null : `${struct.strikesLabel} · ${struct.expiryLabel}` },
        structure: struct, backing: value.backing === null ? null : backing(value, settled),
        likes: value.likes, likedByViewer: value.likedByViewer, commentCount: value.commentCount,
        // The link tokens are derived from the rationale the author wrote. The
        // CARDS are not built here: `lib/position/view.ts` owns the one card
        // builder (it also owns the P&L rules PRD 13/14 sets) and
        // `lib/page-data.ts` attaches them, so an unresolved link simply stays a
        // link (owner: no error state).
        noteTokens: value.thesis.rationale === null ? undefined : renderTextWithLinks(value.thesis.rationale, siteOrigin) };
}
export function thesis(value: Domain.Thesis): View.Thesis {
    return thesisWithOrigin(value, undefined);
}
/**
 * The ONE card view model, assembled in ONE place.
 *
 * Before this round three view models described the same object — `View.Backing`
 * (the creator's fill under a post), `View.TradeCard` (a `/p/<uuid>` unfurl) and
 * `View.PnlCard` (`/p/[id]` and the post-fill dialog) — each with its own status
 * wording, its own tiles and its own percent basis, so the same fill could read
 * three different ways on three screens. They are now one `View.PnlCard` built
 * here, rendered by one component at two sizes: the mockup's `.tcard` inside a
 * post and its accent-framed `.frame` share card on `/p/[id]` and in the dialog.
 *
 * This function is pure assembly. Whoever calls it has already RESOLVED the P&L
 * (`lib/position/pnl.ts` owns those rules, PRD 13/14) and the risk numbers, so
 * the status table, the tile set, the percent and the date live here once and
 * cannot drift between callers.
 */
export const POSITION_STATUS_DISPLAY: Record<Domain.PositionStatus, { label: string; tone: View.ThesisStatus }> = {
    // TODO-OWNER: `ThesisStatus` display mapping is an open owner item
    // (CLAUDE.md). These reuse the three chip tones the mockup defines and take
    // their words from the PRD, not from invention: 8.5.3 "settlement pending",
    // 13 "confirmed but not indexed: show syncing", 13 "failed transaction: do
    // not publish or count the position".
    pending: { label: "Pending", tone: "settled" },
    confirmed: { label: "Open · syncing", tone: "live" },
    indexed: { label: "Open", tone: "live" },
    expired: { label: "Settlement pending", tone: "ending" },
    settled: { label: "Settled", tone: "settled" },
    failed: { label: "Failed", tone: "ending" },
};

/** The fill's own date, e.g. "5 Sep 2026". UTC, like every other instant here. */
export function dateLabel(iso: string): string {
    const date = new Date(iso);
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
    return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** Decimal string -> scaled BigInt pair, for exact ratio arithmetic. */
function scaled(value: string): { units: bigint; scale: bigint } {
    const negative = value.startsWith("-");
    const [integer = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const units = BigInt(integer + fraction);
    return { units: negative ? -units : units, scale: 10n ** BigInt(fraction.length) };
}

/**
 * `numerator / denominator` as a signed percentage with one decimal place,
 * rounded half-up in integer arithmetic. Null when the denominator is zero or
 * either side is not a plain decimal — a percentage of nothing is not zero.
 */
export function percentLabel(numerator: string, denominator: string): string | null {
    const top = scaled(numerator);
    const bottom = scaled(denominator);
    if (bottom.units === 0n) return null;
    // (top/topScale) / (bottom/bottomScale) * 100, carried to one decimal:
    //   1000 * top.units * bottom.scale / (bottom.units * top.scale)
    const numeratorUnits = 1000n * top.units * bottom.scale;
    const denominatorUnits = bottom.units * top.scale;
    if (denominatorUnits === 0n) return null;
    const negative = numeratorUnits < 0n !== denominatorUnits < 0n;
    const absoluteTop = numeratorUnits < 0n ? -numeratorUnits : numeratorUnits;
    const absoluteBottom = denominatorUnits < 0n ? -denominatorUnits : denominatorUnits;
    // Round half-up on the magnitude, then reapply the sign.
    const tenths = (absoluteTop * 2n + absoluteBottom) / (absoluteBottom * 2n);
    const whole = tenths / 10n;
    const decimalDigit = tenths % 10n;
    const sign = tenths === 0n ? "" : negative ? "\u2212" : "+";
    return `${sign}${whole}.${decimalDigit}%`;
}

/** Everything the card needs that only the caller can know. */
export interface PnlCardInput {
    readonly id: string;
    readonly owner: Domain.Creator;
    readonly status: Domain.PositionStatus;
    /** ISO instant the fill was recorded; the share card's top-right date. */
    readonly createdAt: string;
    /** Title line, e.g. "BTC put spread". Never empty. */
    readonly instrumentLabel: string;
    /** Ticker for the asset monogram; null when the record does not name one. */
    readonly asset: string | null;
    /** Strikes as rendered, e.g. "78,000 / 74,000 P"; null when unknown. */
    readonly strikesLabel: string | null;
    /** Expiry chip, e.g. "11 Sep"; null when unknown. */
    readonly expiryLabel: string | null;
    /** Expiry in full, e.g. "11 Sep 26 08:00 UTC"; null when unknown. */
    readonly expiryFullLabel: string | null;
    readonly side: Domain.PositionSide;
    /** Already resolved by `lib/position/pnl.ts`; never re-derived here. */
    readonly pnl: { readonly usd: string | null; readonly detail: string; readonly basis: View.PnlBasis };
    /** "Premium paid" for a taker who bought, "Collateral locked" for one who sold. */
    readonly entryLabel: string;
    readonly entryUsd: string | null;
    readonly maxLossUsd: string | null;
    readonly maxPayoutUsd: string | null;
    readonly tx: View.TxRef | undefined;
    readonly verified: boolean;
}

export function pnlCard(input: PnlCardInput): View.PnlCard {
    const status = POSITION_STATUS_DISPLAY[input.status];
    const settled = input.status === "settled";
    return {
        id: input.id,
        owner: creator(input.owner),
        statusLabel: status.label,
        statusTone: status.tone,
        dateLabel: dateLabel(input.createdAt),
        instrumentLabel: input.instrumentLabel,
        asset: input.asset,
        strikesLabel: input.strikesLabel,
        expiryLabel: input.expiryLabel,
        expiryFullLabel: input.expiryFullLabel,
        side: input.side === "back" ? "bull" : "bear",
        sideLabel: input.side === "back" ? "Bull" : "Bear",
        pnl: amount(input.pnl.usd),
        pnlLabel: settled ? "Result" : "Live P&L",
        // TODO-OWNER: the denominator. Max loss is the money genuinely at stake,
        // and for a bought option it equals the premium paid, so the two coincide
        // on the common case. The tile it refers to is named in the label so the
        // reader is never left guessing which number it is a percentage of.
        ...(() => {
            const percent =
                input.pnl.usd === null || input.maxLossUsd === null
                    ? null
                    : percentLabel(input.pnl.usd, input.maxLossUsd);
            const basis = "of max loss";
            return {
                pnlPctLabel: percent === null ? null : `${percent} ${basis}`,
                pnlPctValue: percent,
                pnlPctBasis: percent === null ? null : basis,
            };
        })(),
        pnlBasisLabel: input.pnl.detail,
        basis: input.pnl.basis,
        // The ONE tile set (round-1 fold item 11). The mockup's third tile is a
        // spot price, which no record here stores, so the three tiles are the
        // money that went in and the two bounds the risk model gives. A value
        // nobody recorded renders "\u2014", never a zero.
        stats: [
            { label: input.entryLabel, value: amount(input.entryUsd).usd2 },
            { label: "Max loss", value: amount(input.maxLossUsd).usd2 },
            { label: "Max payout", value: amount(input.maxPayoutUsd).usd2 },
        ],
        tx: input.tx,
        verified: input.verified,
    };
}

export function position(value: Domain.Position): View.Position {
    // D5. The list row carries the SAME lifecycle vocabulary and P&L basis the
    // share card does, so an expired or failed position no longer renders
    // identically to an open one and no number is printed without saying where
    // it came from. The P&L itself follows PRD 14's recorded-value rule: a
    // finished option shows its recorded result or nothing, never an estimate.
    const display = POSITION_STATUS_DISPLAY[value.status];
    const settled = value.status === "settled";
    const finished = settled || value.status === "expired";
    const pnlUsd = finished ? value.economics.finalPnlUsd : value.status === "pending" || value.status === "failed" ? null : value.economics.estimatedPnlUsd;
    const basis: View.PnlBasis = pnlUsd === null ? "unavailable" : settled ? "settled" : "estimate";
    const pnlBasisLabel =
        value.status === "failed" ? "This transaction failed, so there is no position."
        : value.status === "pending" ? "This fill has not been confirmed on Base yet."
        : pnlUsd === null && finished ? "Settlement pending: Thetanuts has not published this option's settlement yet."
        : pnlUsd === null ? "No P&L recorded for this fill yet."
        : settled ? "Final P&L recorded at settlement."
        : "Estimated P&L recorded with the fill.";
    return { id: value.id, thesisSlug: value.thesisSlug, thesisHeadline: value.thesisHeadline, asset: value.underlyingAsset, side: value.side === "back" ? "bull" : "bear", riskedUsd: amount(value.economics.maximumLossUsd), livePnlUsd: amount(pnlUsd), contracts: quantity(value.contracts), entryUsd: optionalAmount(value.entrySpotPriceUsd), tx: tx(value.verification.transactionHash, value.mockTransactionFragment), settled,
        statusLabel: display.label, statusTone: display.tone, pnlLabel: settled ? "Result" : "Live P&L", pnlBasisLabel, basis };
}
export function participant(value: Domain.Participant): View.Participant {
    return { ...position(value), creator: creator(value.creator), says: value.says, isCreator: value.role === "creator" };
}
export function activity(value: Domain.ActivityItem): View.ActivityItem {
    if (value.socialDetail !== undefined) return { id: value.id, creator: creator(value.creator), action: value.action, detail: value.socialDetail, offchain: value.transactionHash === null, tx: tx(value.transactionHash, null) ?? { label: "", href: "" } };
    return { creator: creator(value.creator), action: value.action, side: value.side === null ? undefined : value.side === "back" ? "bull" : "bear", detail: `${amount(value.amountUsd).usd} · ${value.contracts !== null ? `${value.contracts} ct` : value.soldStructure}`, tx: tx(value.transactionHash, value.mockTransactionFragment) ?? { label: "—", href: "#" } };
}
export function ticket(value: Domain.Ticket): View.Ticket {
    return { sideNote: value.sideNote, maxLossUsd: amount(value.maximumLossUsd), collateralSymbol: value.collateralSymbol, presetsUsd: value.presetsUsd.map(amount), orderLabel: value.orderLabel, contracts: quantity(value.contracts)!, maxPayoutUsd: amount(value.maximumPayoutUsd), breakEvenUsd: amount(value.breakEvenPricesUsd[0] ?? null), liquidityLeftUsd: amount(value.liquidityLeftUsd) };
}
export function detail(value: Domain.ThesisDetail): View.ThesisDetail {
    const back = value.thesis.backing;
    return { thesis: thesis(value.thesis), shareUrl: value.shareUrl, shareHeadline: value.shareHeadline,
        expiryLabel: value.thesis.market?.expiryAt == null ? null : expiryLabel(value.thesis.market.expiryAt, true),
        settlementLabel: value.settlementLabel, launchedLabel: `launched ${elapsed(value.thesis.thesis.createdAt, value.thesis.dataAsOf)} ago`,
        maxPayoutUsd: amount(back?.economics.maximumPayoutUsd ?? null), breakEvenUsd: amount(back?.economics.breakEvenPricesUsd[0] ?? null),
        participants: value.participants.map(participant),
        comments: value.comments.map(v => ({ creator: creator(v.creator), postedLabel: `· ${elapsed(v.createdAt, value.thesis.dataAsOf)}`, body: v.body })),
        activity: value.activity.map(activity), activityCount: value.activityCount, participantCount: value.participantCount };
}
export function price(value: {
    underlyingAsset: string;
    currentSpotPriceUsd: string;
    changePct: string;
}) {
    return { asset: value.underlyingAsset, price: group(value.currentSpotPriceUsd, 2), change: pctLabel(value.changePct) };
}
function marketStructure(value: Domain.MarketStructure, selectedId: string): View.MarketStructure {
    return { id: value.id, expiryLabel: expiryLabel(value.expiryAt), productType: `${value.productType.charAt(0).toUpperCase()}${value.productType.slice(1)}`,
        strikesLabel: strikesLabel(value.strikesUsd, strikeSide(value.productType, value.isCall)), premiumPerContractUsd: amount(value.premiumPerContractUsd),
        maxPayoutLabel: `${value.maxPayoutMultiple}×`, liquidityLeftUsd: amount(value.liquidityLeftUsd), selected: value.id === selectedId };
}
export function marketSummary(value: Domain.Market): View.MarketSummary {
    return { slug: value.slug, asset: value.underlyingAsset, name: value.name, spotUsd: amount(value.currentSpotPriceUsd),
        changeLabel: pctLabel(value.changePct), changeClass: amount(value.changePct).pnlClass };
}
export function market(value: Domain.Market): View.Market {
    const selected = value.structures.find(s => s.id === value.selectedStructureId);
    if (!selected) throw new Error(`Market ${value.slug} selects a structure it does not list: ${value.selectedStructureId}`);
    const expiries = new Set(value.structures.map(s => s.expiryAt));
    return { ...marketSummary(value), venueLabel: "Base · Thetanuts OptionBook",
        bookLabel: `${value.structures.length} structures · ${expiries.size} expiries`,
        structureCount: value.structures.length, expiryCount: expiries.size,
        // Number() only after the same decimal validation every other value gets:
        // the chart library plots pixels from it, nothing else reads it.
        structures: value.structures.map(s => marketStructure(s, value.selectedStructureId)),
        ticket: ticket(value.ticket),
        selectedLabel: `${value.underlyingAsset} ${selected.productType} ${strikesLabel(selected.strikesUsd, strikeSide(selected.productType, selected.isCall))}`,
        selectedExpiryLabel: expiryLabel(selected.expiryAt, true) };
}
