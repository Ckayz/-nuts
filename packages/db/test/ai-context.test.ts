import { describe, expect, test } from "bun:test";
import { buildThesisAiContext, thesisAiContextSchema, type ThesisAiContext } from "../src/ai-context";
import { thesisAiContextExamples } from "../src/fixtures/thesis-ai-context.example";
import type { Position, Thesis, User } from "../src/schema";

function baseUnits(value: string, decimals: number): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const result = `${integer}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return `${negative ? "-" : ""}${result}`;
}

function rowsFromExample(example: ThesisAiContext): { thesis: Thesis; creator: User; position: Position } {
  const now = new Date(example.thesis.createdAt);
  const creatorPositionId = "20000000-0000-4000-8000-000000000002";
  const thesis: Thesis = {
    id: example.thesis.id,
    creatorUserId: "10000000-0000-4000-8000-000000000001",
    headline: example.thesis.headline,
    rationale: example.thesis.rationale,
    direction: example.thesis.direction,
    status: example.thesis.status,
    underlyingAsset: example.market.underlyingAsset,
    expiryAt: new Date(example.market.expiryAt),
    productType: example.structure.productType,
    isCall: example.structure.isCall,
    isLong: example.structure.isLong,
    strikes: example.structure.strikesUsd.map((value) => baseUnits(value, 8)),
    strikeDecimals: 8,
    collateralAddress: "0x0000000000000000000000000000000000000001",
    collateralSymbol: example.structure.collateralSymbol,
    collateralDecimals: 6,
    creatorOrderSnapshot: {},
    creatorPositionId,
    createdAt: now,
    publishedAt: now,
    expiredAt: example.thesis.status === "expired" ? new Date(example.market.expiryAt) : null,
    settledAt: example.thesis.status === "settled" ? new Date(example.market.dataAsOf) : null,
  };
  const creator: User = {
    id: thesis.creatorUserId,
    walletAddress: example.creator.walletAddress.toUpperCase(),
    displayName: example.creator.displayName,
    bio: null,
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  };
  const position: Position = {
    id: creatorPositionId,
    thesisId: thesis.id,
    userId: creator.id,
    role: "creator",
    side: "back",
    status: example.thesis.status === "settled" ? "settled" : example.thesis.status === "expired" ? "expired" : "confirmed",
    chainId: 8453,
    walletAddress: example.creator.walletAddress,
    orderId: "example-order",
    orderHash: null,
    orderSnapshot: {},
    txHash: example.verification.transactionHash ?? "",
    optionAddress: example.verification.optionAddress,
    referrer: null,
    budget: "0",
    budgetDecimals: 6,
    contracts: baseUnits(example.structure.contracts, 8),
    contractDecimals: 8,
    premium: "0",
    premiumDecimals: 6,
    fees: "0",
    feeDecimals: 6,
    collateral: "0",
    collateralDecimals: 6,
    maximumLoss: null,
    maximumLossDecimals: null,
    maximumPayout: null,
    maximumPayoutDecimals: null,
    breakEvenPrices: [],
    breakEvenPriceDecimals: 8,
    estimatedPnl: null,
    estimatedPnlDecimals: null,
    settlementPrice: null,
    settlementPriceDecimals: null,
    payout: null,
    payoutDecimals: null,
    finalPnl: null,
    finalPnlDecimals: null,
    entryPremiumUsd: example.economics.entryPremiumUsd,
    entryFeesUsd: example.economics.entryFeesUsd,
    maximumLossUsd: example.economics.maximumLossUsd,
    maximumPayoutUsd: example.economics.maximumPayoutUsd,
    breakEvenPricesUsd: example.economics.breakEvenPricesUsd,
    estimatedPnlUsd: example.economics.estimatedPnlUsd,
    finalPnlUsd: example.economics.finalPnlUsd,
    settlementPriceUsd: example.economics.settlementPriceUsd,
    createdAt: now,
    confirmedAt: example.verification.confirmedOnchain ? now : null,
    indexedAt: null,
    settledAt: example.thesis.status === "settled" ? new Date(example.market.dataAsOf) : null,
  };
  return { thesis, creator, position };
}

describe("ThesisAiContext", () => {
  test.each(Array.from(thesisAiContextExamples))("builder produces a valid fixture", (example) => {
    const rows = rowsFromExample(example);
    const built = buildThesisAiContext({
      thesis: rows.thesis,
      creator: rows.creator,
      creatorPosition: rows.position,
      dataAsOf: example.market.dataAsOf,
      currentSpotPriceUsd: example.market.currentSpotPriceUsd,
    });
    expect(thesisAiContextSchema.safeParse(built).success).toBe(true);
    expect(built).toEqual(example);
  });

  test("missing economics stay null", () => {
    const example = thesisAiContextExamples[3];
    const rows = rowsFromExample(example);
    const built = buildThesisAiContext({ thesis: rows.thesis, creator: rows.creator, creatorPosition: rows.position, dataAsOf: example.market.dataAsOf });
    expect(built.economics.entryPremiumUsd).toBeNull();
    expect(built.economics.maximumLossUsd).toBeNull();
    expect(built.economics.finalPnlUsd).toBeNull();
    expect(built.market.currentSpotPriceUsd).toBeNull();
  });

  test("wallet addresses are normalized to lowercase", () => {
    const example = thesisAiContextExamples[0];
    const rows = rowsFromExample(example);
    const built = buildThesisAiContext({ thesis: rows.thesis, creator: rows.creator, creatorPosition: rows.position, dataAsOf: example.market.dataAsOf });
    expect(built.creator.walletAddress).toBe(example.creator.walletAddress);
  });

  test("a missing creator position is rejected instead of estimated", () => {
    const example = thesisAiContextExamples[0];
    const rows = rowsFromExample(example);
    expect(() => buildThesisAiContext({ thesis: rows.thesis, creator: rows.creator, creatorPosition: null, dataAsOf: example.market.dataAsOf })).toThrow("structure.contracts is required");
  });
});
