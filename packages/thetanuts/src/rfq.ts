/**
 * RFQ calldata for the Thetanuts **OptionFactory** — create, cancel, settle —
 * and the quotation id a mined create produced.
 *
 * Scope, owner-decided 2026-09-06: BUY (`isRequestingLongPosition: true`) PUTs
 * and PUT SPREADS, USDC collateral, ETH or BTC. Everything else is refused here
 * rather than in the caller, so an unmodelled product can never reach a wallet.
 *
 * Same shape as `fill.ts`: pure functions that return `{to, data, value: 0n}`
 * for wagmi/viem to send. Nothing in this file signs, sends, or reads the chain.
 *
 * ── WHAT WAS MEASURED (SDK 0.3.0 `dist/index.js`, 2026-09-06; the brief this
 * was written from said something different for the first two) ────────────────
 *
 * 1. THE ESCROW IS `RFQRequest.reservePrice`, **NOT** `params.requesterDeposit`.
 *    `buildRFQParams` hardcodes `requesterDeposit: BigInt(0)` (index.js:5921) and
 *    `validateRFQRequest` THROWS on any other value (index.js:6838-6840). The
 *    amount a BUY escrows travels in the top-level `reservePrice` argument, and
 *    it is the TOTAL, already multiplied by the contract count:
 *    `calculateReservePrice` (index.js:4702-4712) computes
 *    `round(perContract × 10^d) × numContracts / 10^d`. The docs agree
 *    ("total escrow = 0.015 × 10 = 0.15 USDC", llms-full.txt:3440; "reservePrice
 *    is `contracts x premium per contract`", :3626). Measured end to end:
 *    perContract 0.5, contracts 1.5 → encoded `reservePrice` 750000 (0.75 USDC),
 *    `requesterDeposit` 0.
 *    So `expected.depositBaseUnits` below is the DECODED top-level reservePrice,
 *    and `expected.reservePriceBaseUnits` is the per-contract figure the user
 *    named. `expected.requesterDepositField` is the tuple's own zero, kept so a
 *    caller can see it is zero rather than assume it.
 *
 * 2. A PUT SPREAD IS ENCODED **DESCENDING**. `buildRFQParams` sorts ascending
 *    only for calls and 4-strike condors (`useAscending = isCall || isCondor`,
 *    index.js:5887-5890); a 2-strike PUT is sorted `b - a`. Measured: strikes
 *    `[2000, 2300]` and `[2300, 2000]` both encode as
 *    `[230000000000n, 200000000000n]`. `expected.strikesUsd8` is therefore
 *    exactly what the calldata carries, in the factory's own order — NOT sorted
 *    ascending by this module. Sort a display copy if a UI wants ascending.
 *
 * 3. CONTRACT SIZE IS THE COLLATERAL TOKEN'S DECIMALS: USDC → 6, so one
 *    contract is `1_000_000n` (`toNumContractsOnChain`, index.js:4655-4691).
 *    A decimal STRING is NOT scaled by the SDK — it is parsed as a raw BigInt
 *    and `"1.5"` throws — so this module parses the user's decimal string
 *    itself and hands the SDK a `bigint`, which the SDK passes through
 *    untouched. No float ever touches the contract count.
 *
 * 4. FLOATS: the SDK takes `strikes` and `reservePrice` as `number`. Every value
 *    is parsed to base units exactly (string arithmetic) BEFORE the call and the
 *    encoded calldata is decoded back and compared to that exact arithmetic; a
 *    disagreement throws `RFQ_ENCODE_MISMATCH` instead of shipping a rounded
 *    number. Inputs carrying more decimals than the unit can hold (strike > 8,
 *    reserve > 6) are refused up front.
 *
 * 5. `convertToLimitOrder` is hardcoded `false` by `buildRFQParams`
 *    (index.js:5926) although the r12 factory ABI still carries the field
 *    (`requestForQuotation` tuple, measured). `true` is refused here: nothing
 *    has proven what the factory does with it.
 *
 * TODO-OWNER: `referralId` (0 = none), the offer deadline, and every product
 * number stay the caller's. This module invents none of them.
 */
