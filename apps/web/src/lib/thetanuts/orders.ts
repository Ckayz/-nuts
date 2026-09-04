import "server-only";

import { env } from "@nuts/env/server";

import {
	CHAIN_ID,
	PRICE_SCALE,
	USDC_ADDRESS,
	USDC_SCALE,
	type OrderEntry,
	type OrderSnapshot,
	type TradeableOrder,
	orderEntrySchema,
	ordersPayloadSchema,
} from "./types";

/**
 * OptionBook order access.
 *
 * This module is the only source of orders. Two SDK paths that look like they
 * would do this job do not work (PRD 11):
 *   - `client.api.filterOrders()` reads `response.orders` while the payload nests
 *     under `data.orders`, and the upstream worker ignores query parameters.
 *   - `WebSocketModule.subscribeOrders()` points at a host that does not resolve.
 * So: poll this endpoint, filter in process.
 */

/**
 * Poll interval. Makers re-sign the whole book roughly every 60s and each
 * signature is valid for 59s, so a 20s cache never serves an order that expired
 * before the caller saw it.
 */
const CACHE_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 10_000;

let cached: { snapshot: OrderSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<OrderSnapshot> | null = null;

function decimalString(value: bigint, scale: bigint): string {
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const whole = abs / scale;
	const frac = abs % scale;
	if (frac === 0n) return `${negative ? "-" : ""}${whole}`;
	const digits = scale.toString().length - 1;
	const fracStr = frac.toString().padStart(digits, "0").replace(/0+$/, "");
	return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

/** "ETH-5SEP26-2420-P" -> "ETH". Returns null when the ticker is not in that form. */
function parseAsset(ticker: string): string | null {
	const head = ticker.split("-")[0]?.trim();
	return head && /^[A-Za-z0-9]+$/.test(head) ? head.toUpperCase() : null;
}

/**
 * Structured products omit `ticker`, so their asset is resolved through the
 * Chainlink feed address. The mapping is learned from the vanillas in the same
 * snapshot rather than hardcoded, so a newly listed asset resolves on its own.
 */
function buildFeedAssetMap(entries: OrderEntry[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const e of entries) {
		if (!e.order.ticker) continue;
		const asset = parseAsset(e.order.ticker);
		if (asset) map.set(e.order.priceFeed.toLowerCase(), asset);
	}
	return map;
}

function classify(o: OrderEntry["order"]): TradeableOrder["kind"] {
	if (o.type === "binaries") return "binary";
	return o.strikes.length > 1 ? "multi_leg" : "vanilla";
}

function toTradeable(entry: OrderEntry, feedAssets: Map<string, string>): TradeableOrder {
	const o = entry.order;
	const asset = o.ticker
		? parseAsset(o.ticker)
		: (feedAssets.get(o.priceFeed.toLowerCase()) ?? null);

	return {
		entry,
		label: o.ticker ?? o.name ?? `${asset ?? "?"} ${o.isCall ? "call" : "put"}`,
		asset,
		kind: classify(o),
		productType: o.type ?? null,
		isCall: o.isCall,
		strikesUsd: o.strikes.map((s) => decimalString(BigInt(s), PRICE_SCALE)),
		expiryAt: new Date(o.expiry * 1000).toISOString(),
		orderExpiresAt: new Date(o.orderExpiryTimestamp * 1000).toISOString(),
		pricePerContractUsd: decimalString(BigInt(o.price), PRICE_SCALE),
		makerBudgetUsd: decimalString(BigInt(o.maxCollateralUsable), USDC_SCALE),
	};
}

/**
 * The v1 tradeable set: Base mainnet, USDC collateral, `isLong: false` so the
 * user takes the long side, and not already expired.
 *
 * `isLong: true` orders exist but all use non-USDC collateral and carry a fixed
 * contract count, so they are out of scope for a USDC budget (PRD 11).
 */
function isTradeable(entry: OrderEntry, nowSeconds: number): boolean {
	const o = entry.order;
	return (
		entry.chainId === CHAIN_ID &&
		o.collateral.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
		o.isLong === false &&
		o.orderExpiryTimestamp > nowSeconds &&
		o.expiry > nowSeconds &&
		BigInt(o.price) > 0n &&
		BigInt(o.maxCollateralUsable) > 0n
	);
}

async function fetchSnapshot(): Promise<OrderSnapshot> {
	const response = await fetch(env.THETANUTS_ORDERS_URL, {
		headers: { accept: "application/json" },
		cache: "no-store",
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`Order feed returned ${response.status} ${response.statusText}`);
	}

	const body = await response.json();
	const fetchedAt = new Date();
	const nowSeconds = Math.floor(fetchedAt.getTime() / 1000);

	// Validate the envelope, then each entry independently. The feed is an
	// external service whose shape has already varied once (structured products
	// omit `ticker`), so one unfamiliar row must not blank the whole book.
	const envelope = ordersPayloadSchema.parse(body);
	const entries: OrderEntry[] = [];
	let droppedEntries = 0;
	for (const raw of envelope.data.orders) {
		const parsed = orderEntrySchema.safeParse(raw);
		if (parsed.success) entries.push(parsed.data);
		else droppedEntries += 1;
	}

	const feedAssets = buildFeedAssetMap(entries);

	return {
		orders: entries
			.filter((e) => isTradeable(e, nowSeconds))
			.map((e) => toTradeable(e, feedAssets)),
		fetchedAt,
		marketData: envelope.data.market_data ?? {},
		droppedEntries,
	};
}

/**
 * Current tradeable book, cached for {@link CACHE_TTL_MS}. Concurrent callers
 * share one in-flight request rather than each hitting the feed.
 *
 * Pass `force` immediately before building calldata: a cached snapshot is fine
 * for browsing and reasoning, but never for signing (PRD 14).
 */
export async function getOrderSnapshot(force = false): Promise<OrderSnapshot> {
	if (!force && cached && cached.expiresAt > Date.now()) return cached.snapshot;
	if (!force && inFlight) return inFlight;

	const request = fetchSnapshot()
		.then((snapshot) => {
			cached = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
			return snapshot;
		})
		.finally(() => {
			if (inFlight === request) inFlight = null;
		});

	if (!force) inFlight = request;
	return request;
}

export interface OrderFilters {
	/** Underlying symbol, case-insensitive. e.g. "ETH". */
	asset?: string;
	/** true for calls, false for puts, omitted for both. */
	isCall?: boolean;
	/** Only orders expiring at or after this instant. */
	expiryAfter?: Date;
	/** Only orders expiring at or before this instant. */
	expiryBefore?: Date;
	/** Only orders whose maker budget can absorb at least this much USDC. */
	minBudgetUsd?: number;
	limit?: number;
}

/** Filter the cached book in process. There is no server-side filtering available. */
export async function searchOrders(
	filters: OrderFilters = {},
): Promise<{ orders: TradeableOrder[]; fetchedAt: Date; totalMatched: number }> {
	const snapshot = await getOrderSnapshot();
	const asset = filters.asset?.toUpperCase();

	const matched = snapshot.orders.filter((o) => {
		if (asset && o.asset !== asset) return false;
		if (filters.isCall !== undefined && o.isCall !== filters.isCall) return false;
		if (filters.expiryAfter && new Date(o.expiryAt) < filters.expiryAfter) return false;
		if (filters.expiryBefore && new Date(o.expiryAt) > filters.expiryBefore) return false;
		if (
			filters.minBudgetUsd !== undefined &&
			Number(o.makerBudgetUsd) < filters.minBudgetUsd
		) {
			return false;
		}
		return true;
	});

	return {
		orders: matched.slice(0, filters.limit ?? 25),
		fetchedAt: snapshot.fetchedAt,
		totalMatched: matched.length,
	};
}

/** Assets currently quoted, with how many orders each has. */
export async function getAvailableAssets(): Promise<
	Array<{ asset: string; orders: number; calls: number; puts: number; spotUsd: number | null }>
> {
	const snapshot = await getOrderSnapshot();
	const byAsset = new Map<string, { orders: number; calls: number; puts: number }>();

	for (const o of snapshot.orders) {
		if (!o.asset) continue;
		const row = byAsset.get(o.asset) ?? { orders: 0, calls: 0, puts: 0 };
		row.orders += 1;
		if (o.isCall) row.calls += 1;
		else row.puts += 1;
		byAsset.set(o.asset, row);
	}

	return [...byAsset.entries()]
		.map(([asset, row]) => ({
			asset,
			...row,
			spotUsd: snapshot.marketData[asset] ?? null,
		}))
		.sort((a, b) => b.orders - a.orders);
}

/**
 * Contract sizing for a USDC budget, mirroring the SDK's
 * `OptionBookModule.calculateNumContracts`: `usdcAmount * 1e8 / pricePerContract`.
 *
 * The result is fixed point, not a whole number of contracts, so small budgets do
 * not truncate to zero. Verified 2026-09-05 against the live book: a $10 budget
 * produced a non-zero fill on 212 of 212 tradeable orders.
 *
 * Two things this deliberately does NOT do:
 *   - It does not trust `previewFillOrder`'s `totalCollateral`, which reports the
 *     full budget even when the fill is capped by the maker's remaining size.
 *   - It does not claim to be the final authority. Before any real fill, the
 *     numbers here must be reconciled against `previewFillOrder` on the same
 *     order, because the contract-size scale this returns is derived from USDC's
 *     6 decimals while the SDK reports option size in 18. That reconciliation is
 *     part of step 5 and is not done yet.
 */
export function sizeFill(order: TradeableOrder, budgetUsd: number) {
	if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
		throw new Error(`Budget must be a positive number, received ${budgetUsd}`);
	}

	const price = BigInt(order.entry.order.price);
	const budget = BigInt(Math.round(budgetUsd * Number(USDC_SCALE)));
	const makerBudget = BigInt(order.entry.order.maxCollateralUsable);

	const requested = (budget * PRICE_SCALE) / price;
	const available = (makerBudget * PRICE_SCALE) / price;
	const contracts = requested > available ? available : requested;
	const costMicroUsd = (contracts * price) / PRICE_SCALE;

	return {
		/** Fixed-point contract count, scaled by 1e6. */
		contracts,
		contractsDecimal: decimalString(contracts, USDC_SCALE),
		/** Actual spend, which is below the budget when the order is too small. */
		costUsd: decimalString(costMicroUsd, USDC_SCALE),
		/** True when the maker's remaining size, not the budget, was the binding limit. */
		cappedByOrderSize: requested > available,
		/** A long option's loss is bounded by the premium paid. */
		maxLossUsd: decimalString(costMicroUsd, USDC_SCALE),
	};
}

export { decimalString };
