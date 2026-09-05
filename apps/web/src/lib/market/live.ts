import "server-only";

/**
 * The live market page: assets, structures, spot and the ticket, all derived
 * from OptionBook orders. Nothing here is a hardcoded asset, strike or expiry
 * (CLAUDE.md, "Every market Thetanuts has liquidity for").
 *
 * Reads go through `getOrderSnapshot` in `lib/thetanuts/orders.ts` rather than a
 * second fetch loop: it already holds the 20-second cache, the signature-deadline
 * awareness (an order is dropped from a cached snapshot once its signature
 * deadline passes) and the per-row validation fence that stops a string
 * `isLong` from being coerced into the wrong taker side. One book, one cache,
 * one validation path.
 *
 * `readClient()` returns that module's client for the same reason: one SDK
 * client per process, built with `env.BASE_RPC_URL` and `env.THESIS_REFERRER`.
 */
import { deriveMarkets, type Market, type RiskKind } from "@nuts/thetanuts";
import type { ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { env } from "@nuts/env/server";
import { collateralUsdPrice, getOrderSnapshot, isFeedUnavailable, readClient as sharedReadClient } from "@/lib/thetanuts/orders";
import type { FeedUnavailable } from "@/lib/thetanuts/types";
import * as display from "@/lib/display";
import type { Market as MarketView, MarketStructure, MarketSummary, Ticket } from "@/lib/display-types";
import { formatBaseUnits, formatUsd8, ratioToOneDecimal } from "./units";
import { orderLabel, productLabel, riskKindFor, structureId } from "./structures";
import { quoteStructure, type QuoteResult, type StructureQuote, type TakerSide } from "./quote";
import { takerSideOf } from "./taker-side";
import { directionNameable, sideWord } from "./direction";

/** The single SDK client for this process. */
export function readClient(): ThetanutsClient {
	return sharedReadClient;
}

export const CHAIN_ID = 8453 as const;
export const OPTION_BOOK_ADDRESS = "0x1bDff855d6811728acaDC00989e79143a2bdfDed" as const;

/**
 * TODO-OWNER: the default budget the ticket opens with. `250` is the mockup's
 * own placeholder (docs/mockups/thesis-fun-mockup.html, "Your max loss"), not an
 * approved default, and neither are the presets below.
 */
export const DEFAULT_BUDGET_INPUT = "250";
/** TODO-OWNER: preset budgets, transcribed from the mockup. */
export const BUDGET_PRESETS = ["50", "100", "500", "1000"] as const;

/** One instrument on the book, with the freshest live order on each taker side. */
export interface LiveStructure {
	readonly id: string;
	readonly asset: string;
	readonly expiry: bigint;
	readonly expiryAt: string;
	readonly productType: string;
	readonly implementationName: string | null;
	readonly implementationAddress: string;
	readonly isCall: boolean;
	/**
	 * I-1. The payoff shape, `riskKindFor(implementationName, strikes.length)`,
	 * carried on the structure so every surface reads ONE classification. The
	 * ticket's Bull/Bear mapping needs it (`lib/market/direction.ts`): only a
	 * monotone payoff has a direction, and this is the app's existing test for
	 * that. Null for a RANGER, a fly, a condor, an inverse/physical call and
	 * anything the SDK does not name.
	 */
	readonly riskKind: RiskKind | null;
	readonly strikes: readonly bigint[];
	readonly strikesUsd: string[];
	readonly collateralAddress: string;
	readonly collateralSymbol: string | null;
	readonly collateralDecimals: number | null;
	readonly buy: Market | null;
	readonly sell: Market | null;
}

export interface LiveAsset {
	readonly asset: string;
	readonly slug: string;
	/** Spot from `client.api.getMarketData()`. Display only; never trading math. */
	readonly spotUsd: number | null;
	readonly structures: LiveStructure[];
}

export interface LiveBook {
	readonly assets: LiveAsset[];
	readonly fetchedAt: Date;
}

/** Strike prices are 8-decimal on the book, as `packages/thetanuts` documents. */
const STRIKE_DECIMALS = 8;

/**
 * Which of several live orders for the same structure and side is used.
 *
 * TODO-OWNER: choosing between makers is a product rule nobody has set. Until
 * one exists this picks the order whose signature has the longest remaining
 * life, then the largest remaining size — a mechanical tie-break that maximises
 * the chance the fill lands inside the signature window (PRD 14), not a ranking
 * of price.
 */
function preferOrder(left: Market, right: Market): Market {
	const leftDeadline = BigInt(left.order.rawApiData?.orderExpiryTimestamp ?? 0);
	const rightDeadline = BigInt(right.order.rawApiData?.orderExpiryTimestamp ?? 0);
	if (leftDeadline !== rightDeadline) return leftDeadline > rightDeadline ? left : right;
	return left.availableAmount >= right.availableAmount ? left : right;
}

/**
 * TODO-OWNER: how structures are ordered and which are surfaced first is
 * undecided (the mockup carries the same note). This is a deterministic sort —
 * soonest expiry, then calls after puts, then strikes ascending — so the table
 * does not reshuffle between renders; it is not a recommendation.
 */
function compareStructures(left: LiveStructure, right: LiveStructure): number {
	if (left.expiry !== right.expiry) return left.expiry < right.expiry ? -1 : 1;
	if (left.isCall !== right.isCall) return left.isCall ? 1 : -1;
	const length = Math.min(left.strikes.length, right.strikes.length);
	for (let index = 0; index < length; index++) {
		const a = left.strikes[index] ?? 0n;
		const b = right.strikes[index] ?? 0n;
		if (a !== b) return a < b ? -1 : 1;
	}
	if (left.strikes.length !== right.strikes.length) return left.strikes.length - right.strikes.length;
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function toStructure(market: Market, side: TakerSide): LiveStructure {
	const strikesUsd = market.strikes.map((strike) => formatBaseUnits(strike, STRIKE_DECIMALS));
	return {
		id: structureId(market),
		asset: market.asset,
		expiry: market.expiry,
		expiryAt: new Date(Number(market.expiry) * 1000).toISOString(),
		productType: productLabel(market.implementation.info?.name ?? null, market.implementation.address),
		implementationName: market.implementation.info?.name ?? null,
		implementationAddress: market.implementation.address,
		isCall: market.side === "call",
		riskKind: riskKindFor(market.implementation.info?.name ?? null, market.strikes.length),
		strikes: market.strikes,
		strikesUsd,
		collateralAddress: market.collateralToken.address,
		collateralSymbol: market.collateralToken.symbol,
		collateralDecimals: market.collateralToken.decimals,
		buy: side === "buy" ? market : null,
		sell: side === "sell" ? market : null,
	};
}

/** Every asset the book has live liquidity for, with its structures grouped. */
export async function getLiveMarkets(force = false): Promise<LiveBook | FeedUnavailable> {
	const snapshot = await getOrderSnapshot(force);
	if (isFeedUnavailable(snapshot)) return snapshot;
	const markets = deriveMarkets(snapshot.orders.map((order) => order.sdkOrder));

	const byAsset = new Map<string, Map<string, LiveStructure>>();
	for (const market of markets) {
		// The MEASURED rule from `./taker-side.ts`, which the shared package's
		// `makerSide` also follows since core round 9; grouping through the local
		// rule keeps the cross-check in one place.
		const side: TakerSide = takerSideOf(market.order);
		const structure = toStructure(market, side);
		const structures = byAsset.get(market.asset) ?? new Map<string, LiveStructure>();
		const existing = structures.get(structure.id);
		if (existing === undefined) {
			structures.set(structure.id, structure);
		} else {
			const current = existing[side];
			structures.set(structure.id, {
				...existing,
				[side]: current === null ? market : preferOrder(current, market),
			});
		}
		byAsset.set(market.asset, structures);
	}

	const assets: LiveAsset[] = [...byAsset.entries()]
		.map(([asset, structures]) => ({
			asset,
			slug: display.marketSlug(asset),
			spotUsd: snapshot.marketData[asset] ?? null,
			structures: [...structures.values()].sort(compareStructures),
		}))
		.sort((left, right) => (left.asset < right.asset ? -1 : left.asset > right.asset ? 1 : 0));

	return { assets, fetchedAt: snapshot.fetchedAt };
}

/** Re-reads the book and returns one structure, or null when it is gone. */
export async function findStructure(
	id: string,
	options: { force?: boolean } = {},
): Promise<{ structure: LiveStructure; asset: LiveAsset } | FeedUnavailable | null> {
	const book = await getLiveMarkets(options.force ?? false);
	if (isFeedUnavailable(book)) return book;
	for (const asset of book.assets) {
		const structure = asset.structures.find((candidate) => candidate.id === id);
		if (structure !== undefined) return { structure, asset };
	}
	return null;
}

const NO_AMOUNT = display.amount(null);

/** Historical *Usd field names are retained for the ticket contract; their display
 * strings carry token units when no USD valuation exists. Raw stays in token units. */
export function collateralAmount(value: string | null, symbol: string | null) {
	if (value === null || collateralUsdPrice(symbol) === 1) return display.amount(value);
	const label = `${display.quantity(value)} ${symbol ?? "—"}`;
	return { raw: value, usd: label, usd2: label, signed: label, signed2: label, pnlClass: "" as const };
}

/**
 * The per-contract premium, and the payout multiple, for a book row.
 *
 * `price` is 1e8-scaled per CONTRACT-SIZE UNIT, so `price / 1e8` is a token
 * amount per contract only when the contract-size unit and the collateral unit
 * have the same decimals. That is proven for 6-decimal collateral by decoded
 * production fills and unproven elsewhere, so elsewhere this returns null and
 * the table prints an em dash rather than a number in an unknown unit.
 */
function rowEconomics(structure: LiveStructure): { premiumPerContract: string | null; payoutMultiple: string | null } {
	const order = structure.buy ?? structure.sell;
	if (order === null || structure.collateralDecimals !== 6) {
		return { premiumPerContract: null, payoutMultiple: null };
	}
	const price = order.pricePerContract;
	const premiumPerContract = formatBaseUnits(price, 8);
	if (collateralUsdPrice(structure.collateralSymbol) !== 1) return { premiumPerContract, payoutMultiple: null };
	const kind = riskKindFor(structure.implementationName, structure.strikes.length);
	const sorted = [...structure.strikes].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	let cap: bigint | null = null;
	if (kind === "put") cap = sorted[0] ?? null;
	else if (kind === "put-spread" || kind === "call-spread") cap = (sorted[1] ?? 0n) - (sorted[0] ?? 0n);
	// A vanilla long call has no capped payout, so it has no multiple.
	if (cap === null || cap <= price) return { premiumPerContract, payoutMultiple: null };
	return { premiumPerContract, payoutMultiple: ratioToOneDecimal(cap - price, price) };
}

export function structureRow(structure: LiveStructure, selectedId: string): MarketStructure {
	const { premiumPerContract, payoutMultiple } = rowEconomics(structure);
	const order = structure.buy ?? structure.sell;
	const liquidity =
		order === null || structure.collateralDecimals === null
			? null
			: formatBaseUnits(order.availableAmount, structure.collateralDecimals);
	return {
		id: structure.id,
		expiryLabel: display.expiryLabel(structure.expiryAt),
		productType: `${structure.productType.charAt(0).toUpperCase()}${structure.productType.slice(1)}`,
		strikesLabel: display.strikesLabel(structure.strikesUsd, display.strikeSide(structure.productType, structure.isCall)),
		// The same strikes unformatted, so the chart can draw them as levels.
		strikesUsd: [...structure.strikesUsd],
		premiumPerContractUsd: collateralAmount(premiumPerContract, structure.collateralSymbol),
		maxPayoutLabel: payoutMultiple === null ? "—" : `${payoutMultiple}×`,
		liquidityLeftUsd: collateralAmount(liquidity, structure.collateralSymbol),
		selected: structure.id === selectedId,
	};
}

/** The mockup's ticket fields, filled from one quote. A refusal renders em dashes. */
export function ticketFrom(structure: LiveStructure, quote: QuoteResult, sideNote: string): Ticket {
	const symbol = structure.collateralSymbol ?? "—";
	const base: Ticket = {
		sideNote,
		maxLossUsd: NO_AMOUNT,
		collateralSymbol: symbol,
		presetsUsd: BUDGET_PRESETS.map((value) => collateralAmount(value, structure.collateralSymbol)),
		orderLabel: orderLabel(structure.strikesUsd, structure.implementationName, structure.isCall),
		contracts: "—",
		maxPayoutUsd: NO_AMOUNT,
		breakEvenUsd: NO_AMOUNT,
		liquidityLeftUsd: NO_AMOUNT,
	};
	if (!quote.ok) return base;
	return {
		...base,
		maxLossUsd: quote.maxLossUsd8 === null ? NO_AMOUNT : display.amount(formatUsd8(quote.maxLossUsd8)),
		contracts: display.quantity(formatBaseUnits(quote.numContracts, quote.contractSizeDecimals)) ?? "—",
		maxPayoutUsd: quote.maxPayoutUsd8 === null ? NO_AMOUNT : display.amount(formatUsd8(quote.maxPayoutUsd8)),
		breakEvenUsd: quote.breakEvenUsd8 === null ? NO_AMOUNT : display.amount(formatUsd8(quote.breakEvenUsd8)),
		liquidityLeftUsd: collateralAmount(formatBaseUnits(quote.makerLiquidity, quote.collateralDecimals), structure.collateralSymbol),
	};
}

/**
 * The sentence under the ticket's two side buttons, in the mockup's voice.
 *
 * I-1 (owner 2026-09-06, decision 1). The DIRECTION WORD is now the direction of
 * the position this taker side produces (`lib/market/direction.ts`), not the
 * ticket's old "Bull = buy" shorthand. The VERB is unchanged and still the taker
 * verb, because that is what actually happens to the money: on a put, the honest
 * sentence is "Bear buys the ETH put 2,340 P and pays premium." and its
 * counterpart is "Bull sells the ETH put 2,340 P and posts collateral."
 *
 * Measured before this fold, same instrument, same instant (userflow pass 3,
 * MAJOR-1): the ticket said "Bull buys the BTC put 79,000 P and pays premium."
 * while the resulting position's page title and Open Graph card said "Bear".
 *
 * A structure with no direction (RANGER, fly, condor, unnamed implementation)
 * keeps the same sentence with no direction word at all.
 *
 * TODO-OWNER: this copy is derived from the mockup's buy-side line ("Bull buys
 * … and pays premium. Bear sells it and posts collateral. Both are live
 * OptionBook fills sized to your budget."). The sell-side wording, the money
 * sentence below it and the two directionless openings ("Buying the …",
 * "Selling the …") are not owner-approved.
 */
export function sideNoteFor(structure: LiveStructure, side: TakerSide, quote: QuoteResult): string {
	const label = `${structure.asset} ${structure.productType} ${display.strikesLabel(structure.strikesUsd, display.strikeSide(structure.productType, structure.isCall))}`;
	const symbol = structure.collateralSymbol ?? "collateral";
	const named = directionNameable(structure);
	const word = sideWord(structure, side);
	if (side === "buy") {
		const head = named
			? `${word} buys the ${label} and pays premium. The premium is the most you can lose.`
			: `Buying the ${label} pays premium. The premium is the most you can lose.`;
		if (!quote.ok) return head;
		return `${head} You pay ${formatBaseUnits(quote.debit, quote.collateralDecimals)} ${symbol}.`;
	}
	const head = named
		? `${word} sells the ${label} and posts collateral. Your loss can reach the collateral you post.`
		: `Selling the ${label} posts collateral. Your loss can reach the collateral you post.`;
	if (!quote.ok) return head;
	return `${head} You lock ${formatBaseUnits(quote.debit, quote.collateralDecimals)} ${symbol} and receive about ${formatBaseUnits(quote.credit, quote.collateralDecimals)} ${symbol} after a fee of up to ${formatBaseUnits(quote.feeEstimate, quote.collateralDecimals)} ${symbol}.`;
}

export interface MarketPageView {
	readonly market: MarketView;
	readonly summaries: MarketSummary[];
	readonly structure: LiveStructure;
	readonly fetchedAt: Date;
	/**
	 * C12-r2 (lane C confirming pass, finding 12). True when a structure WAS
	 * asked for — `?structure=…`, or the instrument a post names — and the book
	 * no longer carries it. `structure` then holds the page's default so the
	 * table still renders, but no ticket may be built from it: PRD 8.4 forbids
	 * silently substituting another asset, expiry or direction.
	 */
	readonly requestedStructureMissing: boolean;
}

/**
 * C12-r2. The one sentence shown when the instrument someone asked for is gone.
 * TODO-OWNER: the wording, and whether the page should offer the nearest live
 * structure instead of nothing.
 */
export const STRUCTURE_UNAVAILABLE =
	"That structure is no longer on the book, so it cannot be traded. Pick another one from the list below.";

/** The market page's own summary row: the change column stays unknown, because
 *  the SDK publishes a spot price and no 24h change (measured 2026-09-05). */
function summaryOf(asset: LiveAsset): MarketSummary {
	return {
		slug: asset.slug,
		asset: asset.asset,
		// No display name source exists for an asset discovered from the book;
		// the ticker is the name rather than an invented one.
		name: asset.asset,
		spotUsd: asset.spotUsd === null ? NO_AMOUNT : display.amount(asset.spotUsd.toFixed(2)),
		changeLabel: "",
		changeClass: "",
	};
}

export interface GetMarketPageOptions {
	readonly structureId?: string;
	readonly side?: TakerSide;
	readonly budgetInput?: string;
	readonly now?: number;
}

/**
 * Assembles the market page for one asset slug.
 *
 * Returns `null` when the book has no live liquidity for that asset, so the
 * route can 404 rather than render an empty page that looks like a product
 * decision, and the feed error verbatim when the book could not be read at all.
 */
export async function getMarketPage(
	assetSlug: string,
	options: GetMarketPageOptions = {},
): Promise<MarketPageView | FeedUnavailable | null> {
	const book = await getLiveMarkets();
	if (isFeedUnavailable(book)) return book;
	const slug = assetSlug.trim().toLowerCase();
	const asset = book.assets.find((candidate) => candidate.slug === slug);
	if (asset === undefined || asset.structures.length === 0) return null;

	const requested =
		options.structureId === undefined
			? undefined
			: asset.structures.find((candidate) => candidate.id === options.structureId);
	// C12-r2. `requested ?? defaultStructure(...)` used to swallow the miss: a
	// link to a structure that had expired or been pulled opened ANOTHER
	// instrument under the same URL, and — with `?thesis=` — attached the fill to
	// the post as if it were the one the post named.
	const requestedStructureMissing = options.structureId !== undefined && requested === undefined;
	const structure = requested ?? defaultStructure(asset, options);
	const expiries = new Set(asset.structures.map((candidate) => candidate.expiryAt));

	const market: MarketView = {
		...summaryOf(asset),
		venueLabel: "Base · Thetanuts OptionBook",
		bookLabel: `${asset.structures.length} structures · ${expiries.size} expiries`,
		structureCount: asset.structures.length,
		expiryCount: expiries.size,
		structures: asset.structures.map((candidate) => structureRow(candidate, structure.id)),
		// The ticket is filled by the caller, which owns the side and budget.
		ticket: ticketFrom(structure, { ok: false, code: "NOT_QUOTED", reason: "Not quoted." }, ""),
		selectedLabel: `${asset.asset} ${structure.productType} ${display.strikesLabel(structure.strikesUsd, display.strikeSide(structure.productType, structure.isCall))}`,
		selectedExpiryLabel: display.expiryLabel(structure.expiryAt, true),
	};

	return {
		market,
		summaries: book.assets.map(summaryOf),
		structure,
		fetchedAt: book.fetchedAt,
		requestedStructureMissing,
	};
}

/**
 * Does this row offer anything to open on: liquidity left AND a payout?
 *
 * Read from the SAME derivations the table prints (`structureRow` above), so
 * the rule cannot disagree with the pixels: `liquidityLeftUsd` is the freshest
 * order's `availableAmount`, and `maxPayoutLabel` is `rowEconomics`'s payout
 * multiple, which prints "0×" when the cap is barely above the premium and "—"
 * when the multiple is unknown (unproven contract units, unvalued collateral,
 * or an uncapped long call). "Unknown" is not "positive", so those rows are not
 * chosen as the landing row — they stay one click away in the table.
 */
export function structureWorthOpening(structure: LiveStructure): boolean {
	const order = structure.buy ?? structure.sell;
	if (order === null || structure.collateralDecimals === null) return false;
	if (order.availableAmount <= 0n) return false;
	const { payoutMultiple } = rowEconomics(structure);
	if (payoutMultiple === null) return false;
	return Number(payoutMultiple) > 0;
}

/**
 * Which structure the ticket opens on, given "can this row be quoted at all".
 *
 * TODO-OWNER: the surfacing rule is undecided (best premium? nearest expiry?
 * nearest the money?). Until it is: the first row, in the deterministic table
 * order, that can be quoted AND has liquidity left AND a payout above zero.
 * The market page used to land on whatever came first that could be quoted,
 * which on a real BTC book was a row reading "Max payout 0×" — the worst thing
 * in the book presented as the default trade (screenshot pass, 2026-09-05).
 *
 * The fallbacks keep the old behaviour exactly: if no row qualifies, the first
 * QUOTABLE row (so the ticket still does not open on a refusal when a tradeable
 * row exists), and failing that the first row with its own reason shown.
 */
export function pickDefaultStructure(
	structures: readonly LiveStructure[],
	quotable: (structure: LiveStructure) => boolean,
): LiveStructure {
	const first = structures[0];
	if (first === undefined) throw new Error("No structures to choose from");
	let firstQuotable: LiveStructure | undefined;
	for (const candidate of structures) {
		if (!quotable(candidate)) continue;
		if (structureWorthOpening(candidate)) return candidate;
		firstQuotable ??= candidate;
	}
	return firstQuotable ?? first;
}

function defaultStructure(asset: LiveAsset, options: GetMarketPageOptions): LiveStructure {
	if (asset.structures[0] === undefined) throw new Error(`Asset ${asset.asset} has no structures`);
	const client = readClient();
	return pickDefaultStructure(asset.structures, (candidate) =>
		(["buy", "sell"] as const).some((side) => {
			const order = candidate[side];
			if (order === null) return false;
			const quote = quoteStructure({
				client,
				market: order,
				side,
				budget: 1n,
				referrer: env.THESIS_REFERRER,
				now: options.now,
			});
			// A budget of one base unit only asks "is this side quotable at all";
			// ZERO_CONTRACTS at that size still means the side is open.
			return quote.ok || quote.code === "ZERO_CONTRACTS";
		}),
	);
}

export type { QuoteResult, StructureQuote, TakerSide };
