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

const nullableDecimal = z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable();
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const thesisDirectionSchema = z.enum(["bull", "bear"]);
const thesisStatusSchema = z.enum(["draft", "pending", "open", "expired", "settled", "cancelled"]);

export const thesisAiContextSchema: z.ZodType<ThesisAiContext> = z.object({
  thesis: z.object({
    id: z.string(),
    headline: z.string(),
    rationale: z.string().nullable(),
    direction: thesisDirectionSchema,
    status: thesisStatusSchema,
    createdAt: z.string(),
  }).strict(),
  creator: z.object({
    walletAddress: z.string(),
    displayName: z.string().nullable(),
  }).strict(),
  market: z.object({
    chainId: z.literal(8453),
    underlyingAsset: z.string(),
    currentSpotPriceUsd: nullableDecimal,
    expiryAt: z.string(),
    dataAsOf: z.string(),
  }).strict(),
  structure: z.object({
    productType: z.string(),
    isCall: z.boolean(),
    isLong: z.boolean(),
    strikesUsd: z.array(decimal),
    collateralSymbol: z.string(),
    contracts: decimal,
  }).strict(),
  economics: z.object({
    entryPremiumUsd: nullableDecimal,
    entryFeesUsd: nullableDecimal,
    maximumLossUsd: nullableDecimal,
    maximumPayoutUsd: nullableDecimal,
    breakEvenPricesUsd: z.array(decimal),
    estimatedPnlUsd: nullableDecimal,
    finalPnlUsd: nullableDecimal,
    settlementPriceUsd: nullableDecimal,
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
  return value instanceof Date ? value.toISOString() : value;
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
export function buildThesisAiContext(input: BuildThesisAiContextInput): ThesisAiContext {
  const position = input.creatorPosition;
  if (position === null) {
    throw new Error("Cannot build ThesisAiContext without creator position: structure.contracts is required by PRD §10.2");
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
  return thesisAiContextSchema.parse(context);
}
