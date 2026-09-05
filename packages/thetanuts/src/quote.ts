import { getOptionImplementationInfo, type PayoutType, type OrderWithSignature, type ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
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
  readonly utils: Pick<ThetanutsClient["utils"], "calculateCollateral">;
  readonly chainConfig: Pick<ThetanutsClient["chainConfig"], "tokens">;
  readonly optionBook: Pick<ThetanutsClient["optionBook"], "previewFillOrder" | "calculateMaxContracts">;
}
export interface QuoteSellFillParams {
  readonly client: SellQuoteClient;
  readonly order: OrderWithSignature;
  readonly collateralBudget: bigint;
  readonly referrer?: string;
  readonly now?: number;
  readonly allowUnverifiedStructureCollateral?: boolean;
}
export interface SellFillQuote extends Omit<FillQuote, "premium"> {
  readonly collateralRequired: bigint;
  readonly premiumGross: bigint;
  /** Premium-percentage branch only: matches all supplied decoded fills; notional branch UNVERIFIED. */
  readonly feeEstimate: bigint;
  /** Estimate, since the notional fee branch is UNVERIFIED. */
  readonly premiumNet: bigint;
}

/** Only PHYSICAL_PUT + Base aBasUSDC has supplied decoded taker-SELL evidence.
 * Other pairs require opt-in; contract units and rounding outside supplied fills
 * remain UNVERIFIED. The SDK collateral helper is separate from its capacity cap.
 */
export function quoteSellFill({ client, order, collateralBudget, referrer, now, allowUnverifiedStructureCollateral }: QuoteSellFillParams): SellFillQuote {
  if (takerSide(order) !== "sell") throw new ThetanutsLogicError("INVALID_SIDE", "Sell quotes require a taker-sell order");
  const raw = order.rawApiData!;
  const timestamp = BigInt(now ?? Math.floor(Date.now() / 1_000));
  if (order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  const info = getOptionImplementationInfo(8453, raw.implementation);
  const unverified = (message: string): never => { throw new ThetanutsLogicError("STRUCTURE_COLLATERAL_UNVERIFIED", message); };
  const pair = `${info?.name ?? raw.implementation} + ${raw.collateral}`;
  if (!info) throw new ThetanutsLogicError("STRUCTURE_UNSUPPORTED", `Unknown implementation: ${pair}`);
  const strikes = raw.strikes.map(BigInt);
  if (strikes.length !== info.numStrikes || strikes.some(strike => strike <= 0n)) throw new ThetanutsLogicError("INVALID_ORDER", "Implementation strike count or strike value is invalid");
  const verified = info.name === "PHYSICAL_PUT" && !raw.isCall &&
    raw.collateral.toLowerCase() === "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
  if (!verified && !allowUnverifiedStructureCollateral) return unverified(`Unverified sell collateral pair: ${pair}`);
  const decimals = Object.values(client.chainConfig.tokens).find(token => token.address.toLowerCase() === raw.collateral.toLowerCase())?.decimals;
  if (decimals === undefined) throw new ThetanutsLogicError("STRUCTURE_UNSUPPORTED", `Missing SDK collateral decimals: ${pair}`);
  // SDK 0.3.0 CollateralParams accepts PayoutType, not implementation names.
  // Do not map inverse/physical calls to linear calls: their collateral differs.
  const types: Readonly<Record<string, PayoutType>> = {
    PHYSICAL_PUT: "put", PUT: "put", LINEAR_CALL: "call",
    CALL_SPREAD: "call_spread", PUT_SPREAD: "put_spread",
    CALL_FLY: "call_fly", PUT_FLY: "put_fly",
    CALL_CONDOR: "call_condor", PUT_CONDOR: "put_condor",
    IRON_CONDOR: "iron_condor", RANGER: "ranger",
  };
  const type = types[info.name];
  if (!type) throw new ThetanutsLogicError("STRUCTURE_UNSUPPORTED", `No SDK bigint collateral mapping: ${pair}`);
  const collateralFor = (numContracts: bigint): bigint => {
    try {
      return client.utils.calculateCollateral({ type, strikes, numContracts, priceDecimals: 8, sizeDecimals: decimals, collateralDecimals: decimals });
    } catch (cause) {
      throw new ThetanutsLogicError("STRUCTURE_UNSUPPORTED", `SDK rejected collateral for ${pair}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  const scale = 100_000_000n;
  const collateralPerContract = collateralFor(scale);
  if (collateralPerContract <= 0n || order.order.price <= 0n) throw new ThetanutsLogicError("INVALID_ORDER", "Collateral divisor and price must be positive");
  const requested = collateralBudget * scale / collateralPerContract;
  const maxContracts = client.optionBook.calculateMaxContracts(order);
  const numContracts = requested < maxContracts ? requested : maxContracts;
  if (numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Collateral budget produces zero contracts");
  const collateralRequired = collateralFor(numContracts);
  if (collateralRequired === 0n) throw new ThetanutsLogicError("ZERO_COLLATERAL", "Nonzero contracts produce zero collateral");
  const premiumGross = numContracts * order.order.price / 100_000_000n;
  if (premiumGross === 0n) throw new ThetanutsLogicError("ZERO_PREMIUM", "Nonzero contracts produce zero premium");
  const feeEstimate = premiumGross * 1250n / 10000n;
  const preview = client.optionBook.previewFillOrder(order, undefined, referrer);
  return { numContracts, maxContracts, collateralRequired, premiumGross, feeEstimate, premiumNet: premiumGross - feeEstimate, capped: requested > maxContracts, pricePerContract: order.order.price, collateralToken: raw.collateral, referrer: preview.referrer, expiry: order.order.expiry, isCall: raw.isCall, strikes };
}
