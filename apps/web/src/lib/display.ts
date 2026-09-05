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
        return { raw: "—", usd: "—", usd2: "—", signed: "—", pnlClass: "" };
    const { sign } = decimal(value);
    const minus = sign < 0 ? "−" : "";
    return { raw: value, usd: `${minus}$${group(value)}`, usd2: `${minus}$${group(value, 2)}`, signed: `${sign > 0 ? "+" : minus}$${group(value)}`, pnlClass: sign > 0 ? "bull" : sign < 0 ? "bear" : "" };
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
function tx(hash: string | null, mockFragment: string | null): View.TxRef | undefined {
    if (!hash && !mockFragment)
        return undefined;
    return { label: `${hash ? fragment(hash) : mockFragment} ↗`, href: hash ? `https://basescan.org/tx/${hash}` : "#" };
}
function elapsed(createdAt: string, asOf: string) {
    const minutes = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(createdAt)) / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`;
}
function expiryLabel(value: string, full = false) {
    const date = new Date(value);
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
    if (!full)
        return `${day} ${month.toUpperCase()}`;
    return `${day} ${month} ${String(date.getUTCFullYear()).slice(-2)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
}
function pctLabel(value: string) { return `${decimal(value).sign > 0 ? "+" : ""}${value}%`; }
function strikesLabel(strikesUsd: string[], isCall: boolean) { return `${strikesUsd.map(v => group(v)).join(" / ")} ${isCall ? "C" : "P"}`; }
/** Market slugs are derived from the asset: the book, not a hardcoded list. */
export function marketSlug(asset: string) { return asset.toLowerCase(); }
export function creator(value: Domain.Creator): View.Creator {
    return { id: value.id, followerCount: value.followers ?? undefined, handle: value.handle, displayName: value.displayName ?? "—", initials: value.initials,
        walletAddress: value.walletAddress ? fragment(value.walletAddress) : value.mockWalletFragment ?? undefined,
        sinceLabel: value.sinceLabel ?? undefined, winRatePct: value.winRatePct ?? undefined, thesesCount: value.thesesCount ?? undefined,
        followers: value.followers === null ? undefined : new Intl.NumberFormat("en-US").format(value.followers),
        netPnlUsd: optionalAmount(value.netPnlUsd), verifiedPnl30dUsd: optionalAmount(value.verifiedPnl30dUsd), biggestLossUsd: optionalAmount(value.biggestLossUsd) };
}
function structure(value: Domain.ThesisStructure, expiryAt: string): View.Structure {
    return { ...value, expiryAt, expiryLabel: expiryLabel(expiryAt), strikesLabel: strikesLabel(value.strikesUsd, value.isCall), side: "bull", venueLabel: "Base · OptionBook" };
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
 * GAP: nothing configures a site origin today — `packages/env` defines none and
 * `vercelOrigin` there is exported but unused — so no caller passes one yet and
 * only path-only `/p/<uuid>` links unfurl. That is the safe direction: a link
 * that cannot be PROVEN same-origin stays plain text.
 */
export function thesisWithOrigin(value: Domain.Thesis, siteOrigin: string | undefined): View.Thesis {
    // TODO-OWNER: the mockup specifies no presentation for other PRD lifecycle states.
    if (value.thesis.status !== "open" && value.thesis.status !== "settled")
        throw new Error(`No mockup presentation for ${value.thesis.status}`);
    const settled = value.thesis.status === "settled";
    // The LIVE / ENDING / SETTLED chip is counted off the expiry, so a post that
    // names no market carries no chip at all rather than an invented one.
    let status: View.ThesisStatus | null = null;
    let statusLabel: string | null = null;
    if (settled) {
        status = "settled";
        statusLabel = `SETTLED · ${value.backing?.mock.settledWinner?.toUpperCase() ?? "—"} WON`;
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
        // The link tokens are derived from the rationale the author wrote; the
        // cards come from whichever of those links the reads actually resolved,
        // so an unresolved link simply stays a link (owner: no error state).
        noteTokens: value.thesis.rationale === null ? undefined : renderTextWithLinks(value.thesis.rationale, siteOrigin),
        tradeCards: (value.linkedPositions ?? []).map(tradeCard) };
}
export function thesis(value: Domain.Thesis): View.Thesis {
    return thesisWithOrigin(value, undefined);
}
/**
 * Signed percent of `base`, rounded half-up to one decimal, in exact decimal
 * arithmetic — the same discipline `group` above uses, so no money value is
 * ever routed through binary floating point. Null when either side is missing
 * or the base is zero (there is no percentage of nothing).
 */
function signedPercent(value: string, base: string): string | null {
    const numerator = decimal(value);
    const denominator = decimal(base);
    const places = Math.max(numerator.fraction.length, denominator.fraction.length);
    const scale = (parts: { integer: string; fraction: string }) =>
        BigInt(parts.integer + parts.fraction.padEnd(places, "0"));
    // Magnitudes only; the sign is carried separately so the rounding below
    // stays half-up on the magnitude rather than half-up towards +infinity.
    const top = scale(numerator) * 1000n;
    const bottom = scale(denominator);
    if (bottom === 0n) return null;
    const tenths = (top + bottom / 2n) / bottom;
    const sign = numerator.sign * denominator.sign;
    const whole = tenths / 10n;
    const digit = tenths % 10n;
    if (sign === 0) return `0.0%`;
    return `${sign > 0 ? "+" : "\u2212"}${group(`${whole}`)}.${digit}%`;
}

/**
 * The compact card a post's `/p/<uuid>` link unfurls into.
 *
 * Every figure comes from the position row; nothing is estimated. A value the
 * database does not hold renders as "\u2014" rather than a zero.
 *
 * TODO-OWNER: the mockup specifies no trade card, so the three tiles (Risked /
 * Premium / Max payout), the status chip wording and the percent BASIS (P&L
 * over maximum loss, shown on screen as "of risked") are the minimum honest
 * presentation of the columns that exist, not approved product copy.
 */
export function tradeCard(value: Domain.LinkedPosition): View.TradeCard {
    const settled = value.position.status === "settled";
    const economics = value.position.economics;
    const pnlRaw = settled ? economics.finalPnlUsd : economics.estimatedPnlUsd;
    const risked = economics.maximumLossUsd;
    const percent = pnlRaw === null || risked === null ? null : signedPercent(pnlRaw, risked);
    return {
        positionId: value.position.id,
        href: tradeLinkHref(value.position.id),
        owner: creator(value.owner),
        statusLabel: value.position.status.toUpperCase(),
        settled,
        instrumentLabel: value.position.underlyingAsset === "" ? "\u2014" : value.position.underlyingAsset,
        side: value.position.side === "back" ? "bull" : "bear",
        sideLabel: value.position.side === "back" ? "Bull" : "Bear",
        pnlUsd: amount(pnlRaw),
        pnlLabel: settled ? "Result" : "Live P&L",
        pnlPct: percent === null ? null : { value: percent, basis: "of risked" },
        stats: [
            { label: "Risked", value: amount(risked).usd },
            { label: "Premium", value: amount(economics.entryPremiumUsd).usd },
            { label: "Max payout", value: amount(economics.maximumPayoutUsd).usd },
        ],
    };
}

export function position(value: Domain.Position): View.Position {
    return { thesisSlug: value.thesisSlug, thesisHeadline: value.thesisHeadline, asset: value.underlyingAsset, side: value.side === "back" ? "bull" : "bear", riskedUsd: amount(value.economics.maximumLossUsd), livePnlUsd: amount(value.status === "settled" ? value.economics.finalPnlUsd : value.economics.estimatedPnlUsd), contracts: quantity(value.contracts), entryUsd: optionalAmount(value.entrySpotPriceUsd), tx: tx(value.verification.transactionHash, value.mockTransactionFragment), settled: value.status === "settled" };
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
        spotUsd: amount(value.thesis.market?.currentSpotPriceUsd ?? null),
        spotChangeLabel: value.spotChangePct === null ? null : pctLabel(value.spotChangePct),
        maxPayoutUsd: amount(back?.economics.maximumPayoutUsd ?? null), breakEvenUsd: amount(back?.economics.breakEvenPricesUsd[0] ?? null),
        participants: value.participants.map(participant),
        comments: value.comments.map(v => ({ creator: creator(v.creator), postedLabel: `· ${elapsed(v.createdAt, value.thesis.dataAsOf)}`, body: v.body })),
        activity: value.activity.map(activity), activityCount: value.activityCount, participantCount: value.participantCount };
}
export function trending(value: Domain.TrendingItem): View.TrendingItem {
    return { slug: value.slug, asset: value.underlyingAsset, headline: value.headline, creatorHandle: value.creatorHandle, timeLabel: `${value.remainingDays}d`, pnlUsd: amount(value.estimatedPnlUsd), bullPct: value.bullPct };
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
        strikesLabel: strikesLabel(value.strikesUsd, value.isCall), premiumPerContractUsd: amount(value.premiumPerContractUsd),
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
        series: value.series.map(p => { decimal(p.priceUsd); return { time: p.time, value: Number(p.priceUsd) }; }),
        structures: value.structures.map(s => marketStructure(s, value.selectedStructureId)),
        ticket: ticket(value.ticket),
        selectedLabel: `${value.underlyingAsset} ${selected.productType} ${strikesLabel(selected.strikesUsd, selected.isCall)}`,
        selectedExpiryLabel: expiryLabel(selected.expiryAt, true) };
}