import { OPTION_FACTORY_ABI, type ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { SigningKey } from "ethers";
import { decodeFunctionData, encodeEventTopics, parseAbi, type Abi, type Address, type Hex } from "viem";
import { ThetanutsLogicError } from "./errors";
import type { Tx } from "./fill";

/** The RFQ underlyings the factory prices (`chainConfig.priceFeeds` + the SDK's own union). */
export type RfqUnderlying = "ETH" | "BTC";

/** USDC on Base carries 6 decimals; asserted against `chainConfig.tokens.USDC` at build time. */
const COLLATERAL_SYMBOL = "USDC" as const;
const STRIKE_DECIMALS = 8;

/**
 * How far ahead an expiry may be asked for.
 *
 * TODO-OWNER: 400 days is not a chain limit; it is the cap the agent's own
 * search tool already uses (`apps/web/src/lib/agent/tools.ts:131`, `.max(400)`),
 * borrowed so the two surfaces agree. Nothing in the PRD words an RFQ horizon.
 */
const MAX_EXPIRY_DAYS = 400;

/**
 * A plausibility ceiling on the contract count.
 *
 * TODO-OWNER: nothing on chain caps it and the escrow is bounded separately by
 * the caller; this exists so a typo or a model's stray zeroes are refused by
 * name instead of encoded.
 */
const MAX_CONTRACTS = 1_000_000;

/**
 * An expiry this far past "now in seconds" was almost certainly given in
 * MILLISECONDS — 1e3 is the real ratio, so 1e2 refuses the mistake without
 * catching any plausible date.
 */
const MILLISECONDS_SUSPICION = 100;

/** The subset of the SDK client this module uses. A real `ThetanutsClient` satisfies it. */
export interface RfqClient {
  readonly chainConfig: ThetanutsClient["chainConfig"];
  readonly optionFactory: Pick<
    ThetanutsClient["optionFactory"],
    "buildRFQRequest" | "encodeRequestForQuotation" | "encodeCancelQuotation" | "encodeSettleQuotation"
  >;
  readonly erc20: Pick<ThetanutsClient["erc20"], "encodeApprove">;
}

export interface RfqCreateParams {
  readonly requester: `0x${string}`;
  readonly underlying: RfqUnderlying;
  /**
   * 1 strike = vanilla PUT, 2 strikes = PUT spread. Decimal USD strings, at most
   * 8 decimal places. Any order in; the ORDER OUT is the factory's own, which is
   * DESCENDING for a put spread (measured, see the file header).
   */
  readonly strikesUsd: readonly string[];
  /** Unix SECONDS. Must be strictly after `offerEndTimestamp`. */
  readonly expiry: number;
  /** Decimal contract count as the user says it ("1.5"), at most 6 decimal places (USDC). */
  readonly numContracts: string;
  /** Decimal USDC per contract, the buyer's maximum, at most 6 decimal places. */
  readonly reservePricePerContract: string;
  /** Whole minutes from now until offers close. TODO-OWNER: the default is the caller's. */
  readonly offerDeadlineMinutes: number;
  /** The requester's compressed ECDH public key (33 bytes, `0x02`/`0x03` prefix). */
  readonly requesterPublicKey: string;
  /** Thetanuts referral id. Default `0n` = none. TODO-OWNER. */
  readonly referralId?: bigint;
  /**
   * MEASURED: the SDK builder hardcodes `false`, the r12 factory ABI still
   * carries the field, and nothing proves the on-chain behaviour of `true`.
   * `true` is refused (`RFQ_LIMIT_ORDER_UNVERIFIED`).
   */
  readonly convertToLimitOrder?: boolean;
  /** Milliseconds, for tests and for pinning the offer-deadline band. Defaults to `Date.now()`. */
  readonly now?: number;
}

export interface RfqCreateBuild {
  /** undefined when `allowance >= expected.depositBaseUnits`. EXACT approval, spender = the FACTORY. */
  readonly approve: Tx | undefined;
  readonly create: Tx;
  readonly factory: Address;
  /** Every field below is DECODED BACK from `create.data`. Nothing here is a recomputation. */
  readonly expected: {
    /** Total USDC escrowed at creation = the calldata's top-level `reservePrice`. Base units. */
    readonly depositBaseUnits: bigint;
    readonly collateral: { address: Address; symbol: typeof COLLATERAL_SYMBOL; decimals: 6 };
    /** 8-decimal, in the factory's own order (put spread: DESCENDING). */
    readonly strikesUsd8: readonly bigint[];
    /** Base units of the collateral token: USDC 6 decimals, so 1 contract = 1_000_000n. */
    readonly numContracts: bigint;
    readonly expiryTimestamp: bigint;
    readonly offerEndTimestamp: bigint;
    readonly implementation: Address;
    /** Per contract, USDC base units — what the user named, not the escrow. */
    readonly reservePriceBaseUnits: bigint;
    /** The tuple's own `requesterDeposit`. ALWAYS 0n; the SDK refuses anything else. */
    readonly requesterDepositField: bigint;
    readonly referralId: bigint;
    readonly convertToLimitOrder: boolean;
    readonly requesterPublicKey: string;
  };
}

const factoryAbi = OPTION_FACTORY_ABI as unknown as Abi;
const approveAbi = parseAbi(["function approve(address spender, uint256 amount)"]);
const tx = (encoded: { readonly to: string; readonly data: string }): Tx => ({ to: encoded.to as Address, data: encoded.data as Hex, value: 0n });
const sameAddress = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

const DECIMAL_STRING = /^\d+(\.\d+)?$/;

/**
 * Exact decimal string → base units. No `Number`, so no float ever appears.
 * More decimals than the unit can hold is a REFUSAL, never a silent round.
 */
export function decimalToBaseUnits(value: string, decimals: number, field: string): bigint {
  const text = value.trim();
  if (!DECIMAL_STRING.test(text)) {
    throw new ThetanutsLogicError("RFQ_INVALID_AMOUNT", `${field} must be a plain non-negative decimal string`, { field, value: text });
  }
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new ThetanutsLogicError("RFQ_PRECISION_UNSUPPORTED", `${field} carries ${fraction.length} decimals; this unit holds ${decimals}`, { field, value: text, decimals });
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function assertPositive(amount: bigint, field: string): void {
  if (amount <= 0n) throw new ThetanutsLogicError("RFQ_INVALID_AMOUNT", `${field} must be greater than zero`, { field, value: amount });
}

function usdcConfig(client: RfqClient): { address: Address; decimals: 6 } {
  const token = client.chainConfig.tokens[COLLATERAL_SYMBOL];
  if (!token) throw new ThetanutsLogicError("RFQ_FACTORY_UNAVAILABLE", "USDC is not configured on this chain");
  if (token.decimals !== 6) {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `USDC decimals changed to ${token.decimals}; every unit in this module assumes 6`, { decimals: token.decimals });
  }
  return { address: token.address as Address, decimals: 6 };
}

/** `chainConfig.contracts.optionFactory` is `string | null`; a null one is a refusal, never a guess. */
function factoryAddress(client: RfqClient): Address {
  const address = client.chainConfig.contracts.optionFactory;
  if (!address || /^0x0{40}$/i.test(address)) {
    throw new ThetanutsLogicError("RFQ_FACTORY_UNAVAILABLE", "No OptionFactory is configured on this chain");
  }
  return address as Address;
}

interface DecodedCreate {
  readonly requester: string;
  readonly collateral: string;
  readonly implementation: string;
  readonly strikes: readonly bigint[];
  readonly numContracts: bigint;
  readonly requesterDeposit: bigint;
  readonly collateralAmount: bigint;
  readonly expiryTimestamp: bigint;
  readonly offerEndTimestamp: bigint;
  readonly isRequestingLongPosition: boolean;
  readonly convertToLimitOrder: boolean;
  readonly referralId: bigint;
  readonly reservePrice: bigint;
  readonly requesterPublicKey: string;
}

/** Reads `requestForQuotation` calldata back with the factory ABI. Throws rather than guessing. */
function decodeCreate(data: Hex): DecodedCreate {
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: factoryAbi, data });
  } catch {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", "The RFQ calldata does not decode against the factory ABI");
  }
  if (decoded.functionName !== "requestForQuotation") {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `The RFQ calldata calls ${decoded.functionName}, not requestForQuotation`);
  }
  const [params, tracking, reservePrice, publicKey] = (decoded.args ?? []) as [
    Record<string, unknown> | undefined,
    Record<string, unknown> | undefined,
    unknown,
    unknown,
  ];
  if (!params || !tracking || typeof reservePrice !== "bigint" || typeof publicKey !== "string") {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", "The RFQ calldata decoded into an unexpected argument shape");
  }
  const strikes = params.strikes;
  if (!Array.isArray(strikes) || strikes.some((strike) => typeof strike !== "bigint")) {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", "The RFQ calldata carries no decodable strike array");
  }
  const field = (name: string): unknown => params[name];
  const big = (name: string): bigint => {
    const value = field(name);
    if (typeof value !== "bigint") throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `The RFQ calldata field ${name} is not a uint256`);
    return value;
  };
  const text = (name: string): string => {
    const value = field(name);
    if (typeof value !== "string") throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `The RFQ calldata field ${name} is not an address`);
    return value;
  };
  const flag = (name: string): boolean => {
    const value = field(name);
    if (typeof value !== "boolean") throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `The RFQ calldata field ${name} is not a bool`);
    return value;
  };
  const referralId = tracking.referralId;
  if (typeof referralId !== "bigint") throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", "The RFQ calldata carries no referral id");
  return {
    requester: text("requester"),
    collateral: text("collateral"),
    implementation: text("implementation"),
    strikes: strikes as readonly bigint[],
    numContracts: big("numContracts"),
    requesterDeposit: big("requesterDeposit"),
    collateralAmount: big("collateralAmount"),
    expiryTimestamp: big("expiryTimestamp"),
    offerEndTimestamp: big("offerEndTimestamp"),
    isRequestingLongPosition: flag("isRequestingLongPosition"),
    convertToLimitOrder: flag("convertToLimitOrder"),
    referralId,
    reservePrice,
    requesterPublicKey: publicKey,
  };
}

