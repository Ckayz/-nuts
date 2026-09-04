import { ThetanutsLogicError } from "./errors";

export type RiskKind = "call" | "put" | "call-spread" | "put-spread";
export type PositionSide = "long" | "short";
export interface RiskParams { readonly kind: RiskKind; readonly positionSide: PositionSide; readonly strikes: readonly bigint[]; readonly numContracts: bigint; readonly pricePerContract: bigint; readonly contractSizeDecimals: number }
const PRICE_SCALE = 100_000_000n;

function checked(params: RiskParams): bigint {
  const expected = params.kind.endsWith("spread") ? 2 : 1;
  if (!Number.isInteger(params.contractSizeDecimals) || params.contractSizeDecimals < 0 || params.strikes.length !== expected || params.numContracts < 0n || params.pricePerContract < 0n) throw new ThetanutsLogicError("INVALID_RISK_PARAMS", "Invalid risk parameters");
  if (expected === 2 && (params.strikes[0] === undefined || params.strikes[1] === undefined || params.strikes[0] >= params.strikes[1])) throw new ThetanutsLogicError("INVALID_RISK_PARAMS", "Spread strikes must be ascending");
  return 10n ** BigInt(params.contractSizeDecimals);
}

function unitIntrinsic(params: RiskParams, settlementPrice: bigint): bigint {
  const low = params.strikes[0];
  if (low === undefined) throw new ThetanutsLogicError("INVALID_RISK_PARAMS", "Missing strike");
  if (params.kind === "call") return settlementPrice > low ? settlementPrice - low : 0n;
  if (params.kind === "put") return low > settlementPrice ? low - settlementPrice : 0n;
  const high = params.strikes[1];
  if (high === undefined) throw new ThetanutsLogicError("INVALID_RISK_PARAMS", "Missing spread strike");
  if (params.kind === "call-spread") return settlementPrice <= low ? 0n : settlementPrice >= high ? high - low : settlementPrice - low;
  return settlementPrice >= high ? 0n : settlementPrice <= low ? high - low : high - settlementPrice;
}

/** Returns net expiry P&L in 8-decimal price units. The contract-size decimal convention is UNVERIFIED (research §9/open question 1); callers must pass the verified value. */
export function payoffAtExpiry(params: RiskParams, settlementPrice: bigint): bigint {
  const sizeScale = checked(params);
  const gross = unitIntrinsic(params, settlementPrice) * params.numContracts / sizeScale;
  const premium = params.pricePerContract * params.numContracts / sizeScale;
  return params.positionSide === "long" ? gross - premium : premium - gross;
}

/** The contract-size decimal convention is UNVERIFIED (research §9/open question 1); callers must pass the verified value. */
export function payoffCurve(params: RiskParams, prices: readonly bigint[]): bigint[] { return prices.map((price) => payoffAtExpiry(params, price)); }

/** The contract-size decimal convention is UNVERIFIED (research §9/open question 1); callers must pass the verified value. Returns null for an uncapped short vanilla position. */
export function maxLoss(params: RiskParams): bigint | null {
  const scale = checked(params); const premium = params.pricePerContract * params.numContracts / scale;
  if (params.positionSide === "long") return premium;
  if (params.kind === "call") return null;
  const cap = params.kind === "put" ? (params.strikes[0] ?? 0n) : (params.strikes[1] ?? 0n) - (params.strikes[0] ?? 0n);
  return cap * params.numContracts / scale - premium;
}

/** The contract-size decimal convention is UNVERIFIED (research §9/open question 1); callers must pass the verified value. Returns null for an uncapped long vanilla call. */
export function maxPayout(params: RiskParams): bigint | null {
  const scale = checked(params); const premium = params.pricePerContract * params.numContracts / scale;
  if (params.positionSide === "short") return premium;
  if (params.kind === "call") return null;
  const cap = params.kind === "put" ? (params.strikes[0] ?? 0n) : (params.strikes[1] ?? 0n) - (params.strikes[0] ?? 0n);
  return cap * params.numContracts / scale - premium;
}

/** The contract-size decimal convention is UNVERIFIED (research §9/open question 1); callers must pass the verified value. */
export function breakEven(params: RiskParams): bigint {
  checked(params); const strike = params.strikes[0] ?? 0n;
  return params.kind === "put" || params.kind === "put-spread" ? (params.strikes[params.kind === "put-spread" ? 1 : 0] ?? strike) - params.pricePerContract : strike + params.pricePerContract;
}

export { PRICE_SCALE };
