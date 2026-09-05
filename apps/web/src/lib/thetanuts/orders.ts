import "server-only";
import { z } from "zod";
import { env } from "@nuts/env/server";
import { createReadClient, sellContractSizeDecimals, deriveMarkets, takerSide, quoteFill, quoteSellFill, ThetanutsLogicError, type Market, type SellQuoteClient } from "@nuts/thetanuts";
import type { FeedUnavailable, FeedUnusable, OrderSnapshot, SdkIncompatible, TradeableOrder } from "./types";

export const readClient = createReadClient({ rpcUrl: env.BASE_RPC_URL, referrer: env.THESIS_REFERRER });
const CACHE_TTL_MS = 20_000;
let cached: { snapshot: OrderSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<OrderSnapshot | FeedUnusable> | null = null;

export function decimalString(value: bigint, scale: bigint): string {
 const sign = value < 0n ? "-" : "";
 const abs = value < 0n ? -value : value;
 const fraction = (abs % scale).toString().padStart(scale.toString().length - 1, "0").replace(/0+$/, "");
 return `${sign}${abs / scale}${fraction ? `.${fraction}` : ""}`;
}

/** Human message for a contract-size unit this code cannot justify. One source, so the
 * adapter and the agent tools cannot drift apart. */
export const CONTRACT_UNITS_UNVERIFIED = "contract units unverified for this collateral";

/** Decimals of the SDK's contract-size unit for a taker-BUY order, ONLY where it is proven.
 *
 * `quoteFill` carries no contract-size unit, and the SDK's own capacity cap uses two
 * different conventions (`packages/thetanuts/src/quote.ts` `sellContractSizeDecimals`):
 * a single-strike call whose deprecated `getCollateralDecimals` view is >= 18 sizes in
 * 10**6, everything else sizes in 10**(collateral decimals). For 18-decimal collateral
 * those disagree by 10**12. The only contract-size unit established by a decoded
 * production fill is the USDC family's 10**6
 * (`.research/thetanuts/finding-fill-debits.md`: "numContracts is in 1e6 units for
 * USDC/aBasUSDC orders"), and both SDK branches agree there. Everything else stays
 * unproven, so no human contract count and no human per-contract price is emitted.
 */
export function buyContractSizeDecimals(collateralDecimals: number | null): number | null {
 return collateralDecimals === 6 ? 6 : null;
}

/** The contract-size unit for an order VIEW, where there is no quote to ask.
 *
 * Taker-BUY: the proven-only unit above. Taker-SELL: the unit the package's sell quote
 * would supply (`sellContractSizeDecimals`) — with two withholdings:
 *  - single-strike calls, the one family `quoteSellFill` refuses outright because the SDK's
 *    capacity view and its collateral view disagree there (packages/thetanuts/src/quote.ts).
 *    For that family the package supplies no unit, so neither does this view.
 *  - collateral that is not 6 decimals. `sellContractSizeDecimals` returns the collateral
 *    decimals and its own doc says so from SDK-internal consistency only: "UNVERIFIED beyond
 *    6 decimals: every decoded fill supplied so far uses 6-decimal collateral"
 *    (packages/thetanuts/src/quote.ts). The BUY side already withholds every unit that no
 *    decoded fill established (`buyContractSizeDecimals`); the SELL view must not publish a
 *    unit — or a per-contract price scaled by it — on weaker evidence than the BUY view does.
 */
function viewContractSizeDecimals(side: "buy" | "sell", isCall: boolean, strikeCount: number, collateralDecimals: number | null): number | null {
 if (side === "buy") return buyContractSizeDecimals(collateralDecimals);
 if (isCall && strikeCount === 1) return null;
 if (collateralDecimals !== 6) return null;
 return sellContractSizeDecimals(collateralDecimals);
}

export function toTradeable(market: Market): TradeableOrder {
 const { order, implementation, collateralToken } = market;
 const strikesUsd = market.strikes.map(s => decimalString(s, 100_000_000n));
 const expiryAt = new Date(Number(market.expiry) * 1000).toISOString();
 const side = takerSide(order);
 const contractSizeDecimals = viewContractSizeDecimals(side, market.side === "call", market.strikes.length, collateralToken.decimals);
 return {
  sdkOrder: order,
  entry: { order: { ...order.rawApiData!, expiry: Number(market.expiry) }, signature: order.signature },
  side, implementation, collateralToken,
  asset: market.asset,
  label: `${market.asset} ${strikesUsd.join("/")} ${market.side} ${expiryAt} ${implementation.info?.name ?? implementation.address}`,
  // SDK 0.3.0 metadata has no binary discriminator. Do not infer one from absent ticker.
  kind: implementation.info ? (implementation.info.type === "VANILLA" ? "vanilla" : "multi_leg") : null,
  productType: implementation.info?.name ?? null,
  isCall: market.side === "call", strikesUsd, expiryAt,
  orderExpiresAt: new Date(order.rawApiData!.orderExpiryTimestamp * 1000).toISOString(),
  contractSizeDecimals,
  // Legacy view names retained; these are token amounts, NOT USD valuations.
  // premium = numContracts * price / 1e8, so price/1e8 is a per-CONTRACT token amount
  // only when the contract-size unit equals the collateral unit. Otherwise: null.
  pricePerContractUsd: contractSizeDecimals !== null && contractSizeDecimals === collateralToken.decimals
   ? decimalString(market.pricePerContract, 100_000_000n) : null,
  makerBudgetUsd: collateralToken.decimals === null ? null : decimalString(market.availableAmount, 10n ** BigInt(collateralToken.decimals)),
 };
}

/** SDK 0.3.0 runtime methods (dist/index.js:2588,3346), private in its declarations.
 * Keep this compatibility boundary local; upgrading the SDK requires rechecking it.
 */
export const rawOrderApi = readClient.api as unknown as {
 request(path: string): Promise<{ data?: { orders?: unknown }; orders?: unknown }>;
 normalizeOdetteOrder(row: unknown): Market["order"];
};

/** Every field the adapter and the package depend on, validated BEFORE the SDK sees the
 * row. The SDK's `normalizeOdetteOrder` coerces (`isLong: Boolean(rawOrder["isLong"])`,
 * SDK dist/index.js:3387), so a string `"false"` would otherwise become `true`. `isLong` is
 * the MAKER's long flag (`packages/thetanuts/src/side.ts`, measured from decoded fills), so
 * `true` means the taker SELLS: a genuine taker-BUY order would be presented as a sell and
 * the user asked to lock collateral instead of paying a premium. Nothing here is coerced:
 * a row that does not match is dropped and counted.
 * Unnamed fields are left alone so a feed that gains fields still parses. */
const integerLike = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const rawOrderRowSchema = z.object({
 order: z.object({
  collateral: address,
  implementation: address,
  strikes: z.array(integerLike).min(1),
  isCall: z.boolean(),
  isLong: z.boolean(),
  price: integerLike,
  expiry: integerLike,
  orderExpiryTimestamp: integerLike,
  maxCollateralUsable: integerLike,
 }),
});

/** The private SDK members above are a version-specific boundary. If a future SDK renames
 * or removes one, every row would fail inside the per-row catch and the book would read as
 * empty; say the adapter is broken instead. Checked at each use, not only at module load,
 * because the client object is mutable. */
function sdkCompatibility(): SdkIncompatible | null {
 for (const method of ["request", "normalizeOdetteOrder"] as const) {
  if (typeof rawOrderApi[method] !== "function") {
   return { error: "sdk_incompatible",
    detail: `Thetanuts SDK client.api.${method} is not a function, so the OptionBook feed cannot be read. This is an adapter/SDK compatibility failure, not an empty book.` };
  }
 }
 return null;
}

export function isSdkIncompatible(value: object): value is SdkIncompatible {
 return "error" in value && (value as { error?: unknown }).error === "sdk_incompatible";
}

export function isFeedUnusable(value: object): value is FeedUnusable {
 return "error" in value && (value as { error?: unknown }).error === "feed_unusable";
}

/** True for either reason the book could not be read. Callers must return these verbatim
 * instead of describing an empty book. */
export function isFeedUnavailable(value: object): value is FeedUnavailable {
 return isSdkIncompatible(value) || isFeedUnusable(value);
}

async function fetchSnapshot(): Promise<OrderSnapshot | FeedUnusable> {
 const [response, data] = await Promise.all([rawOrderApi.request("/"), readClient.api.getMarketData()]);
 // No `?? []` fallback: a payload that carries no `orders` array is a feed whose shape this
 // adapter does not understand. Defaulting it to an empty list produces output byte-identical
 // to a genuinely empty book, which reads to the model as "there is nothing to trade".
 const rows = response.data?.orders ?? response.orders;
 if (!Array.isArray(rows)) {
  return { error: "feed_unusable", droppedEntries: 0,
   detail: "The Thetanuts order feed returned no `orders` array, so the OptionBook could not be read. This is a feed/adapter failure, not an empty book." };
 }
 const orders: TradeableOrder[] = [];
 // Rows that passed validation AND normalized. Counted separately from `orders`, because
 // `deriveMarkets` legitimately drops a well-formed row that is expired or has no maker
 // budget left (packages/thetanuts/src/markets.ts): that is an empty book, not a broken feed.
 let retainedRows = 0;
 let droppedEntries = 0;
 for (const row of rows) {
  if (!rawOrderRowSchema.safeParse(row).success) { droppedEntries++; continue; }
  try {
   const normalized = rawOrderApi.normalizeOdetteOrder(row);
   orders.push(...deriveMarkets([normalized]).map(toTradeable));
   retainedRows++;
  } catch {
   droppedEntries++;
  }
 }
 // Every row the feed sent was unreadable. The book's contents are entirely lost, so the
 // result says nothing about what is or is not on the book.
 if (droppedEntries > 0 && retainedRows === 0) {
  return { error: "feed_unusable", droppedEntries,
   detail: `The Thetanuts order feed returned ${rows.length} row(s) and every one failed validation, so the OptionBook could not be read. This is a feed/adapter failure, not an empty book.` };
 }
 return { orders, fetchedAt: new Date(),
  marketData: Object.fromEntries(Object.entries(data.prices).filter(([, price]) => Number.isFinite(price) && price > 0)),
  droppedEntries };
}

function liveSnapshot(snapshot: OrderSnapshot): OrderSnapshot {
 const now = Date.now();
 const orders = snapshot.orders.filter(order =>
  order.sdkOrder.rawApiData!.orderExpiryTimestamp * 1000 > now &&
  Number(order.sdkOrder.order.expiry) * 1000 > now);
 return orders.length === snapshot.orders.length ? snapshot : { ...snapshot, orders };
}

export async function getOrderSnapshot(force = false): Promise<OrderSnapshot | FeedUnavailable> {
	const incompatible = sdkCompatibility();
	// Before the cache and before any fetch: a broken adapter must never be cached, and
	// must never be reported through the "nothing matches" path.
	if (incompatible) return incompatible;
	if (!force && cached && cached.expiresAt > Date.now()) return liveSnapshot(cached.snapshot);
	if (!force && inFlight) {
		const pending = await inFlight;
		return isFeedUnusable(pending) ? pending : liveSnapshot(pending);
	}

	const request = fetchSnapshot()
		.then((snapshot) => {
			// An unusable feed is never cached: the next call must re-read it, exactly as a
			// broken adapter does.
			if (isFeedUnusable(snapshot)) return snapshot;
			cached = { snapshot, expiresAt: Math.min(
                snapshot.fetchedAt.getTime() + CACHE_TTL_MS,
                ...snapshot.orders.map(order => Date.parse(order.orderExpiresAt)),
                ...snapshot.orders.map(order => Date.parse(order.expiryAt)),
            ) };
			return liveSnapshot(snapshot);
		})
		.finally(() => {
			if (inFlight === request) inFlight = null;
		});

	if (!force) inFlight = request;
	return request;
}

export interface OrderFilters {
 asset?: string;
 side?: "buy" | "sell";
 isCall?: boolean;
 /** Product shape. Filtered here, with every other constraint, so `totalMatched` counts the
  * whole matching set rather than whatever survived `limit`. */
 kind?: "vanilla" | "multi_leg";
 expiryAfter?: Date;
 expiryBefore?: Date;
 limit?: number;
}
/** Every filter is applied BEFORE `limit`, so `totalMatched` is the size of the real
 * matching set and `orders` is a page of it. A caller that filters the returned page
 * afterwards would report the page's size as the book's — see the `kind` filter above. */
export async function searchOrders(filters: OrderFilters = {}) {
 const snapshot = await getOrderSnapshot();
 if (isFeedUnavailable(snapshot)) return snapshot;
 const matched = snapshot.orders.filter(o =>
  (!filters.asset || o.asset === filters.asset.toUpperCase()) &&
  (!filters.side || o.side === filters.side) &&
  (filters.isCall === undefined || o.isCall === filters.isCall) &&
  (!filters.kind || o.kind === filters.kind) &&
  (!filters.expiryAfter || new Date(o.expiryAt) >= filters.expiryAfter) &&
  (!filters.expiryBefore || new Date(o.expiryAt) <= filters.expiryBefore));
 return { orders: matched.slice(0, filters.limit ?? 25), fetchedAt: snapshot.fetchedAt, totalMatched: matched.length, droppedEntries: snapshot.droppedEntries };
}

export async function getAvailableAssets(): Promise<
	Array<{ asset: string; orders: number; calls: number; puts: number; spotUsd: number | null }> | FeedUnavailable
> {
	const snapshot = await getOrderSnapshot();
	if (isFeedUnavailable(snapshot)) return snapshot;
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


/** Budget is a decimal amount of the collateral token: premium for buy, collateral for sell.
 * Verification describes the package gate only, not on-chain execution or fee rounding.
 */
export function sizeFill(order: TradeableOrder, budgetAmount: string, client: SellQuoteClient = readClient) {
 try {
  const token = Object.values(client.chainConfig.tokens).find(t => t.address.toLowerCase() === order.sdkOrder.rawApiData?.collateral.toLowerCase());
  if (!token) throw new Error("Missing SDK collateral decimals");
  if (!/^\d+(\.\d+)?$/.test(budgetAmount)) throw new Error("Budget must be a positive decimal token amount");
  const [whole = "0", fraction = ""] = budgetAmount.split(".");
  if (fraction.length > token.decimals) throw new Error("Budget exceeds collateral token precision");
  const scale = 10n ** BigInt(token.decimals);
  const budget = BigInt(whole) * scale + BigInt(fraction.padEnd(token.decimals, "0") || "0");
  if (budget <= 0n) throw new Error("Budget must be positive");
  const side = takerSide(order.sdkOrder);
  const params = { client, order: order.sdkOrder, referrer: env.THESIS_REFERRER };
  const quote = side === "buy" ? quoteFill({ ...params, budget }) : quoteSellFill({ ...params, collateralBudget: budget });
  const premium = "premium" in quote ? quote.premium : quote.premiumGross;
  const collateral = "collateralRequired" in quote ? quote.collateralRequired : null;
  // Same 12.5%-of-premium estimate as the sell quote. It is an UPPER BOUND on the fee: the
  // notional branch fires on Base (packages/thetanuts/src/quote.ts `feeEstimate`).
  const fee = "feeEstimate" in quote ? quote.feeEstimate : premium * 1250n / 10000n;
  const collateralDecimals = "collateralDecimals" in quote ? quote.collateralDecimals : token.decimals;
  // SELL: the package's quote supplies the contract-size unit. BUY: `quoteFill` supplies
  // none, so only the unit a decoded fill established (USDC family, 10**6) is usable.
  const contractSizeDecimals = "contractSizeDecimals" in quote ? quote.contractSizeDecimals
   : buyContractSizeDecimals(token.decimals);
  const raw = { numContracts: quote.numContracts.toString(), premium: premium.toString(),
   collateralRequired: collateral?.toString() ?? null, feeEstimate: fee.toString(),
   collateralDecimals, contractSizeDecimals };
  // Without a proven unit no human contract count or per-contract price can be justified,
  // and premium/collateral would be the only honest figures. Refuse the trade instead of
  // printing a scaled number: base units stay available under `raw`.
  if (contractSizeDecimals === null) {
   return { found: true as const, executable: false as const, verification: "unverified" as const,
    reason: CONTRACT_UNITS_UNVERIFIED, raw };
  }
  const amount = (value: bigint) => ({
   amount: decimalString(value, 10n ** BigInt(collateralDecimals)),
   token: token.symbol, decimals: collateralDecimals,
  });
  // Core exposes its verification gate via success/throw, not a verification field.
  // Do not duplicate VERIFIED_SELL_PAIRS here or enable the unverified override.
  return { found: true as const, executable: true as const, verification: "verified" as const,
   side, premium: amount(premium), collateralRequired: collateral === null ? null : amount(collateral),
   feeEstimate: amount(fee), maxLoss: amount(collateral ?? premium),
   contracts: decimalString(quote.numContracts, 10n ** BigInt(contractSizeDecimals)),
   contractsUnit: "contracts" as const, contractSizeDecimals,
   raw,
   collateralToken: token, capped: quote.capped };
 } catch (error) {
  return { found: true as const, executable: false as const, verification: "unverified" as const,
   reason: error instanceof ThetanutsLogicError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Quote unavailable",
   raw: null };
 }
}

/** Human message for a collateral token this code cannot price in USD. */
export const COLLATERAL_USD_UNAVAILABLE = "Collateral USD valuation unavailable; cannot verify the 10 USD risk limit.";

/**
 * Where one unit of a COLLATERAL token's USD price comes from.
 *
 * This exists because the two symbol spaces do not intersect and never can. Spot prices
 * arrive from `client.api.getMarketData()`, whose `prices` object is built from a fixed
 * list of UNDERLYING ASSET symbols (SDK dist/index.js:2604-2617: `ETH`, `BTC`, `SOL`,
 * `XRP`, `BNB`, `AVAX`, plus whatever the upstream `market_data` object carries).
 * Collateral symbols come from `chainConfig.tokens` (SDK dist/index.js:24-64: `USDC`,
 * `WETH`, `cbBTC`, `aBasWETH`, `aBascbBTC`, `aBasUSDC`, `cbDOGE`, `cbXRP`). Measured live
 * 2026-09-05: `Object.keys(prices)` = ["ETH","BTC","SOL","XRP","BNB","AVAX"], and no
 * collateral symbol appears in it. Indexing the price map by a collateral symbol therefore
 * misses every time, which is a silent refusal rather than a valuation.
 *
 * Only tokens listed here can be priced. Everything else is refused with
 * `COLLATERAL_USD_UNAVAILABLE`; nothing is ever valued at zero by omission.
 *
 * TODO-OWNER: USD stablecoin collateral is valued at exactly 1 USD per token. That is an
 * assumption about the peg, not a measurement — neither the SDK nor the OptionBook feed
 * publishes a USDC/USD or aBasUSDC/USD price, so a depeg would understate the risk this
 * limit is meant to cap. Supply a live stablecoin price source if the owner wants depeg
 * risk inside the agent's USD ceiling.
 *
 * TODO-OWNER: wrapped and bridged majors (`WETH`, `aBasWETH`, `cbBTC`, `aBascbBTC`,
 * `cbDOGE`, `cbXRP`) are deliberately ABSENT, so an order collateralised in one is refused
 * rather than valued. Pricing them would need two things this code cannot cite:
 *  1. a token -> underlying relation. SDK token metadata carries only
 *     `{address, symbol, decimals}` (dist/index.js:24-64); `buildPriceFeedSymbolMap`
 *     (dist/index.js:290-299) maps a FEED ADDRESS to an asset symbol and mentions no token;
 *     and the SDK documents no symbol-prefix rule (no prefix-stripping code exists in the
 *     bundle). An order's own `priceFeed` names the OPTION's underlying, not its
 *     collateral's — a live ETH put is collateralised in aBasUSDC — so it cannot supply one.
 *  2. an exchange rate. Even granting the relation, one aBasWETH is not defined anywhere in
 *     the SDK as one ETH; assuming 1:1 would be inventing a rate.
 * Supply an owner-approved collateral/USD source (or an explicit wrapper rate) to enable them.
 */
export const COLLATERAL_USD_SOURCES: Readonly<Record<string, { readonly kind: "usd_peg" }>> = {
 USDC: { kind: "usd_peg" },
 aBasUSDC: { kind: "usd_peg" },
};

/** USD price of ONE unit of a collateral token, or `null` when this code cannot justify one. */
export function collateralUsdPrice(symbol: string | null): number | null {
 if (symbol === null) return null;
 // Object.hasOwn: a symbol like "constructor" must not resolve through the prototype chain.
 if (!Object.hasOwn(COLLATERAL_USD_SOURCES, symbol)) return null;
 return COLLATERAL_USD_SOURCES[symbol]?.kind === "usd_peg" ? 1 : null;
}

/** Exact decimal multiplication for a supplied token/USD quote; no peg or wrapper rate inferred. */
export function usdRisk(amount: string, tokenUsd: number | undefined, limitUsd: number) {
 const price = tokenUsd === undefined ? "" : String(tokenUsd);
 if (!/^\d+(\.\d+)?$/.test(price) || !Number.isFinite(tokenUsd) || tokenUsd! <= 0) return null;
 const parts = [amount, price].map(value => {
  const [whole = "0", fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
 });
 const units = parts[0]!.units * parts[1]!.units;
 const scale = parts[0]!.scale * parts[1]!.scale;
 return { amount: decimalString(units, scale), withinLimit: units <= BigInt(limitUsd) * scale };
}
