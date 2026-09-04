import { z } from "zod";
import type { Position, Thesis, User } from "./schema";

export type ThesisDirection = "bull" | "bear";
export type ThesisStatus =
  | "draft"
  | "pending"
  | "open"
  | "expired"
  | "settled"
  | "cancelled";

export interface ThesisAiContext {
  thesis: {
    id: string;
    headline: string;
    rationale: string | null;
    direction: ThesisDirection;
    status: ThesisStatus;
    createdAt: string;
  };
  creator: {
    walletAddress: string;
    displayName: string | null;
  };
  market: {
    chainId: 8453;
    underlyingAsset: string;
    currentSpotPriceUsd: string | null;
    expiryAt: string;
    dataAsOf: string;
  };
  structure: {
    productType: string;
    isCall: boolean;
    isLong: boolean;
    strikesUsd: string[];
    collateralSymbol: string;
    contracts: string;
  };
  economics: {
    entryPremiumUsd: string | null;
    entryFeesUsd: string | null;
    maximumLossUsd: string | null;
    maximumPayoutUsd: string | null;
    breakEvenPricesUsd: string[];
    estimatedPnlUsd: string | null;
    finalPnlUsd: string | null;
    settlementPriceUsd: string | null;
  };
  verification: {
    transactionHash: string | null;
    optionAddress: string | null;
    confirmedOnchain: boolean;
  };
}

const signedDecimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const nonnegativeDecimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const positiveDecimal = nonnegativeDecimal.refine((value) => /[1-9]/.test(value), "must be positive");
const nullableNonnegativeDecimal = nonnegativeDecimal.nullable();
const nullableSignedDecimal = signedDecimal.nullable();
const isoTimestamp = z.string().datetime({ offset: false });
const thesisDirectionSchema = z.enum(["bull", "bear"]);
const thesisStatusSchema = z.enum(["draft", "pending", "open", "expired", "settled", "cancelled"]);

export const thesisAiContextSchema: z.ZodType<ThesisAiContext> = z.object({
  thesis: z.object({
    id: z.string(),
    headline: z.string(),
    rationale: z.string().nullable(),
    direction: thesisDirectionSchema,
    status: thesisStatusSchema,
    createdAt: isoTimestamp,
  }).strict(),
  creator: z.object({
    walletAddress: z.string(),
    displayName: z.string().nullable(),
  }).strict(),
  market: z.object({
    chainId: z.literal(8453),
    underlyingAsset: z.string(),
    currentSpotPriceUsd: nullableNonnegativeDecimal,
    expiryAt: isoTimestamp,
    dataAsOf: isoTimestamp,
  }).strict(),
  structure: z.object({
    productType: z.string(),
    isCall: z.boolean(),
    isLong: z.boolean(),
    strikesUsd: z.array(nonnegativeDecimal).min(1),
    collateralSymbol: z.string(),
    contracts: positiveDecimal,
  }).strict(),
  economics: z.object({
    entryPremiumUsd: nullableNonnegativeDecimal,
    entryFeesUsd: nullableNonnegativeDecimal,
    maximumLossUsd: nullableNonnegativeDecimal,
    maximumPayoutUsd: nullableNonnegativeDecimal,
    breakEvenPricesUsd: z.array(nonnegativeDecimal),
    estimatedPnlUsd: nullableSignedDecimal,
    finalPnlUsd: nullableSignedDecimal,
    settlementPriceUsd: nullableNonnegativeDecimal,
  }).strict(),
  verification: z.object({
    transactionHash: z.string().nullable(),
    optionAddress: z.string().nullable(),
    confirmedOnchain: z.boolean(),
  }).strict(),
}).strict();

export interface BuildThesisAiContextInput {
  thesis: Thesis;
  creator: User;
  creatorPosition: Position | null;
  dataAsOf: Date | string;
  currentSpotPriceUsd?: string | null;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ThesisAiContextError("INVALID_VALUE", "Timestamp must be a valid date");
  return date.toISOString();
}

function decimalFromBaseUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Base-unit decimals must be a non-negative integer");
  }
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!/^\d+$/.test(digits)) throw new Error("Base-unit value must be an integer string");
  if (decimals === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction.length > 0 ? `.${fraction}` : ""}`;
}

/**
 * Builds the read-only AI handoff from persisted rows. It performs representation
 * conversion only; it does not derive or estimate financial values.
 *
 * The exact PRD contract cannot represent missing contracts, so a missing creator
 * position is rejected instead of being represented by an invented value.
 */
export type ThesisAiContextErrorCode = "NO_CREATOR_POSITION" | "POSITION_MISMATCH" | "INVALID_POSITION" | "INVALID_VALUE";
export class ThesisAiContextError extends Error {
  constructor(readonly code: ThesisAiContextErrorCode, message: string) { super(message); this.name = "ThesisAiContextError"; }
}
const confirmedStatuses = new Set(["confirmed", "indexed", "expired", "settled"]);

export function buildThesisAiContext(input: BuildThesisAiContextInput): ThesisAiContext {
  const position = input.creatorPosition;
  if (position === null) {
    throw new ThesisAiContextError("NO_CREATOR_POSITION", "Cannot build ThesisAiContext without creator position: structure.contracts is required by PRD §10.2");
  }
  const mismatch = input.thesis.creatorUserId !== input.creator.id || position.thesisId !== input.thesis.id || position.userId !== input.creator.id || position.id !== input.thesis.creatorPositionId || position.walletAddress.toLowerCase() !== input.creator.walletAddress.toLowerCase();
  if (mismatch) throw new ThesisAiContextError("POSITION_MISMATCH", "Creator position does not belong to the thesis creator");
  if (position.role !== "creator" || position.chainId !== 8453 || !confirmedStatuses.has(position.status) || position.confirmedAt === null) {
    throw new ThesisAiContextError("INVALID_POSITION", "Creator position is not a confirmed Base creator position");
  }

  const context: ThesisAiContext = {
    thesis: {
      id: input.thesis.id,
      headline: input.thesis.headline,
      rationale: input.thesis.rationale,
      direction: input.thesis.direction,
      status: input.thesis.status,
      createdAt: iso(input.thesis.createdAt),
    },
    creator: {
      walletAddress: input.creator.walletAddress.toLowerCase(),
      displayName: input.creator.displayName,
    },
    market: {
      chainId: 8453,
      underlyingAsset: input.thesis.underlyingAsset,
      currentSpotPriceUsd: input.currentSpotPriceUsd ?? null,
      expiryAt: iso(input.thesis.expiryAt),
      dataAsOf: iso(input.dataAsOf),
    },
    structure: {
      productType: input.thesis.productType,
      isCall: input.thesis.isCall,
      isLong: input.thesis.isLong,
      strikesUsd: input.thesis.strikes.map((strike) => decimalFromBaseUnits(strike, input.thesis.strikeDecimals)),
      collateralSymbol: input.thesis.collateralSymbol,
      contracts: decimalFromBaseUnits(position.contracts, position.contractDecimals),
    },
    economics: {
      entryPremiumUsd: position.entryPremiumUsd,
      entryFeesUsd: position.entryFeesUsd,
      maximumLossUsd: position.maximumLossUsd,
      maximumPayoutUsd: position.maximumPayoutUsd,
      breakEvenPricesUsd: position.breakEvenPricesUsd,
      estimatedPnlUsd: position.estimatedPnlUsd,
      finalPnlUsd: position.finalPnlUsd,
      settlementPriceUsd: position.settlementPriceUsd,
    },
    verification: {
      transactionHash: position.txHash,
      optionAddress: position.optionAddress,
      confirmedOnchain: position.confirmedAt !== null,
    },
  };
  const result = thesisAiContextSchema.safeParse(context);
  if (!result.success) throw new ThesisAiContextError("INVALID_VALUE", result.error.message);
  return result.data;
}

export type ThesisAiContextAvailability = { available: true; context: ThesisAiContext } | { available: false; reason: "no_creator_position" | "not_published" | "invalid_position"; thesisId: string; status: ThesisStatus };
export function buildThesisAiContextOrUnavailable(input: BuildThesisAiContextInput): ThesisAiContextAvailability {
  const unavailable = (reason: "no_creator_position" | "not_published" | "invalid_position"): ThesisAiContextAvailability => ({ available: false, reason, thesisId: input.thesis.id, status: input.thesis.status });
  if (input.thesis.status === "draft" || input.thesis.status === "cancelled") return unavailable("not_published");
  if (input.creatorPosition === null) return unavailable("no_creator_position");
  try { return { available: true, context: buildThesisAiContext(input) }; }
  catch (error) { if (error instanceof ThesisAiContextError) return unavailable("invalid_position"); throw error; }
}
