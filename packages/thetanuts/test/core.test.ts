import { describe, expect, test } from "bun:test";
import { OPTION_BOOK_ABI, buildPriceFeedSymbolMap, getChainConfigById, type OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, type Address, type Hex, type Log } from "viem";
import { takerSide, buildFillTransactions, createReadClient, deriveMarkets, expectOrderFilled, fetchLiveOrders, listAssets, listExpiries, listStructures, parseOrderFilled, premiumUsd8From, quoteFill, payoffAtExpiry, payoffCurve, maxLoss, maxPayout, breakEven, ThetanutsLogicError } from "../src";

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
      order({ orderExpiry: now }),
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
  test("fetches only rows whose option and signed order are live", async () => {
    const live = order({}); const expiredOrder = order({ orderExpiry: now }); const nullRaw = { ...live };
    Object.defineProperty(nullRaw, "rawApiData", { value: null });
    const client = createReadClient({ rpcUrl: "http://127.0.0.1:1" }); client.api.fetchOrders = async () => [live, expiredOrder, nullRaw];
    expect(await fetchLiveOrders(client, now)).toEqual([live]);
  });
});

describe("quote", () => {
  const preview = (maxContracts: bigint) => ({ optionBook: { previewFillOrder: (row: OrderWithSignature, budget?: bigint, referrer?: string) => { const price = row.order.price; const requested = (budget ?? 0n) * 100_000_000n / price; const numContracts = requested > maxContracts ? maxContracts : requested; return { numContracts, maxContracts, collateralToken: row.rawApiData?.collateral ?? A("0"), pricePerContract: price, totalCollateral: budget ?? 0n, referrer: referrer ?? A("0"), maker: row.order.maker, expiry: row.order.expiry, isCall: row.rawApiData?.isCall ?? false, strikes: row.rawApiData?.strikes.map(BigInt) ?? [] }; } } });
  test("rounds and caps while recomputing premium", () => { const row = order({ price: 30_000_000n }); const uncapped = quoteFill({ client: preview(100n), order: row, budget: 2n, now }); expect(uncapped.numContracts).toBe(6n); expect(uncapped.premium).toBe(1n); expect(uncapped.capped).toBe(false); const capped = quoteFill({ client: preview(4n), order: row, budget: 2n, now }); expect(capped.numContracts).toBe(4n); expect(capped.capped).toBe(true); });
  test("marks the exact cap uncapped and one requested contract above capped", () => { const row = order({ price: 100_000_000n }); expect(quoteFill({ client: preview(5n), order: row, budget: 5n }).capped).toBe(false); expect(quoteFill({ client: preview(5n), order: row, budget: 6n }).capped).toBe(true); });
  test("gates taker sell", () => { const row = order({ isLong: false }); expect(() => quoteFill({ client: preview(10n), order: row, budget: 1n })).toThrow(ThetanutsLogicError); expect(() => quoteFill({ client: preview(10n), order: row, budget: 1n, allowUnverifiedTakerSell: true })).toThrowError(expect.objectContaining({ code: "TAKER_SELL_UNVERIFIED" })); });
  test("matches the real SDK pure preview", () => { const client = createReadClient({ rpcUrl: "http://127.0.0.1:1" }); const row = order({ price: 123_456_789n, available: 1_000_000_000_000n }); const quote = quoteFill({ client, order: row, budget: 10_000_000n }); expect(quote.numContracts).toBe(8_100_000n); expect(quote.premium).toBe(9_999_999n); });
  test("rejects non-fillable quotes", () => {
    expect(() => quoteFill({ client: preview(10n), order: order({}), budget: 0n, now })).toThrowError(expect.objectContaining({ code: "ZERO_CONTRACTS" }));
    expect(() => quoteFill({ client: preview(10n), order: order({ price: 100_000_001n }), budget: 1n, now })).toThrowError(expect.objectContaining({ code: "ZERO_CONTRACTS" }));
    expect(() => quoteFill({ client: preview(0n), order: order({}), budget: 1n, now })).toThrowError(expect.objectContaining({ code: "ZERO_CONTRACTS" }));
    expect(() => quoteFill({ client: preview(10n), order: order({ expiry: BigInt(now) }), budget: 1n, now })).toThrowError(expect.objectContaining({ code: "ORDER_EXPIRED" }));
    expect(() => quoteFill({ client: preview(10n), order: order({ orderExpiry: now }), budget: 1n, now })).toThrowError(expect.objectContaining({ code: "ORDER_EXPIRED" }));
    expect(() => quoteFill({ client: preview(10n), order: order({ price: 30_000_000n }), budget: 1n, now })).toThrowError(expect.objectContaining({ code: "ZERO_PREMIUM" }));
  });
});

