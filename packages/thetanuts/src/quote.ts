import type { OrderWithSignature, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { ThetanutsLogicError } from "./errors";
import { takerSide } from "./side";

export interface QuoteClient { readonly optionBook: Pick<ThetanutsClient["optionBook"], "previewFillOrder"> }
export interface QuoteFillParams { readonly client: QuoteClient; readonly order: OrderWithSignature; readonly budget: bigint; readonly referrer?: string; /** @deprecated Ignored: premium-funded buy APIs never allow taker sells. */ readonly allowUnverifiedTakerSell?: boolean; readonly now?: number }
export interface FillQuote { readonly numContracts: bigint; readonly maxContracts: bigint; readonly pricePerContract: bigint; readonly premium: bigint; readonly capped: boolean; readonly collateralToken: string; readonly referrer: string; readonly expiry: bigint; readonly isCall: boolean; readonly strikes: readonly bigint[] }

// TODO-OWNER: Keep default budget and fee presentation policy at the app boundary.
// TODO-OWNER: The SDK order price is signed and exposes no slippage tolerance; define no synthetic tolerance here.

/** Capped-budget rounding is UNVERIFIED (research §3/open question 3); callers must verify the eventual debit on-chain. This premium-funded API rejects taker sells unconditionally. */
export function quoteFill({ client, order, budget, referrer, now }: QuoteFillParams): FillQuote {
  const raw = order.rawApiData;
  if (!raw) throw new ThetanutsLogicError("INVALID_ORDER", "Order is missing rawApiData");
  if (takerSide(order) === "sell") throw new ThetanutsLogicError("TAKER_SELL_UNVERIFIED", "Use the collateral-funded sell API for taker sells");
  const timestamp = BigInt(now ?? Math.floor(Date.now() / 1_000));
  if (order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  const preview = client.optionBook.previewFillOrder(order, budget, referrer);
  if (preview.numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Premium produces zero contracts");
  const requested = budget * 100_000_000n / preview.pricePerContract;
  const premium = preview.numContracts * preview.pricePerContract / 100_000_000n;
  if (premium === 0n) throw new ThetanutsLogicError("ZERO_PREMIUM", "Nonzero contract count produces zero premium");
  return { numContracts: preview.numContracts, maxContracts: preview.maxContracts, pricePerContract: preview.pricePerContract, premium, capped: requested > preview.maxContracts, collateralToken: preview.collateralToken, referrer: preview.referrer, expiry: preview.expiry, isCall: preview.isCall, strikes: preview.strikes };
}

export interface SellQuoteClient {
  readonly chainConfig: Pick<ThetanutsClient["chainConfig"], "collateralTokens">;
  readonly optionBook: Pick<ThetanutsClient["optionBook"], "previewFillOrder" | "calculateMaxContracts">;
}
export interface QuoteSellFillParams {
  readonly client: SellQuoteClient;
  readonly order: OrderWithSignature;
  readonly collateralBudget: bigint;
  readonly referrer?: string;
  readonly now?: number;
  readonly allowUnverifiedCallCollateral?: boolean;
}
export interface SellFillQuote extends Omit<FillQuote, "premium"> {
  readonly collateralRequired: bigint;
  readonly premiumGross: bigint;
  /** Premium-percentage branch only: matches all supplied decoded fills; notional branch UNVERIFIED. */
  readonly feeEstimate: bigint;
  /** Estimate, since the notional fee branch is UNVERIFIED. */
  readonly premiumNet: bigint;
}

/** Mirrors SDK 0.3.0 calculateMaxContracts sizing, not implementation-specific collateral math.
 * Call collateral, non-six-decimal contract units and on-chain rounding are UNVERIFIED.
 */
export function quoteSellFill({ client, order, collateralBudget, referrer, now, allowUnverifiedCallCollateral }: QuoteSellFillParams): SellFillQuote {
  if (takerSide(order) !== "sell") throw new ThetanutsLogicError("INVALID_SIDE", "Sell quotes require a taker-sell order");
  const raw = order.rawApiData!;
  const timestamp = BigInt(now ?? Math.floor(Date.now() / 1_000));
  if (order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  if (raw.isCall && !allowUnverifiedCallCollateral) throw new ThetanutsLogicError("CALL_COLLATERAL_UNVERIFIED", "Call collateral requires explicit unverified opt-in");
  const strikes = raw.strikes.map(BigInt);
  // Exactly the SDK's getCollateralDecimals lookup, including its unknown-token fallback.
  const decimals = Object.values(client.chainConfig.collateralTokens).find(token => token.address.toLowerCase() === raw.collateral.toLowerCase())?.decimals ?? 18;
  const inverse = raw.isCall && strikes.length === 1 && decimals >= 18;
  let numerator = strikes[0] ?? order.order.price;
  const denominator = inverse ? 1n : 100_000_000n;
  if (inverse) numerator = 10n ** BigInt(decimals - 6);
  else if (strikes.length >= 2) {
    const sorted = [...strikes].sort((a, b) => a < b ? -1 : 1);
    numerator = sorted[sorted.length - 1]! - sorted[0]!;
  }
  if (numerator <= 0n || order.order.price <= 0n) throw new ThetanutsLogicError("INVALID_ORDER", "Collateral divisor and price must be positive");
  const requested = collateralBudget * denominator / numerator;
  const maxContracts = client.optionBook.calculateMaxContracts(order);
  const numContracts = requested < maxContracts ? requested : maxContracts;
  if (numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Collateral budget produces zero contracts");
  const collateralRequired = numContracts * numerator / denominator;
  if (collateralRequired === 0n) throw new ThetanutsLogicError("ZERO_COLLATERAL", "Nonzero contracts produce zero collateral");
  const premiumGross = numContracts * order.order.price / 100_000_000n;
  if (premiumGross === 0n) throw new ThetanutsLogicError("ZERO_PREMIUM", "Nonzero contracts produce zero premium");
  const feeEstimate = premiumGross * 1250n / 10000n;
  const preview = client.optionBook.previewFillOrder(order, undefined, referrer);
  return { numContracts, maxContracts, collateralRequired, premiumGross, feeEstimate, premiumNet: premiumGross - feeEstimate, capped: requested > maxContracts, pricePerContract: order.order.price, collateralToken: raw.collateral, referrer: preview.referrer, expiry: order.order.expiry, isCall: raw.isCall, strikes };
}
