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
  | "INVALID_RISK_PARAMS"
  // RFQ (OptionFactory). Every one of these is a REFUSAL to build calldata.
  | "RFQ_FACTORY_UNAVAILABLE"
  | "RFQ_UNSUPPORTED_UNDERLYING"
  | "RFQ_STRUCTURE_UNSUPPORTED"
  | "RFQ_DUPLICATE_STRIKES"
  | "RFQ_INVALID_AMOUNT"
  | "RFQ_PRECISION_UNSUPPORTED"
  | "RFQ_INVALID_DEADLINE"
  | "RFQ_ZERO_DEPOSIT"
  | "RFQ_INVALID_PUBLIC_KEY"
  | "RFQ_INVALID_ID"
  | "RFQ_LIMIT_ORDER_UNVERIFIED"
  | "RFQ_ENCODE_MISMATCH";

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