describe("risk", () => {
  const p = (kind: "call" | "put" | "call-spread" | "put-spread", positionSide: "long" | "short", strikes: bigint[], contractSizeDecimals = 8) => ({ kind, positionSide, strikes, numContracts: 10n ** BigInt(contractSizeDecimals), premiumUsd8: 10n, contractSizeDecimals });
  test("converts and applies USDC and WETH collateral premiums in USD8", () => { const usdcPremium = premiumUsd8From({ premiumBaseUnits: 1_500_000n, collateralDecimals: 6, collateralUsdPrice8: 100_000_000n }); const wethPremium = premiumUsd8From({ premiumBaseUnits: 10_000_000_000_000_000n, collateralDecimals: 18, collateralUsdPrice8: 250_000_000_000n }); expect(usdcPremium).toBe(150_000_000n); expect(wethPremium).toBe(2_500_000_000n); expect(payoffAtExpiry({ ...p("call", "long", [200_000_000_000n]), premiumUsd8: usdcPremium }, 202_000_000_000n)).toBe(1_850_000_000n); expect(payoffAtExpiry({ ...p("call", "long", [200_000_000_000n]), premiumUsd8: wethPremium }, 203_000_000_000n)).toBe(500_000_000n); });
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
  test("break-even payoff is zero for every kind, side, and required size scale", () => { for (const decimals of [6, 8, 18]) for (const side of ["long", "short"] as const) for (const [kind, strikes] of [["call", [100n]], ["put", [100n]], ["call-spread", [100n, 120n]], ["put-spread", [80n, 100n]]] as const) { const params = p(kind, side, [...strikes], decimals); expect(payoffAtExpiry(params, breakEven(params))).toBe(0n); } });
  test("accepts bounded premiums through the cap and rejects above it on both sides", () => {
    for (const side of ["long", "short"] as const) for (const [kind, strikes, cap] of [["put", [100n], 100n], ["call-spread", [100n, 120n], 20n], ["put-spread", [80n, 100n], 20n]] as const) {
      for (const premiumUsd8 of [cap - 1n, cap]) expect(() => maxLoss({ ...p(kind, side, [...strikes]), premiumUsd8 })).not.toThrow();
      expect(() => maxLoss({ ...p(kind, side, [...strikes]), premiumUsd8: cap + 1n })).toThrowError(expect.objectContaining({ code: "INVALID_RISK_PARAMS", details: { premiumUsd8: cap + 1n, cap } }));
    }
  });
  test("rejects decimals outside the uint8 safe-integer domain", () => {
    for (const contractSizeDecimals of [256, 1e9]) expect(() => maxLoss({ ...p("call", "long", [100n]), contractSizeDecimals })).toThrowError(expect.objectContaining({ code: "INVALID_RISK_PARAMS" }));
    for (const collateralDecimals of [256, 1e9]) expect(() => premiumUsd8From({ premiumBaseUnits: 1n, collateralDecimals, collateralUsdPrice8: 1n })).toThrowError(expect.objectContaining({ code: "INVALID_RISK_PARAMS" }));
  });
});