function mismatch(what: string, expected: bigint | string | boolean, encoded: bigint | string | boolean): never {
  throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `${what}: expected ${String(expected)}, the calldata carries ${String(encoded)}`, {
    expected: typeof expected === "boolean" ? String(expected) : expected,
    encoded: typeof encoded === "boolean" ? String(encoded) : encoded,
  });
}

/**
 * Builds the exact approval (to the FACTORY) and the `requestForQuotation`
 * calldata for a BUY put or put spread in USDC.
 *
 * `allowance` is the caller's current USDC allowance to the factory, read on
 * chain by the caller (this module never touches the network). `approve` is
 * omitted only when that allowance already covers the escrow exactly or more.
 *
 * Everything in `expected` is decoded back out of the calldata that will be
 * sent, and every decoded value is compared against exact string arithmetic
 * before the result is returned. A disagreement throws.
 */
export function buildRfqCreate({ client, params, allowance }: { client: RfqClient; params: RfqCreateParams; allowance: bigint }): RfqCreateBuild {
  if (params.underlying !== "ETH" && params.underlying !== "BTC") {
    throw new ThetanutsLogicError("RFQ_UNSUPPORTED_UNDERLYING", `RFQ is built for ETH and BTC only, not ${String(params.underlying)}`);
  }
  if (params.convertToLimitOrder === true) {
    throw new ThetanutsLogicError("RFQ_LIMIT_ORDER_UNVERIFIED", "convertToLimitOrder: true is not verified on chain; the SDK builder always encodes false");
  }
  if (!/^0x0[23][0-9a-fA-F]{64}$/.test(params.requesterPublicKey)) {
    throw new ThetanutsLogicError("RFQ_INVALID_PUBLIC_KEY", "requesterPublicKey must be a 33-byte compressed ECDH public key");
  }
  // The SHAPE is not the key. The SDK's own gate is shape-only too
  // (`isValidPublicKey`, dist/index.js:11975-11991), so an x-coordinate that is
  // not a point on secp256k1 encodes happily and produces an RFQ nobody can
  // encrypt an offer to. Decompressing it is the check, and ethers throws
  // "Point is not on curve" / "Cannot find square root" when it is not one
  // (measured, A-3).
  try {
    SigningKey.computePublicKey(params.requesterPublicKey, false);
  } catch {
    throw new ThetanutsLogicError(
      "RFQ_INVALID_PUBLIC_KEY",
      "requesterPublicKey is not a point on secp256k1, so no market maker could encrypt an offer to it",
    );
  }

  const strikeCount = params.strikesUsd.length;
  if (strikeCount !== 1 && strikeCount !== 2) {
    throw new ThetanutsLogicError("RFQ_STRUCTURE_UNSUPPORTED", `Only a vanilla put (1 strike) or a put spread (2 strikes) is supported, not ${strikeCount}`, { strikes: strikeCount });
  }
  const strikesUsd8 = params.strikesUsd.map((strike, index) => {
    const units = decimalToBaseUnits(strike, STRIKE_DECIMALS, `strike ${index + 1}`);
    assertPositive(units, `strike ${index + 1}`);
    return units;
  });
  if (strikeCount === 2 && strikesUsd8[0] === strikesUsd8[1]) {
    throw new ThetanutsLogicError("RFQ_DUPLICATE_STRIKES", "A put spread needs two different strikes", { strike: strikesUsd8[0] ?? 0n });
  }

  const collateral = usdcConfig(client);
  const contracts = decimalToBaseUnits(params.numContracts, collateral.decimals, "numContracts");
  assertPositive(contracts, "numContracts");
  const maxContracts = BigInt(MAX_CONTRACTS) * 10n ** BigInt(collateral.decimals);
  if (contracts > maxContracts) {
    throw new ThetanutsLogicError(
      "RFQ_INVALID_AMOUNT",
      `numContracts is ${params.numContracts}; this build asks for at most ${MAX_CONTRACTS} contracts`,
      { field: "numContracts", value: contracts },
    );
  }
  const reservePerContract = decimalToBaseUnits(params.reservePricePerContract, collateral.decimals, "reservePricePerContract");
  assertPositive(reservePerContract, "reservePricePerContract");
  // The SDK's own arithmetic (calculateReservePrice, index.js:4702-4712) in exact integers.
  const deposit = (reservePerContract * contracts) / 10n ** BigInt(collateral.decimals);
  if (deposit <= 0n) {
    throw new ThetanutsLogicError("RFQ_ZERO_DEPOSIT", "reservePricePerContract × numContracts rounds to zero USDC, so the RFQ would escrow nothing", {
      reservePerContract,
      contracts,
    });
  }

  if (!Number.isInteger(params.offerDeadlineMinutes) || params.offerDeadlineMinutes <= 0) {
    throw new ThetanutsLogicError("RFQ_INVALID_DEADLINE", "offerDeadlineMinutes must be a positive whole number of minutes", { minutes: params.offerDeadlineMinutes });
  }
  // `isSafeInteger`, not `isInteger`: past 2^53 the value is no longer the number
  // that was written, and past ~2.8e14 seconds it stops being a date at all —
  // `new Date(x * 1000).toISOString()` throws `RangeError` in the caller (A-4).
  if (!Number.isSafeInteger(params.expiry) || params.expiry <= 0) {
    throw new ThetanutsLogicError("RFQ_INVALID_DEADLINE", "expiry must be a positive whole number of unix seconds", { expiry: params.expiry });
  }
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1_000);
  const offerEndEstimate = nowSeconds + params.offerDeadlineMinutes * 60;
  if (params.expiry <= offerEndEstimate) {
    throw new ThetanutsLogicError("RFQ_INVALID_DEADLINE", "The option expiry must be after the offer deadline", { expiry: params.expiry, offerEnd: offerEndEstimate });
  }
  // BOUNDED FROM ABOVE TOO. Without this an expiry given in MILLISECONDS — a
  // realistic mistake, the agent tool's own description says "an ISO instant or
  // unix seconds" — was accepted silently and encoded, and the user was shown an
  // option expiring in the year 58651 instead of being told the unit was wrong.
  if (params.expiry > nowSeconds * MILLISECONDS_SUSPICION) {
    throw new ThetanutsLogicError(
      "RFQ_INVALID_DEADLINE",
      "expiry is far beyond any plausible date; it looks like milliseconds, and this field is unix SECONDS",
      { expiry: params.expiry },
    );
  }
  const latestExpiry = nowSeconds + MAX_EXPIRY_DAYS * 86_400;
  if (params.expiry > latestExpiry) {
    throw new ThetanutsLogicError(
      "RFQ_INVALID_DEADLINE",
      `The option expiry is further than ${MAX_EXPIRY_DAYS} days away, which this build does not request`,
      { expiry: params.expiry, latest: latestExpiry },
    );
  }

  const factory = factoryAddress(client);
  const request = client.optionFactory.buildRFQRequest({
    requester: params.requester,
    underlying: params.underlying,
    optionType: "PUT",
    // Human-readable numbers are what this SDK entry point takes; every one of
    // them is verified against the exact integers above once encoded.
    strikes: params.strikesUsd.map(Number),
    expiry: params.expiry,
    // A bigint passes through toNumContractsOnChain untouched: no float, no rounding.
    numContracts: contracts,
    isLong: true,
    offerDeadlineMinutes: params.offerDeadlineMinutes,
    collateralToken: COLLATERAL_SYMBOL,
    reservePrice: Number(params.reservePricePerContract),
    referralId: params.referralId ?? 0n,
    requesterPublicKey: params.requesterPublicKey,
  });
  const create = tx(client.optionFactory.encodeRequestForQuotation(request));
  if (!sameAddress(create.to, factory)) mismatch("The RFQ create calls the wrong contract", factory, create.to);

  const decoded = decodeCreate(create.data);
  if (!sameAddress(decoded.requester, params.requester)) mismatch("Requester", params.requester, decoded.requester);
  if (!sameAddress(decoded.collateral, collateral.address)) mismatch("Collateral token", collateral.address, decoded.collateral);
  if (!decoded.isRequestingLongPosition) mismatch("isRequestingLongPosition", true, decoded.isRequestingLongPosition);
  if (decoded.convertToLimitOrder) mismatch("convertToLimitOrder", false, decoded.convertToLimitOrder);
  if (decoded.collateralAmount !== 0n) mismatch("collateralAmount", 0n, decoded.collateralAmount);
  if (decoded.requesterDeposit !== 0n) mismatch("requesterDeposit", 0n, decoded.requesterDeposit);
  if (decoded.numContracts !== contracts) mismatch("Contract count", contracts, decoded.numContracts);
  if (decoded.reservePrice !== deposit) mismatch("Escrowed reserve price", deposit, decoded.reservePrice);
  if (decoded.referralId !== (params.referralId ?? 0n)) mismatch("Referral id", params.referralId ?? 0n, decoded.referralId);
  if (decoded.requesterPublicKey !== params.requesterPublicKey) mismatch("Requester public key", params.requesterPublicKey, decoded.requesterPublicKey);
  if (decoded.expiryTimestamp !== BigInt(params.expiry)) mismatch("Expiry", BigInt(params.expiry), decoded.expiryTimestamp);
  if (decoded.strikes.length !== strikeCount) mismatch("Strike count", BigInt(strikeCount), BigInt(decoded.strikes.length));
  // The factory's order, not ours: compare as a set, then keep what it encoded.
  const wanted = [...strikesUsd8].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const encodedSorted = [...decoded.strikes].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  wanted.forEach((strike, index) => {
    if (encodedSorted[index] !== strike) mismatch(`Strike ${index + 1}`, strike, encodedSorted[index] ?? 0n);
  });
  // buildRFQParams reads its own Date.now(), so the offer end is checked as a
  // band around the caller's clock rather than an equality.
  const offerEnd = Number(decoded.offerEndTimestamp);
  if (Math.abs(offerEnd - offerEndEstimate) > 5) {
    mismatch("Offer deadline", BigInt(offerEndEstimate), decoded.offerEndTimestamp);
  }
  if (decoded.expiryTimestamp <= decoded.offerEndTimestamp) {
    throw new ThetanutsLogicError("RFQ_INVALID_DEADLINE", "The encoded expiry is not after the encoded offer deadline", {
      expiry: decoded.expiryTimestamp,
      offerEnd: decoded.offerEndTimestamp,
    });
  }
  const expectedImplementation = client.chainConfig.implementations[strikeCount === 1 ? "PUT" : "PUT_SPREAD"];
  if (!expectedImplementation || !sameAddress(decoded.implementation, expectedImplementation)) {
    mismatch("Implementation", expectedImplementation ?? "none configured", decoded.implementation);
  }

  let approve: Tx | undefined;
  if (allowance < deposit) {
    approve = tx(client.erc20.encodeApprove(collateral.address, factory, deposit));
    // The allowance is read out of the bytes that will be sent, never trusted
    // from the arguments that produced them (PRD 10.2: allowances are EXACT).
    let approval: { functionName: string; args?: readonly unknown[] };
    try {
      approval = decodeFunctionData({ abi: approveAbi, data: approve.data });
    } catch {
      throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", "The approval calldata is not a plain ERC-20 approve");
    }
    const [spender, amount] = (approval.args ?? []) as [unknown, unknown];
    if (approval.functionName !== "approve" || typeof spender !== "string" || typeof amount !== "bigint") {
      throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", "The approval calldata is not a plain ERC-20 approve");
    }
    if (!sameAddress(approve.to, collateral.address)) mismatch("Approval target token", collateral.address, approve.to);
    if (!sameAddress(spender, factory)) mismatch("Approval spender", factory, spender);
    if (amount !== deposit) mismatch("Approval amount", deposit, amount);
  }

  return {
    approve,
    create,
    factory,
    expected: {
      depositBaseUnits: decoded.reservePrice,
      collateral: { address: collateral.address, symbol: COLLATERAL_SYMBOL, decimals: 6 },
      strikesUsd8: decoded.strikes,
      numContracts: decoded.numContracts,
      expiryTimestamp: decoded.expiryTimestamp,
      offerEndTimestamp: decoded.offerEndTimestamp,
      implementation: decoded.implementation as Address,
      reservePriceBaseUnits: reservePerContract,
      requesterDepositField: decoded.requesterDeposit,
      referralId: decoded.referralId,
      convertToLimitOrder: decoded.convertToLimitOrder,
      requesterPublicKey: decoded.requesterPublicKey,
    },
  };
}

