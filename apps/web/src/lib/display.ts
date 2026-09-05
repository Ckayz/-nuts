/** Pure domain → presentation boundary. Decimal values are never used for trading math. */
import type * as Domain from "@/types";
import type * as View from "./display-types";
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
export function creator(value: Domain.Creator): View.Creator {
    return { handle: value.handle, displayName: value.displayName ?? "—", initials: value.initials,
        walletAddress: value.walletAddress ? fragment(value.walletAddress) : value.mockWalletFragment ?? undefined,
        sinceLabel: value.sinceLabel ?? undefined, winRatePct: value.winRatePct ?? undefined, thesesCount: value.thesesCount ?? undefined,
        followers: value.followers === null ? undefined : new Intl.NumberFormat("en-US").format(value.followers),
        netPnlUsd: optionalAmount(value.netPnlUsd), verifiedPnl30dUsd: optionalAmount(value.verifiedPnl30dUsd), biggestLossUsd: optionalAmount(value.biggestLossUsd) };
}
export function thesis(value: Domain.Thesis): View.Thesis {
    // TODO-OWNER: the mockup specifies no presentation for other PRD lifecycle states.
    if (value.thesis.status !== "open" && value.thesis.status !== "settled")
        throw new Error(`No mockup presentation for ${value.thesis.status}`);
    const settled = value.thesis.status === "settled";
    const status = value.thesis.status === "open" ? value.endingSoon ? "ending" : "live" : value.thesis.status;
    const hours = Math.max(0, Math.floor((Date.parse(value.market.expiryAt) - Date.parse(value.market.dataAsOf)) / 3600000));
    const statusLabel = settled ? `SETTLED · ${value.mock.settledWinner?.toUpperCase() ?? "—"} WON` : value.thesis.status === "open" ? `${status.toUpperCase()} · ${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h` : status.toUpperCase();
    const details: string[] = [];
    if (settled && value.economics.settlementPriceUsd !== null)
        details.push(`Settled ${group(value.economics.settlementPriceUsd, 2)}`);
    else if (value.market.currentSpotPriceUsd !== null)
        details.push(`Spot ${group(value.market.currentSpotPriceUsd, value.market.currentSpotPriceUsd.includes(".") ? value.market.currentSpotPriceUsd.split(".")[1]!.length : 0)}`);
    if (value.mock.payoutPerContractUsd !== null)
        details.push(`payout ${group(value.mock.payoutPerContractUsd)} / ct`);
    else if (value.structure.contracts !== null)
        details.push(`${value.structure.contracts} ct`);
    else if (value.mock.premiumPerContractUsd !== null)
        details.push(`premium ${value.mock.premiumPerContractUsd} / ct`);
    if (value.mock.maxPayoutMultiple !== null)
        details.push(`max payout ${value.mock.maxPayoutMultiple}×`);
    else if (!settled && value.economics.breakEvenPricesUsd[0])
        details.push(`break-even ${value.economics.breakEvenPricesUsd[0]}`);
    if (!settled)
        details.push("Base · OptionBook");
    const stats = (v: Domain.SideStats): View.SideStats => ({ pct: v.pct, count: v.count, amountLabel: v.signed ? amount(v.amountUsd).signed : amount(v.amountUsd).usd });
    return { id: value.id, slug: value.slug, headline: value.thesis.headline, note: value.thesis.rationale, asset: value.market.underlyingAsset, chainId: value.market.chainId, creator: creator(value.creator), status, statusLabel,
        postedLabel: settled ? `· settled ${value.mock.settledAgoMinutes}m` : `· ${elapsed(value.thesis.createdAt, value.market.dataAsOf)}`,
        structure: { ...value.structure, expiryAt: value.market.expiryAt, expiryLabel: expiryLabel(value.market.expiryAt), strikesLabel: `${value.structure.strikesUsd.map(v => group(v)).join(" / ")} ${value.structure.isCall ? "C" : "P"}`, side: "bull", venueLabel: "Base · OptionBook" },
        detailParts: details, detailTx: tx(value.verification.transactionHash, value.mock.transactionFragment), creatorRiskedUsd: amount(value.economics.maximumLossUsd), creatorLivePnlUsd: amount(settled ? value.economics.finalPnlUsd : value.economics.estimatedPnlUsd), creatorPnlLabel: settled ? "Result" : "Live P&L", pooledUsd: amount(value.pooledUsd), bull: stats(value.bull), bear: stats(value.bear), fills: value.fills, likes: value.likes, commentCount: value.commentCount };
}
export function position(value: Domain.Position): View.Position {
    return { thesisSlug: value.thesisSlug, thesisHeadline: value.thesisHeadline, asset: value.underlyingAsset, side: value.side === "back" ? "bull" : "bear", riskedUsd: amount(value.economics.maximumLossUsd), livePnlUsd: amount(value.status === "settled" ? value.economics.finalPnlUsd : value.economics.estimatedPnlUsd), contracts: quantity(value.contracts), entryUsd: optionalAmount(value.entrySpotPriceUsd), tx: tx(value.verification.transactionHash, value.mockTransactionFragment), settled: value.status === "settled" };
}
export function participant(value: Domain.Participant): View.Participant {
    return { ...position(value), creator: creator(value.creator), says: value.says, isCreator: value.role === "creator" };
}
export function activity(value: Domain.ActivityItem): View.ActivityItem {
    return { creator: creator(value.creator), action: value.action, side: value.side === null ? undefined : value.side === "back" ? "bull" : "bear", detail: `${amount(value.amountUsd).usd} · ${value.contracts !== null ? `${value.contracts} ct` : value.soldStructure}`, tx: tx(value.transactionHash, value.mockTransactionFragment) ?? { label: "—", href: "#" } };
}
export function ticket(value: Domain.Ticket): View.Ticket {
    return { sideNote: value.sideNote, maxLossUsd: amount(value.maximumLossUsd), collateralSymbol: value.collateralSymbol, presetsUsd: value.presetsUsd.map(amount), orderLabel: value.orderLabel, contracts: quantity(value.contracts)!, maxPayoutUsd: amount(value.maximumPayoutUsd), breakEvenUsd: amount(value.breakEvenPricesUsd[0] ?? null), liquidityLeftUsd: amount(value.liquidityLeftUsd) };
}
export function detail(value: Domain.ThesisDetail): View.ThesisDetail {
    return { thesis: thesis(value.thesis), shareUrl: value.shareUrl, shareHeadline: value.shareHeadline, expiryLabel: expiryLabel(value.thesis.market.expiryAt, true), settlementLabel: value.settlementLabel, launchedLabel: `launched ${elapsed(value.thesis.thesis.createdAt, value.thesis.market.dataAsOf)} ago`, spotUsd: amount(value.thesis.market.currentSpotPriceUsd), spotChangeLabel: `${decimal(value.spotChangePct).sign > 0 ? "+" : ""}${value.spotChangePct}%`, maxPayoutUsd: amount(value.thesis.economics.maximumPayoutUsd), breakEvenUsd: amount(value.thesis.economics.breakEvenPricesUsd[0] ?? null), participants: value.participants.map(participant), comments: value.comments.map(v => ({ creator: creator(v.creator), postedLabel: `· ${elapsed(v.createdAt, value.thesis.market.dataAsOf)}`, body: v.body })), activity: value.activity.map(activity), activityCount: value.activityCount, participantCount: value.participantCount, ticket: ticket(value.ticket) };
}
export function trending(value: Domain.TrendingItem): View.TrendingItem {
    return { slug: value.slug, asset: value.underlyingAsset, headline: value.headline, creatorHandle: value.creatorHandle, timeLabel: `${value.remainingDays}d`, pnlUsd: amount(value.estimatedPnlUsd), bullPct: value.bullPct };
}
export function price(value: {
    underlyingAsset: string;
    currentSpotPriceUsd: string;
    changePct: string;
}) {
    return { asset: value.underlyingAsset, price: group(value.currentSpotPriceUsd, 2), change: `${decimal(value.changePct).sign > 0 ? "+" : ""}${value.changePct}%` };
}
