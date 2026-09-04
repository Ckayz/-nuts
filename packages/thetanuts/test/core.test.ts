import { describe, expect, test } from "bun:test";
import { OPTION_BOOK_ABI, buildPriceFeedSymbolMap, getChainConfigById, type OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type Log } from "viem";
import { buildFillTransactions, deriveMarkets, listAssets, listExpiries, listStructures, parseOrderFilled, quoteFill, payoffAtExpiry, payoffCurve, maxLoss, maxPayout, breakEven, ThetanutsLogicError } from "../src";

const A = (digit: string) => `0x${digit.repeat(40)}`;
const now = 2_000_000_000;
const config = getChainConfigById(8453);
const feeds = buildPriceFeedSymbolMap(8453);
const feedEntries = Object.entries(feeds);
const feedFor = (symbol: string, fallback: string) => feedEntries.find(([, value]) => value === symbol)?.[0] ?? fallback;
const token = Object.values(config.tokens)[0];
if (!token) throw new Error("Base token fixture unavailable");
const tokenAddress = token.address;
const implementations = Object.entries(config.implementations);
const implementationFor = (name: string) => implementations.find(([key]) => key === name)?.[1] ?? A("9");

function order(overrides: Partial<{ feed: string; collateral: string; implementation: string; strikes: string[]; isCall: boolean; isLong: boolean; expiry: bigint; orderExpiry: number; available: bigint; price: bigint }>): OrderWithSignature {
  const expiry = overrides.expiry ?? BigInt(now + 10_000);
  const strikes = overrides.strikes ?? ["10000000000"];
  const collateral = overrides.collateral ?? tokenAddress;
  return { order: { maker: A("1"), taker: A("0"), option: "", isBuyer: !(overrides.isLong ?? true), numContracts: 0n, price: overrides.price ?? 10_000_000n, expiry, nonce: 1n, optionType: overrides.isCall === false ? 1 : 0, strikes: strikes.map(BigInt), strikePrice: BigInt(strikes[0] ?? "0"), collateralToken: collateral, underlyingToken: A("0"), deadline: BigInt(overrides.orderExpiry ?? now + 5_000) }, signature: "0x12", availableAmount: overrides.available ?? 1_000_000n, makerAddress: A("1"), rawApiData: { collateral, priceFeed: overrides.feed ?? feedFor("BTC", A("2")), implementation: overrides.implementation ?? implementationFor("PUT"), strikes, isCall: overrides.isCall ?? false, isLong: overrides.isLong ?? true, orderExpiryTimestamp: overrides.orderExpiry ?? now + 5_000, extraOptionData: "0x", maxCollateralUsable: (overrides.available ?? 1_000_000n).toString() } };
}

describe("markets", () => {
  test("derives every live market and preserves unknowns", () => {
    const rows: OrderWithSignature[] = [
      order({ feed: feedFor("BTC", A("2")), isCall: false }),
      order({ feed: feedFor("ETH", A("3")), implementation: implementationFor("CALL_SPREAD"), strikes: ["200000000000", "250000000000"], isCall: true }),
      order({ feed: feedFor("SOL", A("4")), isCall: false }),
      order({ feed: A("8"), collateral: A("7") }),
      order({ expiry: BigInt(now - 1) }),
      order({ available: 0n }),
    ];
    const markets = deriveMarkets(rows, now);
    expect(markets).toHaveLength(4);
    expect(markets.some((market) => market.asset.startsWith("UNKNOWN_FEED:"))).toBe(true);
    expect(markets.find((market) => market.priceFeed === A("8"))?.collateralToken.decimals).toBeNull();
    expect(markets.find((market) => market.side === "call")?.strikes).toHaveLength(2);
    expect(listAssets(markets).length).toBeGreaterThanOrEqual(3);
    const first = markets[0]; if (!first) throw new Error("fixture market missing");
    expect(listExpiries(markets, first.asset)).toEqual([BigInt(now + 10_000)]);
    expect(listStructures(markets, first.asset, first.expiry).length).toBeGreaterThan(0);
  });
});

describe("quote", () => {
  const preview = (maxContracts: bigint) => ({ optionBook: { previewFillOrder: (row: OrderWithSignature, budget?: bigint, referrer?: string) => { const price = row.order.price; const requested = (budget ?? 0n) * 100_000_000n / price; const numContracts = requested > maxContracts ? maxContracts : requested; return { numContracts, maxContracts, collateralToken: row.rawApiData?.collateral ?? A("0"), pricePerContract: price, totalCollateral: budget ?? 0n, referrer: referrer ?? A("0"), maker: row.order.maker, expiry: row.order.expiry, isCall: row.rawApiData?.isCall ?? false, strikes: row.rawApiData?.strikes.map(BigInt) ?? [] }; } } });
  test("rounds and caps while recomputing premium", () => { const row = order({ price: 30_000_000n }); const uncapped = quoteFill({ client: preview(100n), order: row, budget: 1n }); expect(uncapped.numContracts).toBe(3n); expect(uncapped.premium).toBe(0n); expect(uncapped.capped).toBe(false); const capped = quoteFill({ client: preview(2n), order: row, budget: 1n }); expect(capped.numContracts).toBe(2n); expect(capped.capped).toBe(true); });
  test("gates taker sell", () => { const row = order({ isLong: false }); expect(() => quoteFill({ client: preview(10n), order: row, budget: 1n })).toThrow(ThetanutsLogicError); expect(quoteFill({ client: preview(10n), order: row, budget: 1n, allowUnverifiedTakerSell: true }).numContracts).toBeGreaterThan(0n); });
});