function buildIdCall(client: RfqClient, quotationId: bigint, kind: "cancelQuotation" | "settleQuotation"): Tx {
  if (quotationId < 0n) throw new ThetanutsLogicError("RFQ_INVALID_ID", "A quotation id cannot be negative", { quotationId });
  const factory = factoryAddress(client);
  const encoded = kind === "cancelQuotation"
    ? client.optionFactory.encodeCancelQuotation(quotationId)
    : client.optionFactory.encodeSettleQuotation(quotationId);
  const call = tx(encoded);
  if (!sameAddress(call.to, factory)) mismatch(`The ${kind} call targets the wrong contract`, factory, call.to);
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: factoryAbi, data: call.data });
  } catch {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `The ${kind} calldata does not decode against the factory ABI`);
  }
  const [id] = (decoded.args ?? []) as [unknown];
  if (decoded.functionName !== kind || typeof id !== "bigint") {
    throw new ThetanutsLogicError("RFQ_ENCODE_MISMATCH", `The ${kind} calldata decoded as ${decoded.functionName}`);
  }
  if (id !== quotationId) mismatch(`The ${kind} quotation id`, quotationId, id);
  return call;
}

/** Requester-only, before settlement. Refunds the escrowed deposit (docs, RFQ Lifecycle). */
export function buildRfqCancel(client: RfqClient, quotationId: bigint): Tx {
  return buildIdCall(client, quotationId, "cancelQuotation");
}

