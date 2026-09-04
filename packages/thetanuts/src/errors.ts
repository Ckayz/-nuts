export type ThetanutsLogicErrorCode =
  | "WRONG_CHAIN"
  | "INVALID_ORDER"
  | "ORDER_EXPIRED"
  | "ZERO_CONTRACTS"
  | "TAKER_SELL_UNVERIFIED"
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