describe("risk", () => {
  const p = (kind: "call" | "put" | "call-spread" | "put-spread", positionSide: "long" | "short", strikes: bigint[]) => ({ kind, positionSide, strikes, numContracts: 100_000_000n, pricePerContract: 10n, contractSizeDecimals: 8 });
  test("known answers on both sides", () => { for (const [kind, strikes, spot, gross] of [["call", [100n], 130n, 30n], ["put", [100n], 70n, 30n], ["call-spread", [100n, 120n], 130n, 20n], ["put-spread", [80n, 100n], 70n, 20n]] as const) { expect(payoffAtExpiry(p(kind, "long", [...strikes]), spot)).toBe(gross - 10n); expect(payoffAtExpiry(p(kind, "short", [...strikes]), spot)).toBe(10n - gross); } });
  test("curve and extrema", () => {
    expect(payoffCurve(p("call", "long", [100n]), [90n, 100n, 120n])).toEqual([-10n, -10n, 10n]);
    for (const side of ["long", "short"] as const) {
      expect(breakEven(p("call", side, [100n]))).toBe(110n);
      expect(breakEven(p("put", side, [100n]))).toBe(90n);
      expect(breakEven(p("call-spread", side, [100n, 120n]))).toBe(110n);
      expect(breakEven(p("put-spread", side, [80n, 100n]))).toBe(90n);
    }
    expect(maxLoss(p("call", "long", [100n]))).toBe(10n); expect(maxPayout(p("call", "long", [100n]))).toBeNull();
    expect(maxLoss(p("call", "short", [100n]))).toBeNull(); expect(maxPayout(p("call", "short", [100n]))).toBe(10n);
    expect(maxLoss(p("put", "long", [100n]))).toBe(10n); expect(maxPayout(p("put", "long", [100n]))).toBe(90n);
    expect(maxLoss(p("put", "short", [100n]))).toBe(90n); expect(maxPayout(p("put", "short", [100n]))).toBe(10n);
    for (const kind of ["call-spread", "put-spread"] as const) {
      const strikes = kind === "call-spread" ? [100n, 120n] : [80n, 100n];
      expect(maxLoss(p(kind, "long", strikes))).toBe(10n); expect(maxPayout(p(kind, "long", strikes))).toBe(10n);
      expect(maxLoss(p(kind, "short", strikes))).toBe(10n); expect(maxPayout(p(kind, "short", strikes))).toBe(10n);
    }
  });
});

describe("fill", () => {
  function client(allowance: bigint) { return { optionBook: { previewFillOrder: (row: OrderWithSignature, premium?: bigint) => ({ numContracts: premium ?? 0n, maxContracts: 99n, collateralToken: row.rawApiData?.collateral ?? A("0"), pricePerContract: row.order.price, totalCollateral: premium ?? 0n, referrer: A("0"), maker: row.order.maker, expiry: row.order.expiry, isCall: false, strikes: [100n] }), encodeFillOrder: () => ({ to: A("6"), data: "0x1234" }) }, erc20: { getAllowance: async () => allowance, encodeApprove: (_token: string, _spender: string, amount: bigint) => ({ to: tokenAddress, data: `0x${amount.toString(16).padStart(64, "0")}` }) } }; }
  test("adds exact approval only below premium", async () => { const premium = 7n; const low = await buildFillTransactions({ client: client(6n), order: order({ expiry: BigInt(Math.floor(Date.now() / 1_000) + 1000), orderExpiry: Math.floor(Date.now() / 1_000) + 500 }), premium, account: A("5") as Address }); expect(low.approve?.value).toBe(0n); expect(low.approve?.data.endsWith("07")).toBe(true); expect(low.fill.value).toBe(0n); const high = await buildFillTransactions({ client: client(7n), order: order({ expiry: BigInt(Math.floor(Date.now() / 1_000) + 1000), orderExpiry: Math.floor(Date.now() / 1_000) + 500 }), premium, account: A("5") as Address }); expect(high.approve).toBeUndefined(); });
  test("rejects expiry", async () => { await expect(buildFillTransactions({ client: client(0n), order: order({ expiry: 1n, orderExpiry: 1 }), premium: 1n, account: A("5") as Address })).rejects.toBeInstanceOf(ThetanutsLogicError); });
});

test("parses the canonical r12 OrderFilled event", () => {
  const buyer = A("1") as Address; const seller = A("2") as Address; const optionAddress = A("3") as Address; const referrer = A("4") as Address;
  const topics = encodeEventTopics({ abi: OPTION_BOOK_ABI, eventName: "OrderFilled", args: { nonce: 9n, buyer, seller } });
  const data = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bool" }], [optionAddress, 11n, 2n, referrer, 1n, true]);
  const log: Log<bigint, number, false> = { address: A("6") as Address, blockHash: `0x${"a".repeat(64)}`, blockNumber: 1n, data: data as Hex, logIndex: 0, removed: false, topics: topics as Log<bigint, number, false>["topics"], transactionHash: `0x${"b".repeat(64)}`, transactionIndex: 0 };
  expect(parseOrderFilled([log])[0]).toEqual({ nonce: 9n, buyer, seller, optionAddress, premiumAmount: 11n, feeCollected: 2n, referrer, referralFeePaid: 1n, sellerWasMaker: true });
});