/**
 * Permissionless once the reveal window has passed (docs, RFQ Lifecycle). This
 * module does not check the clock — readiness is a chain read the caller owns.
 */
export function buildRfqSettle(client: RfqClient, quotationId: bigint): Tx {
  return buildIdCall(client, quotationId, "settleQuotation");
}

/** `QuotationRequested(uint256 indexed quotationId, address indexed requester, uint256 reservePrice, string requesterPublicKey)`, taken from the ABI — never a literal topic. */
const quotationRequestedEvent = (() => {
  const events = (OPTION_FACTORY_ABI as readonly { type?: string; name?: string }[]).filter(
    (entry) => entry.type === "event" && entry.name === "QuotationRequested",
  );
  if (events.length !== 1) {
    throw new Error(`OPTION_FACTORY_ABI carries ${events.length} QuotationRequested events; expected exactly 1`);
  }
  return events[0] as Abi[number];
})();

/** topic0 of `QuotationRequested`, derived from the ABI entry above. */
export const QUOTATION_REQUESTED_TOPIC: Hex = encodeEventTopics({ abi: [quotationRequestedEvent] })[0] as Hex;

/**
 * The quotation id a mined create receipt produced, or null.
 *
 * Only a log emitted BY the factory counts: a log with the right topic from
 * another address is not this factory's event and is ignored.
 */
export function decodeQuotationRequested(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  factory: string,
): { quotationId: bigint } | null {
  for (const log of logs) {
    if (!sameAddress(log.address, factory)) continue;
    if (log.topics[0]?.toLowerCase() !== QUOTATION_REQUESTED_TOPIC.toLowerCase()) continue;
    const idTopic = log.topics[1];
    if (typeof idTopic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(idTopic)) continue;
    return { quotationId: BigInt(idTopic) };
  }
  return null;
}
