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
  readonly chainConfig: Pick<ThetanutsClient["chainConfig"], "collateralTokens">;
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

/** Implementation collateral is separate from the SDK capacity cap.
 * Only single-strike PUT collateral and the specified RANGER inner-width formula
 * have supplied decoded-fill evidence. RANGER still requires opt-in: the supplied
 * fill was taker BUY, not a verification of the complete taker-SELL path.
 * Contract units and on-chain rounding remain UNVERIFIED outside supplied fills.
 */
export function quoteSellFill({ client, order, collateralBudget, referrer, now, allowUnverifiedStructureCollateral }: QuoteSellFillParams): SellFillQuote {
  if (takerSide(order) !== "sell") throw new ThetanutsLogicError("INVALID_SIDE", "Sell quotes require a taker-sell order");
  const raw = order.rawApiData!;
  const timestamp = BigInt(now ?? Math.floor(Date.now() / 1_000));
  if (order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  const info = getOptionImplementationInfo(8453, raw.implementation);
  const unverified = (message: string): never => { throw new ThetanutsLogicError("STRUCTURE_COLLATERAL_UNVERIFIED", message); };
  if (!info) return unverified("Unknown implementation: no supported collateral formula");
  const strikes = raw.strikes.map(BigInt);
  if (strikes.length !== info.numStrikes || strikes.some(strike => strike <= 0n)) throw new ThetanutsLogicError("INVALID_ORDER", "Implementation strike count or strike value is invalid");
  const verifiedPut = info.type === "VANILLA" && info.name === "PUT" && info.numStrikes === 1 && !raw.isCall;
  if (!verifiedPut && !allowUnverifiedStructureCollateral) return unverified("Structure collateral requires explicit unverified opt-in (including calls)");
  const sorted = [...strikes].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const scale = 100_000_000n;
  let collateralPerContract: bigint;
  if (info.type === "RANGER") {
    if (raw.implementation.toLowerCase() !== "0x9980ec85bc6fe07340adb36c76fa093bb6d4fcbc" || info.numStrikes !== 4) return unverified("RANGER collateral is supported only for the supplied decoded implementation");
    // VERIFIED formula only: 0xa2edb8… seller transfer 43,333,000.
    // SDK utils uses twice the outer wing; do not substitute its capacity cap.
    collateralPerContract = sorted[2]! - sorted[1]!;
  } else if (info.name === "INVERSE_CALL" && info.type === "VANILLA") {
    // SDK calculateCollateralRequired: one underlying per contract; bigint units.
    const decimals = Object.values(client.chainConfig.collateralTokens).find(token => token.address.toLowerCase() === raw.collateral.toLowerCase())?.decimals;
    if (decimals === undefined || decimals < 6) return unverified("Inverse call collateral token units are unsupported");
    collateralPerContract = scale * 10n ** BigInt(decimals - 6);
  } else if (info.name === "INVERSE_CALL_SPREAD") {
    return unverified("Inverse spread collateral has no exact bigint SDK helper; unsupported even with opt-in");
  } else {
    const types: Record<string, { structure: string; payout: PayoutType }> = {
      PUT: { structure: "VANILLA", payout: "put" },
      LINEAR_CALL: { structure: "VANILLA", payout: "call" },
      CALL_SPREAD: { structure: "SPREAD", payout: "call_spread" },
      PUT_SPREAD: { structure: "SPREAD", payout: "put_spread" },
      CALL_FLY: { structure: "BUTTERFLY", payout: "call_fly" },
      PUT_FLY: { structure: "BUTTERFLY", payout: "put_fly" },
      CALL_CONDOR: { structure: "CONDOR", payout: "call_condor" },
      PUT_CONDOR: { structure: "CONDOR", payout: "put_condor" },
      IRON_CONDOR: { structure: "IRON_CONDOR", payout: "iron_condor" },
    };
    const mapped = types[info.name];
    if (!mapped || mapped.structure !== info.type) return unverified("Implementation has no supported bigint collateral helper");
    // SDK utils.calculateCollateral, with equal size/collateral decimals, returns
    // per-contract price units when numContracts=1e8. PUT_FLY requires descending.
    collateralPerContract = client.utils.calculateCollateral({ type: mapped.payout, strikes: info.name === "PUT_FLY" ? [...sorted].reverse() : sorted, numContracts: scale, priceDecimals: 8, sizeDecimals: 6, collateralDecimals: 6 });
  }
  if (collateralPerContract <= 0n || order.order.price <= 0n) throw new ThetanutsLogicError("INVALID_ORDER", "Collateral divisor and price must be positive");
  const requested = collateralBudget * scale / collateralPerContract;
  const maxContracts = client.optionBook.calculateMaxContracts(order);
  const numContracts = requested < maxContracts ? requested : maxContracts;
  if (numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Collateral budget produces zero contracts");
  const collateralRequired = numContracts * collateralPerContract / scale;
  if (collateralRequired === 0n) throw new ThetanutsLogicError("ZERO_COLLATERAL", "Nonzero contracts produce zero collateral");
  const premiumGross = numContracts * order.order.price / 100_000_000n;
  if (premiumGross === 0n) throw new ThetanutsLogicError("ZERO_PREMIUM", "Nonzero contracts produce zero premium");
  const feeEstimate = premiumGross * 1250n / 10000n;
  const preview = client.optionBook.previewFillOrder(order, undefined, referrer);
  return { numContracts, maxContracts, collateralRequired, premiumGross, feeEstimate, premiumNet: premiumGross - feeEstimate, capped: requested > maxContracts, pricePerContract: order.order.price, collateralToken: raw.collateral, referrer: preview.referrer, expiry: order.order.expiry, isCall: raw.isCall, strikes };
}
