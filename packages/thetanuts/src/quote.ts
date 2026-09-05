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
  readonly chainConfig: Pick<ThetanutsClient["chainConfig"], "tokens" | "collateralTokens">;
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
  /** Premium-percentage branch ONLY (12.5% of gross premium), and it is an UPPER BOUND, not
   * the fee. The documented fee is `min(0.06% notional, 12.5% premium)` and the notional
   * branch DOES fire on Base: sell fill
   * 0x3e7417c5c676109e737f540debe95d0aec9477c9797c19f37e626d0c611cff04 (block 50645909,
   * decoded 2026-09-05) collected 737 on a 9009 premium — 8.2%, not 12.5% (which would be
   * 1126). The notional formula itself stays UNVERIFIED: 737 is not 0.06% of strike x
   * contracts (690) either, so what "notional" means is still unmeasured. Never present
   * this number as the fee that will be charged. */
  readonly feeEstimate: bigint;
  /** LOWER BOUND on the credit, not the credit: `premiumGross - feeEstimate` with the
   * upper-bound fee above. The actual fill may credit more. */
  readonly premiumNet: bigint;
  /** Decimals of the collateral token itself, from the SDK chain config `tokens` map.
   * Feed this to `premiumUsd8From` — every premium/collateral field above is in these units. */
  readonly collateralDecimals: number;
  /** Decimals of the SDK's contract-size unit for `numContracts` (see `sellContractSizeDecimals`).
   * Feed this to the risk helpers as `contractSizeDecimals`. Separate from `collateralDecimals`
   * on purpose: they are two different quantities that happen to coincide on every
   * structure this API accepts, and the SDK breaks whenever they are made to disagree. */
  readonly contractSizeDecimals: number;
}

/** The ONE (implementation, collateral) pair on Base with a decoded taker-SELL fill:
 * tx 0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3 (block 50891956),
 * implementation 0x6aD53DD058bea004829cCf58a282C21a7Df02DcA (SDK dist/index.js:165) with
 * collateral aBasUSDC 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB — taker paid 22,000,000.
 * That order's calldata carries `isLong: true` (the maker was the BUYER), which is exactly
 * why `takerSide` calls it a sell — see the decoded evidence in `side.ts`.
 *
 * Pinned by ADDRESS, never by implementation name: FIVE Base addresses resolve to the name
 * "PHYSICAL_PUT" in the SDK's `optionImplementations` map (dist/index.js:120, 133, 135, 149, 165 —
 * 0xac5eca…, 0x9da790…, 0xc305f5…, 0x2d283d…, 0x6ad53d…) and only 0x6ad53d… has decoded evidence;
 * the other four are historical/deprecated deployments. Everything not listed here — including
 * those four — requires `allowUnverifiedStructureCollateral: true`.
 * Entries are lowercase; comparisons lowercase both sides.
 */
