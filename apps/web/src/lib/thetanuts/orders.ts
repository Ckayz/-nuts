import "server-only";
import { z } from "zod";
import { env } from "@nuts/env/server";
import { createReadClient, sellContractSizeDecimals, deriveMarkets, takerSide, quoteFill, quoteSellFill, ThetanutsLogicError, type Market, type SellQuoteClient } from "@nuts/thetanuts";
import type { OrderSnapshot, SdkIncompatible, TradeableOrder } from "./types";

export const readClient = createReadClient({ rpcUrl: env.BASE_RPC_URL, referrer: env.THESIS_REFERRER });
const CACHE_TTL_MS = 20_000;
let cached: { snapshot: OrderSnapshot; expiresAt: number } | null = null;
let inFlight: Promise<OrderSnapshot> | null = null;

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
 * would supply (`sellContractSizeDecimals`) — except single-strike calls, the one family
 * `quoteSellFill` refuses outright because the SDK's capacity view and its collateral view
 * disagree there (packages/thetanuts/src/quote.ts). For that family the package supplies
 * no unit, so neither does this view.
 */
function viewContractSizeDecimals(side: "buy" | "sell", isCall: boolean, strikeCount: number, collateralDecimals: number | null): number | null {
 if (side === "buy") return buyContractSizeDecimals(collateralDecimals);
 if (isCall && strikeCount === 1) return null;
 return collateralDecimals === null ? null : sellContractSizeDecimals(collateralDecimals);
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
 * SDK dist/index.js:3387), so a string `"false"` would otherwise become `true` and a
 * taker-SELL order would be previewed as an executable BUY. Nothing here is coerced:
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

async function fetchSnapshot(): Promise<OrderSnapshot> {
 const [response, data] = await Promise.all([rawOrderApi.request("/"), readClient.api.getMarketData()]);
 const rows = response.data?.orders ?? response.orders ?? [];
 if (!Array.isArray(rows)) throw new Error("Order feed orders must be an array");
 const orders: TradeableOrder[] = [];
 let droppedEntries = 0;
 for (const row of rows) {
  if (!rawOrderRowSchema.safeParse(row).success) { droppedEntries++; continue; }
  try {
   const normalized = rawOrderApi.normalizeOdetteOrder(row);
   orders.push(...deriveMarkets([normalized]).map(toTradeable));
  } catch {
   droppedEntries++;
  }
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

export async function getOrderSnapshot(force = false): Promise<OrderSnapshot | SdkIncompatible> {
	const incompatible = sdkCompatibility();
	// Before the cache and before any fetch: a broken adapter must never be cached, and
	// must never be reported through the "nothing matches" path.
	if (incompatible) return incompatible;
	if (!force && cached && cached.expiresAt > Date.now()) return liveSnapshot(cached.snapshot);
	if (!force && inFlight) return liveSnapshot(await inFlight);

	const request = fetchSnapshot()
		.then((snapshot) => {
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
 expiryAfter?: Date;
 expiryBefore?: Date;
 limit?: number;
}
export async function searchOrders(filters: OrderFilters = {}) {
 const snapshot = await getOrderSnapshot();
 if (isSdkIncompatible(snapshot)) return snapshot;
 const matched = snapshot.orders.filter(o =>
  (!filters.asset || o.asset === filters.asset.toUpperCase()) &&
  (!filters.side || o.side === filters.side) &&
  (filters.isCall === undefined || o.isCall === filters.isCall) &&
  (!filters.expiryAfter || new Date(o.expiryAt) >= filters.expiryAfter) &&
  (!filters.expiryBefore || new Date(o.expiryAt) <= filters.expiryBefore));
 return { orders: matched.slice(0, filters.limit ?? 25), fetchedAt: snapshot.fetchedAt, totalMatched: matched.length, droppedEntries: snapshot.droppedEntries };
}

export async function getAvailableAssets(): Promise<
	Array<{ asset: string; orders: number; calls: number; puts: number; spotUsd: number | null }> | SdkIncompatible
> {
	const snapshot = await getOrderSnapshot();
	if (isSdkIncompatible(snapshot)) return snapshot;
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
  // Same observed premium-percentage estimate as sell quote; notional branch UNVERIFIED.
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
