import type { OrderWithSignature, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { ThetanutsLogicError } from "./errors";

export interface QuoteClient { readonly optionBook: Pick<ThetanutsClient["optionBook"], "previewFillOrder"> }
export interface QuoteFillParams { readonly client: QuoteClient; readonly order: OrderWithSignature; readonly budget: bigint; readonly referrer?: string; readonly allowUnverifiedTakerSell?: boolean; readonly now?: number }
export interface FillQuote { readonly numContracts: bigint; readonly maxContracts: bigint; readonly pricePerContract: bigint; readonly premium: bigint; readonly capped: boolean; readonly collateralToken: string; readonly referrer: string; readonly expiry: bigint; readonly isCall: boolean; readonly strikes: readonly bigint[] }

// TODO-OWNER: Keep default budget and fee presentation policy at the app boundary.
// TODO-OWNER: The SDK order price is signed and exposes no slippage tolerance; define no synthetic tolerance here.

/** Capped-budget rounding is UNVERIFIED (research §3/open question 3); callers must verify the eventual debit on-chain. Taker-sell debit is UNVERIFIED (research §3/open question 2) and is gated. */
export function quoteFill({ client, order, budget, referrer, allowUnverifiedTakerSell = false, now }: QuoteFillParams): FillQuote {
  const raw = order.rawApiData;
  if (!raw) throw new ThetanutsLogicError("INVALID_ORDER", "Order is missing rawApiData");
  if (!raw.isLong && !allowUnverifiedTakerSell) throw new ThetanutsLogicError("TAKER_SELL_UNVERIFIED", "Taker-sell collateral debit is unverified");
  const timestamp = BigInt(now ?? Math.floor(Date.now() / 1_000));
  if (order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  const preview = client.optionBook.previewFillOrder(order, budget, referrer);
  if (preview.numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Premium produces zero contracts");
  const requested = budget * 100_000_000n / preview.pricePerContract;
  const premium = preview.numContracts * preview.pricePerContract / 100_000_000n;
  if (premium === 0n) throw new ThetanutsLogicError("ZERO_PREMIUM", "Nonzero contract count produces zero premium");
  return { numContracts: preview.numContracts, maxContracts: preview.maxContracts, pricePerContract: preview.pricePerContract, premium, capped: requested > preview.maxContracts, collateralToken: preview.collateralToken, referrer: preview.referrer, expiry: preview.expiry, isCall: preview.isCall, strikes: preview.strikes };
}