export const VERIFIED_SELL_PAIRS: readonly { readonly implementation: string; readonly collateral: string }[] = [
  { implementation: "0x6ad53dd058bea004829ccf58a282c21a7df02dca", collateral: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab" },
];

/** The decimals of the SDK's contract-size unit for `numContracts`, MEASURED from the SDK.
 *
 * `optionBook.calculateMaxContracts` (dist/index.js:1645) has two shapes:
 *  - single-strike CALL whose `getCollateralDecimals` view is >= 18 (dist/index.js:1660-1664):
 *    `availableAmount / 10 ** (d - 6)` — contract-size unit 10**6, regardless of the token;
 *  - every other branch, i.e. puts, single-strike calls below 18, spreads, flies, condors and
 *    rangers (dist/index.js:1656-1659, 1665-1666, 1668-1692): `availableAmount * 1e8 / strikeOrWidth` — which, since
 *    `availableAmount` is the maker's collateral in token base units (dist/index.js:3400), makes
 *    the contract-size unit 10**(collateral token decimals).
 *
 * So the two decimals arguments of `utils.calculateCollateral` are NOT interchangeable and are
 * NOT free to choose: the helper divides by `10n ** BigInt(sizeDecimals - collateralDecimals)`
 * (dist/index.js:11140). Measured on Base, with strike 2200 and the maker's own collateral as
 * `availableAmount`, `calculateCollateral(calculateMaxContracts(order))` reproduces
 * `availableAmount` exactly — and only — at `sizeDecimals === collateralDecimals === token decimals`:
 *
 *   aBasUSDC (6):  cap 10000                -> 22000000                  === availableAmount
 *   cbBTC    (8):  cap 1000000              -> 2200000000                === availableAmount
 *   WETH     (18): cap 10000000000000000    -> 22000000000000000000      === availableAmount
 *
 * The alternatives are not merely different, they are broken: `sizeDecimals: 6` with an 8- or
 * 18-decimal collateral throws `RangeError: Negative exponent is not allowed` inside the SDK,
 * and `sizeDecimals: 18` with a 6- or 8-decimal collateral returns 0.
 *
 * Hence this function returns the collateral token's decimals, and `quoteSellFill` refuses the one
 * family where the SDK's own two views disagree (single-strike calls, below).
 * UNVERIFIED beyond 6 decimals: every decoded fill supplied so far uses 6-decimal collateral, so
 * the 8- and 18-decimal rows above are SDK-internal consistency, not on-chain confirmation.
 */
export function sellContractSizeDecimals(collateralDecimals: number): number { return collateralDecimals; }

/** Only the ONE (implementation, collateral) ADDRESS pair in `VERIFIED_SELL_PAIRS` has supplied
 * decoded taker-SELL evidence; every other pair requires `allowUnverifiedStructureCollateral`.
 * Contract units and rounding outside the supplied fills remain UNVERIFIED.
 * The SDK collateral helper is separate from its capacity cap, and its two decimals arguments
 * are pinned by measurement — see `sellContractSizeDecimals`.
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
  const implementation = raw.implementation.toLowerCase();
  const collateral = raw.collateral.toLowerCase();
  const verified = !raw.isCall && VERIFIED_SELL_PAIRS.some(entry => entry.implementation === implementation && entry.collateral === collateral);
  if (!verified && !allowUnverifiedStructureCollateral) return unverified(`Unverified sell collateral pair: ${pair}`);
  const collateralDecimals = Object.values(client.chainConfig.tokens).find(token => token.address.toLowerCase() === collateral)?.decimals;
  if (collateralDecimals === undefined) throw new ThetanutsLogicError("STRUCTURE_UNSUPPORTED", `Missing SDK collateral decimals: ${pair}`);
  // Single-strike calls are the one family whose SDK capacity cap consults a SECOND, different
  // decimals source: getCollateralDecimals (dist/index.js:2510) reads the deprecated
  // `collateralTokens` map — USDC/WETH/cbBTC only on Base — and falls back to 18 for everything
  // else, including aBasUSDC, aBascbBTC, cbDOGE and cbXRP. When that view is >= 18 the cap
  // switches to a 10**6 contract-size unit (dist/index.js:1663) which `calculateCollateral`
  // cannot then be called with (negative exponent), and when the two views merely disagree the
  // cap is computed on decimals the token does not have. Measured, both cases are live:
  // aBasUSDC/cbXRP tokens.decimals=6 vs getCollateralDecimals=18 -> single-strike call cap 0.
  // Fail closed rather than emit a number from two disagreeing conventions.
  if (raw.isCall && strikes.length === 1) {
    const sdkView = Object.values(client.chainConfig.collateralTokens).find(token => token.address.toLowerCase() === collateral)?.decimals ?? 18;
    if (sdkView !== collateralDecimals || sdkView >= 18) throw new ThetanutsLogicError("STRUCTURE_UNSUPPORTED", `SDK capacity and collateral decimals disagree (${sdkView} vs ${collateralDecimals}): ${pair}`);
  }
  const contractSizeDecimals = sellContractSizeDecimals(collateralDecimals);
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
      return client.utils.calculateCollateral({ type, strikes, numContracts, priceDecimals: 8, sizeDecimals: contractSizeDecimals, collateralDecimals });
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
  return { numContracts, maxContracts, collateralRequired, premiumGross, feeEstimate, premiumNet: premiumGross - feeEstimate, collateralDecimals, contractSizeDecimals, capped: requested > maxContracts, pricePerContract: order.order.price, collateralToken: raw.collateral, referrer: preview.referrer, expiry: order.order.expiry, isCall: raw.isCall, strikes };
}
