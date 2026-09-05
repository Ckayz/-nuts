export type ThetanutsLogicErrorCode =
  | "INVALID_SIDE"
  | "STRUCTURE_COLLATERAL_UNVERIFIED"
  | "STRUCTURE_UNSUPPORTED"
  | "ZERO_COLLATERAL"
  | "ENCODE_MISMATCH"
  | "WRONG_CHAIN"
  | "INVALID_ORDER"
  | "ORDER_EXPIRED"
  | "ZERO_CONTRACTS"
  | "ZERO_PREMIUM"
  | "TAKER_SELL_UNVERIFIED"
  | "ORDER_FILLED_NOT_FOUND"
  | "INVALID_RISK_PARAMS";

export class ThetanutsLogicError extends Error {
  readonly code: ThetanutsLogicErrorCode;
  readonly details?: Readonly<Record<string, string | number | bigint | boolean>>;

  constructor(code: ThetanutsLogicErrorCode, message: string, details?: Readonly<Record<string, string | number | bigint | boolean>>) {
    super(message);
    this.name = "ThetanutsLogicError";
    this.code = code;
    this.details = details;
  }
}