describe("fill", () => {
  function client(allowance: bigint) { const real = createReadClient({ rpcUrl: "http://127.0.0.1:1" }); return { optionBook: real.optionBook, erc20: { getAllowance: async () => allowance, encodeApprove: real.erc20.encodeApprove.bind(real.erc20) } }; }
  test("uses original budget for calldata and approves recomputed premium", async () => { const budget = 10_000_000n; const row = order({ price: 123_456_789n, available: 1_000_000_000_000n }); const result = await buildFillTransactions({ client: client(0n), order: row, budget, account: A("5") as Address, now }); const decoded = decodeFunctionData({ abi: OPTION_BOOK_ABI, data: result.fill.data }); const encodedOrder = decoded.args?.[0]; expect(typeof encodedOrder === "object" && encodedOrder !== null && "numContracts" in encodedOrder ? encodedOrder.numContracts : -1n).toBe(8_100_000n); expect(result.expected).toMatchObject({ budget, numContracts: 8_100_000n, premium: 9_999_999n }); expect(result.approve).toBeDefined(); expect(result.fill.value).toBe(0n); const high = await buildFillTransactions({ client: client(9_999_999n), order: row, budget, account: A("5") as Address, now }); expect(high.approve).toBeUndefined(); });
  test("rejects a nonzero contract count with zero recomputed premium", async () => { await expect(buildFillTransactions({ client: client(0n), order: order({ price: 30_000_000n, available: 1_000_000_000_000n }), budget: 1n, account: A("5") as Address, now })).rejects.toMatchObject({ code: "ZERO_PREMIUM" }); });
  test("rejects expiry and gates taker sell", async () => { await expect(buildFillTransactions({ client: client(0n), order: order({ expiry: 1n, orderExpiry: 1 }), budget: 1n, account: A("5") as Address, now })).rejects.toBeInstanceOf(ThetanutsLogicError); const sell = order({ isLong: false }); await expect(buildFillTransactions({ client: client(0n), order: sell, budget: 1n, account: A("5") as Address, now })).rejects.toMatchObject({ code: "TAKER_SELL_UNVERIFIED" }); });
});

test("parses the canonical r12 OrderFilled event", () => {
  const buyer = A("1") as Address; const seller = A("2") as Address; const optionAddress = A("3") as Address; const referrer = A("4") as Address;
  const topics = encodeEventTopics({ abi: OPTION_BOOK_ABI, eventName: "OrderFilled", args: { nonce: 9n, buyer, seller } });
  const data = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bool" }], [optionAddress, 11n, 2n, referrer, 1n, true]);
  const log: Log<bigint, number, false> = { address: A("6") as Address, blockHash: `0x${"a".repeat(64)}`, blockNumber: 1n, data: data as Hex, logIndex: 0, removed: false, topics: topics as Log<bigint, number, false>["topics"], transactionHash: `0x${"b".repeat(64)}`, transactionIndex: 0 };
  expect(parseOrderFilled([log], { optionBook: A("6") as Address })[0]).toEqual({ nonce: 9n, buyer, seller, optionAddress, premiumAmount: 11n, feeCollected: 2n, referrer, referralFeePaid: 1n, sellerWasMaker: true });
  expect(expectOrderFilled([log], { optionBook: A("6") as Address }).nonce).toBe(9n);
  expect(parseOrderFilled([log], { optionBook: A("9") as Address })).toEqual([]);
});

