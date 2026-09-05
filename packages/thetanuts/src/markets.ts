import { buildPriceFeedSymbolMap, getChainConfigById, getOptionImplementationInfo, type OptionImplementationInfo, type OrderWithSignature, type ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { BASE_CHAIN_ID } from "./client";

export interface CollateralInfo { readonly address: string; readonly symbol: string | null; readonly decimals: number | null }
// `Market.makerSide` is the MAKER's side, the opposite of `takerSide(order)`: raw
// `isLong: true` means the maker is the buyer and the taker sells. Measured from chain
// bytes — see the transaction evidence in `side.ts`; the SDK's own `isBuyer` is inverted.
export interface Market {
  readonly asset: string; readonly priceFeed: string; readonly strikes: readonly bigint[]; readonly expiry: bigint;
  readonly side: "call" | "put"; readonly makerSide: "seller" | "buyer"; readonly collateralToken: CollateralInfo;
  readonly implementation: { readonly address: string; readonly info: OptionImplementationInfo | null };
  readonly availableAmount: bigint; readonly pricePerContract: bigint; readonly order: OrderWithSignature;
}

function unixNow(now?: number | bigint | Date): bigint {
  if (typeof now === "bigint") return now;
  if (now instanceof Date) return BigInt(Math.floor(now.getTime() / 1_000));
  return BigInt(now ?? Math.floor(Date.now() / 1_000));
}

export async function fetchLiveOrders(client: ThetanutsClient, now?: number | bigint | Date): Promise<OrderWithSignature[]> {
  const timestamp = unixNow(now);
  return (await client.api.fetchOrders()).filter((row) => row.rawApiData && row.availableAmount > 0n && row.order.expiry > timestamp && BigInt(row.rawApiData.orderExpiryTimestamp) > timestamp);
}

export function deriveMarkets(orders: readonly OrderWithSignature[], now?: number | bigint | Date): Market[] {
  const timestamp = unixNow(now);
  const feeds = buildPriceFeedSymbolMap(BASE_CHAIN_ID);
  const tokens = Object.values(getChainConfigById(BASE_CHAIN_ID).tokens);
  return orders.flatMap((order) => {
    const raw = order.rawApiData;
    if (!raw || order.availableAmount <= 0n || order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) return [];
    const token = tokens.find((item) => item.address.toLowerCase() === raw.collateral.toLowerCase());
    return [{ asset: feeds[raw.priceFeed.toLowerCase()] ?? `UNKNOWN_FEED:${raw.priceFeed}`, priceFeed: raw.priceFeed, strikes: raw.strikes.map(BigInt), expiry: order.order.expiry, side: raw.isCall ? "call" : "put", makerSide: raw.isLong ? "buyer" : "seller", collateralToken: { address: raw.collateral, symbol: token?.symbol ?? null, decimals: token?.decimals ?? null }, implementation: { address: raw.implementation, info: getOptionImplementationInfo(BASE_CHAIN_ID, raw.implementation) }, availableAmount: order.availableAmount, pricePerContract: order.order.price, order }];
  });
}

export function listAssets(markets: readonly Market[]): string[] { return [...new Set(markets.map(({ asset }) => asset))].sort(); }
export function listExpiries(markets: readonly Market[], asset: string): bigint[] { return [...new Set(markets.filter((m) => m.asset === asset).map((m) => m.expiry.toString()))].map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0); }
export function listStructures(markets: readonly Market[], asset: string, expiry: bigint): Market[] { return markets.filter((m) => m.asset === asset && m.expiry === expiry); }
