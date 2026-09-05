import { describe, expect, test } from "bun:test";
import { buildThesisAiContext, buildThesisAiContextOrUnavailable, ThesisAiContextError, thesisAiContextSchema, type ThesisAiContext } from "../src/ai-context";
import { thesisAiContextExamples } from "../src/fixtures/thesis-ai-context.example";
import { textOnlyThesis, taggedUnbackedThesis } from "../src/fixtures/thesis-post.example";
import type { Position, Thesis, User } from "../src/schema";
import { canonicalFillEvent } from "./fixtures/fill-event";

function baseUnits(value: string, decimals: number): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const result = `${integer}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return `${negative ? "-" : ""}${result}`;
}
const orderSnapshot = { version: 1 as const, order: { maker: "0x1", taker: "0x0", option: "", isBuyer: false, numContracts: "0", price: "1", expiry: "1", nonce: "1" }, signature: "0x12", availableAmount: "1", makerAddress: "0x1" };

function rowsFromExample(example: ThesisAiContext): { thesis: Thesis; creator: User; position: Position } {
  const now = new Date(example.thesis.createdAt);
  const creatorPositionId = "20000000-0000-4000-8000-000000000002";
  const thesis: Thesis = {
    id: example.thesis.id,
    slug: example.thesis.id,
    creatorUserId: "10000000-0000-4000-8000-000000000001",
    headline: example.thesis.headline,
    rationale: example.thesis.rationale,
    direction: example.thesis.direction,
    status: example.thesis.status,
    taggedAsset: example.market.underlyingAsset,
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
    creatorOrderSnapshot: orderSnapshot,
    creatorPositionId,
    createdAt: now,
    publishedAt: now,
    expiredAt: example.thesis.status === "expired" ? new Date(example.market.expiryAt) : null,
    settledAt: example.thesis.status === "settled" ? new Date(example.market.dataAsOf) : null,
  };
  const creator: User = {
    id: thesis.creatorUserId,
    handle: null,
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
    ticketHash: null,
    failureReason: null,
    orderSnapshot,
    fillEvent: canonicalFillEvent,
    indexerPositionId: null,
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
  for (const thesis of [textOnlyThesis, taggedUnbackedThesis]) {
    for (const status of ["open", "draft", "cancelled", "pending"] as const) test(
      `post ${thesis.id} ${status} has no structure before other availability checks`, () => {
        const rows = rowsFromExample(thesisAiContextExamples[0]);
        const input = { thesis: { ...thesis, status }, creator: rows.creator, creatorPosition: null, dataAsOf: new Date() };
        expect(buildThesisAiContextOrUnavailable(input)).toEqual({ available: false, reason: "no_structure", thesisId: thesis.id, status });
        let caught: unknown;
        try { buildThesisAiContext(input); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(ThesisAiContextError);
        expect(caught).toMatchObject({ code: "NO_STRUCTURE" });
      });
  }
  test("structured open post without backing retains no_creator_position", () => {
    const rows = rowsFromExample(thesisAiContextExamples[0]);
    const input = { thesis: { ...rows.thesis, creatorPositionId: null }, creator: rows.creator, creatorPosition: null, dataAsOf: new Date() };
    expect(buildThesisAiContextOrUnavailable(input)).toMatchObject({ available: false, reason: "no_creator_position" });
    let caught: unknown;
    try { buildThesisAiContext(input); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "NO_CREATOR_POSITION" });
  });

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

  test("availability distinguishes draft, pending without a position, and open", () => {
    const rows = rowsFromExample(thesisAiContextExamples[0]);
    expect(buildThesisAiContextOrUnavailable({ ...rows, creatorPosition: null, thesis: { ...rows.thesis, status: "draft" }, dataAsOf: new Date() })).toMatchObject({ available: false, reason: "not_published" });
    expect(buildThesisAiContextOrUnavailable({ ...rows, creatorPosition: null, thesis: { ...rows.thesis, status: "pending" }, dataAsOf: new Date() })).toMatchObject({ available: false, reason: "no_creator_position" });
    expect(buildThesisAiContextOrUnavailable({ thesis: rows.thesis, creator: rows.creator, creatorPosition: rows.position, dataAsOf: thesisAiContextExamples[0].market.dataAsOf })).toMatchObject({ available: true });
  });

  test("linked draft after a wallet change is unavailable and strict mapping rejects the mismatch", () => {
    const rows = rowsFromExample(thesisAiContextExamples[0]);
    rows.thesis.status = "draft";
    rows.creator.walletAddress = "0xaaa";
    const input = { thesis: rows.thesis, creator: rows.creator, creatorPosition: rows.position, dataAsOf: new Date() };
    expect(buildThesisAiContextOrUnavailable(input)).toMatchObject({ available: false, reason: "not_published" });
    let caught: unknown;
    try { buildThesisAiContext(input); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ThesisAiContextError);
    expect(caught).toMatchObject({ code: "POSITION_MISMATCH" });
  });

  const guards: [string, (rows: ReturnType<typeof rowsFromExample>) => void, string][] = [
    ["thesisId", (rows) => { rows.position.thesisId = "other"; }, "POSITION_MISMATCH"],
    ["userId", (rows) => { rows.position.userId = "other"; }, "POSITION_MISMATCH"],
    ["creatorPositionId", (rows) => { rows.position.id = "other"; }, "POSITION_MISMATCH"],
    ["wallet", (rows) => { rows.creator.walletAddress = rows.creator.walletAddress.toLowerCase(); rows.position.walletAddress = "0xdef"; }, "POSITION_MISMATCH"],
    ["creatorUserId", (rows) => { rows.thesis.creatorUserId = "other"; }, "POSITION_MISMATCH"],
    ["role", (rows) => { rows.position.role = "participant"; }, "INVALID_POSITION"],
    ["chainId", (rows) => { rows.position.chainId = 1; }, "INVALID_POSITION"],
    ["status", (rows) => { rows.position.status = "failed"; }, "INVALID_POSITION"],
    ["confirmedAt", (rows) => { rows.position.confirmedAt = null; }, "INVALID_POSITION"],
  ];
  for (const [name, mutate, code] of guards) {
    test(`guard ${name} rejects with ${code}`, () => {
      const rows = rowsFromExample(thesisAiContextExamples[0]);
      mutate(rows);
      let caught: unknown;
      try { buildThesisAiContext({ thesis: rows.thesis, creator: rows.creator, creatorPosition: rows.position, dataAsOf: thesisAiContextExamples[0].market.dataAsOf }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ThesisAiContextError);
      expect(caught).toMatchObject({ code });
    });
  }

  test("positive contracts retain subnormal decimal exactness", () => {
    const example = thesisAiContextExamples[0];
    const contracts = "0." + "0".repeat(400) + "1";
    expect(thesisAiContextSchema.parse({ ...example, structure: { ...example.structure, contracts } }).structure.contracts).toBe(contracts);
  });

  test("fixtures are lifecycle coherent and transaction hashes are unique", () => {
    const hashes = thesisAiContextExamples.map((value) => value.verification.transactionHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const value of thesisAiContextExamples) {
      expect(value.verification.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(value.verification.confirmedOnchain).toBe(true);
      if (value.thesis.status === "expired" || value.thesis.status === "settled") {
        expect(Date.parse(value.thesis.createdAt)).toBeLessThan(Date.parse(value.market.expiryAt));
        expect(Date.parse(value.market.expiryAt)).toBeLessThanOrEqual(Date.parse(value.market.dataAsOf));
      }
      if (value.thesis.status === "settled") { expect(value.economics.settlementPriceUsd).not.toBeNull(); expect(value.economics.finalPnlUsd).not.toBeNull(); }
      if (value.thesis.status === "pending") { expect(value.market.currentSpotPriceUsd).toBeNull(); expect(value.economics.estimatedPnlUsd).toBeNull(); }
    }
  });
});

for (const headline of ["", "   ", "\n\t", "\u00a0", "\u2007", "\ufeff", "\u202f"]) {
  test(`context rejects blank headline ${JSON.stringify(headline)}`, () => {
    const example = thesisAiContextExamples[0];
    expect(thesisAiContextSchema.safeParse({ ...example, thesis: { ...example.thesis, headline } }).success).toBe(false);
    const rows = rowsFromExample(example);
    rows.thesis.headline = headline;
    let caught: unknown;
    try { buildThesisAiContext({ thesis: rows.thesis, creator: rows.creator, creatorPosition: rows.position, dataAsOf: example.market.dataAsOf }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ThesisAiContextError);
    expect(caught).toMatchObject({ code: "INVALID_VALUE" });
  });
}
test("context accepts and trims a normal headline", () => {
  const example = thesisAiContextExamples[0];
  expect(thesisAiContextSchema.parse({ ...example, thesis: { ...example.thesis, headline: "  A normal headline  " } }).thesis.headline).toBe("A normal headline");
});

test("context preserves an NBSP between words", () => {
  const example = thesisAiContextExamples[0]!;
  expect(thesisAiContextSchema.parse({ ...example, thesis: { ...example.thesis, headline: "Words\u00a0between" } }).thesis.headline).toBe("Words\u00a0between");
});