test("requires exactly one OrderFilled event and ignores unrelated decodable events", () => {
  const unrelated: Log<bigint, number, false> = { address: A("6") as Address, blockHash: `0x${"c".repeat(64)}`, blockNumber: 1n, data: "0x", logIndex: 0, removed: false, topics: encodeEventTopics({ abi: OPTION_BOOK_ABI, eventName: "OrderCancelled", args: { nonce: 1n, maker: A("1") as Address } }) as Log<bigint, number, false>["topics"], transactionHash: `0x${"d".repeat(64)}`, transactionIndex: 0 };
  expect(() => expectOrderFilled([], { optionBook: A("6") as Address })).toThrow(ThetanutsLogicError);
  expect(() => expectOrderFilled([unrelated], { optionBook: A("6") as Address })).toThrow(ThetanutsLogicError);
  const buyer = A("1") as Address; const seller = A("2") as Address; const optionAddress = A("3") as Address; const referrer = A("4") as Address;
  const filled: Log<bigint, number, false> = { ...unrelated, data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bool" }], [optionAddress, 11n, 2n, referrer, 1n, true]), topics: encodeEventTopics({ abi: OPTION_BOOK_ABI, eventName: "OrderFilled", args: { nonce: 9n, buyer, seller } }) as Log<bigint, number, false>["topics"] };
  expect(parseOrderFilled([unrelated, filled], { optionBook: A("6") as Address })).toHaveLength(1);
  const otherBuyer = A("7") as Address;
  const other = { ...filled, topics: encodeEventTopics({ abi: OPTION_BOOK_ABI, eventName: "OrderFilled", args: { nonce: 10n, buyer: otherBuyer, seller } }) as Log<bigint, number, false>["topics"] };
  expect(expectOrderFilled([other, filled, other], { optionBook: A("6") as Address, buyer, seller, nonce: 9n }).nonce).toBe(9n);
  expect(() => expectOrderFilled([filled, filled], { optionBook: A("6") as Address, buyer, seller, nonce: 9n })).toThrow(ThetanutsLogicError);
  try { expectOrderFilled([filled, filled], { optionBook: A("6") as Address, buyer, seller, nonce: 9n }); } catch (error) { expect(error).toMatchObject({ code: "ORDER_FILLED_NOT_FOUND", details: { count: 2 } }); }
});

test("filters OrderFilled events by zero and nonzero nonce", () => {
  const optionBook = A("6") as Address; const buyer = A("1") as Address; const seller = A("2") as Address; const optionAddress = A("3") as Address; const referrer = A("4") as Address;
  const data = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bool" }], [optionAddress, 11n, 2n, referrer, 1n, true]);
  const log = (nonce: bigint, logIndex: number): Log<bigint, number, false> => ({ address: optionBook, blockHash: `0x${"e".repeat(64)}`, blockNumber: 1n, data, logIndex, removed: false, topics: encodeEventTopics({ abi: OPTION_BOOK_ABI, eventName: "OrderFilled", args: { nonce, buyer, seller } }) as Log<bigint, number, false>["topics"], transactionHash: `0x${"f".repeat(64)}`, transactionIndex: 0 });
  const logs = [log(0n, 0), log(1n, 1)];
  expect(expectOrderFilled(logs, { optionBook, nonce: 0n }).nonce).toBe(0n);
  expect(expectOrderFilled(logs, { optionBook, nonce: 1n }).nonce).toBe(1n);
});

describe("round 5 side and production evidence", () => {
  const client = () => createReadClient({ rpcUrl: "http://127.0.0.1:1" });
  test("raw maker side maps to the opposite taker side", () => {
    expect(takerSide(order({ isLong: true }))).toBe("buy");
    expect(takerSide(order({ isLong: false }))).toBe("sell");
    const missing = { ...order({}), rawApiData: undefined };
    expect(() => takerSide(missing)).toThrowError(expect.objectContaining({ code: "INVALID_ORDER" }));
  });

  test("legacy opt-in cannot bypass the buy fill gate, including calls", async () => {
    for (const isCall of [false, true]) {
      const row = order({ isLong: false, isCall });
      const real = client();
      const offline = { optionBook: real.optionBook, erc20: {
        getAllowance: async () => { throw new Error("Gate must precede allowance access"); },
        encodeApprove: real.erc20.encodeApprove.bind(real.erc20),
      } };
      expect(() => quoteFill({ client: real, order: row, budget: 1n, now, allowUnverifiedTakerSell: true })).toThrowError(expect.objectContaining({ code: "TAKER_SELL_UNVERIFIED" }));
      await expect(buildFillTransactions({ client: offline, order: row, budget: 1n, account: A("5") as Address, now, allowUnverifiedTakerSell: true })).rejects.toMatchObject({ code: "TAKER_SELL_UNVERIFIED" });
    }
  });

  // Source: supplied decoded transfers, not new chain observations. The four-strike
  // implementation is intentionally unspecified: no implementation address was supplied.
  test("reproduces supplied production premium, fee and collateral to the unit", () => {
    const fixtures = [
      { tx: "0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c", contracts: 389926n, price: 256458427n, collateralPerContract: 234000000000n, premium: 999998n, fee: 124999n, collateral: 912426840n, net: 874999n },
      { tx: "0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3", contracts: 10000n, price: 212682750n, collateralPerContract: 220000000000n, premium: 21268n, fee: 2658n, collateral: 22000000n, net: 18610n },
      { tx: "0xa2edb8b2f6ad2df3435934a59227e988e840472248ec7810532602302489be46", contracts: 43333n, price: 23077332818n, collateralPerContract: 100000000000n, premium: 10000100n, fee: 1250012n, collateral: 43333000n, net: 8750088n },
    ];
    for (const f of fixtures) {
      const premium = f.contracts * f.price / 100000000n;
      const collateral = f.collateralPerContract * f.contracts / 100000000n;
      expect(premium).toBe(f.premium);
      // Observed premium-percentage branch only; does NOT validate the notional
      // branch of the documented fee estimate or establish a production fee policy.
      const fee = premium / 8n;
      expect(fee).toBe(f.fee);
      expect(collateral).toBe(f.collateral);
      expect(premium - fee).toBe(f.net);
      console.log(`${f.tx}: contracts=${f.contracts} premium=${premium} fee=${fee} collateral=${collateral} net=${premium - fee}`);
    }
    const buy = order({ isLong: true, strikes: ["234000000000"], price: 256458427n, available: 912426840n });
    expect(quoteFill({ client: client(), order: buy, budget: 999999n, now })).toMatchObject({ numContracts: 389926n, premium: 999998n });
  });

  test("real SDK sell-put cap contradicts the proposed premium-based cap", () => {
    // Hypothetical remaining amount, not a claimed field of the production order.
    const row = order({ isLong: false, strikes: ["220000000000"], price: 212682750n, available: 22000000n });
    const real = client();
    const preview = real.optionBook.previewFillOrder(row, 22000000n);
    const proposedCap = BigInt(row.rawApiData!.maxCollateralUsable) * 100000000n / row.order.price;
    expect(preview.maxContracts).toBe(10000n);
    expect(proposedCap).toBeGreaterThan(preview.maxContracts);
    const encoded = real.optionBook.encodeFillOrder(row, 22000000n);
    const decoded = decodeFunctionData({ abi: OPTION_BOOK_ABI, data: encoded.data as Hex });
    expect(decoded.functionName).toBe("fillOrder");
    expect(decoded.args?.[0]).toMatchObject({ numContracts: 10000n, isLong: false });
    console.log(`SDK sell PUT: preview cap=${preview.maxContracts}; requested premium-based cap=${proposedCap}; encoded contracts=10000`);
  });

  test("SDK four-strike preview uses outer range, not supplied collateral width", () => {
    const row = order({ isCall: true, strikes: ["7950000000000", "8000000000000", "8100000000000", "8150000000000"], price: 23077332818n, available: 43333000n });
    const preview = client().optionBook.previewFillOrder(row);
    expect(preview.maxContracts).toBe(21666n);
    console.log(`SDK four-strike cap with 43333000 available=${preview.maxContracts}; supplied fill contracts=43333`);
  });

  test("short put and spreads distinguish full exposure from net maximum loss", () => {
    const put = { kind: "put" as const, positionSide: "short" as const, strikes: [220000000000n], numContracts: 10000n, premiumUsd8: 0n, contractSizeDecimals: 6 };
    expect(maxLoss(put)).toBe(2200000000n);
    expect(payoffAtExpiry(put, 0n)).toBe(-2200000000n);
    const net = { ...put, premiumUsd8: 1861000n };
    expect(maxLoss(net)).toBe(2198139000n);
    expect(payoffAtExpiry(net, 0n)).toBe(-2198139000n);
    for (const kind of ["call-spread", "put-spread"] as const) {
      const spread = { ...put, kind, strikes: [220000000000n, 230000000000n] };
      expect(maxLoss(spread)).toBe(100000000n);
      expect(maxLoss({ ...spread, premiumUsd8: 1861000n })).toBe(98139000n);
    }
  });
});
