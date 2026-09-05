import { expect, test, mock, spyOn } from "bun:test";
import { createReadClient, deriveMarkets, quoteFill, quoteSellFill } from "@nuts/thetanuts";
import type { ZodType } from "zod";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";

mock.module("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";
const { toTradeable, sizeFill, readClient, getOrderSnapshot, usdRisk, rawOrderApi, decimalString, searchOrders } = await import("./orders");
const { instrumentKey } = await import("./instrument");
const { env } = await import("@nuts/env/server");
const client = createReadClient({ rpcUrl: "http://127.0.0.1:1", referrer: env.THESIS_REFERRER });
const A = (digit: string) => `0x${digit.repeat(40)}`;
function fixture(isLong = true, collateral = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab"): OrderWithSignature {
 const expiry = BigInt(Math.floor(Date.now() / 1000) + 10000);
 return {
  order: { maker: A("1"), taker: A("0"), option: "", isBuyer: !isLong, numContracts: 0n,
   price: 212682750n, expiry, nonce: 1n, optionType: 1, strikes: [220000000000n], strikePrice: 220000000000n,
   collateralToken: collateral, underlyingToken: A("0"), deadline: expiry },
  signature: "0x12", availableAmount: 22000000000n, makerAddress: A("1"),
  rawApiData: { collateral, priceFeed: A("2"), implementation: "0x6aD53DD058bea004829cCf58a282C21a7Df02DcA",
   strikes: ["220000000000"], isCall: false, isLong, orderExpiryTimestamp: Number(expiry), extraOptionData: "0x", maxCollateralUsable: "22000000000" },
 };
}
const view = (row: OrderWithSignature) => toTradeable(deriveMarkets([row])[0]!);

test("labels both sides and prevents side/collateral instrument collisions", () => {
 const buy = view(fixture()); const sell = view(fixture(false));
 expect(buy.side).toBe("buy"); expect(sell.side).toBe("sell");
 expect(sell.implementation.info?.name).toBe("PHYSICAL_PUT");
 expect(instrumentKey(buy)).not.toBe(instrumentKey(sell));
 expect(instrumentKey(buy)).not.toBe(instrumentKey(view(fixture(true, A("7")))));
});
test("buy sizing equals package quote and forwards referrer", () => {
 const row = fixture(); const spy = spyOn(client.optionBook, "previewFillOrder");
 const expected = quoteFill({ client, order: row, budget: 1000000n, referrer: env.THESIS_REFERRER });
 const result = sizeFill(view(row), "1", client);
 expect(result.executable).toBe(true);
 if (!result.executable) throw new Error(result.reason);
 expect(result.raw.numContracts).toBe(expected.numContracts.toString());
 expect(result.contracts).toBe(decimalString(expected.numContracts, 10n ** BigInt(result.contractSizeDecimals!)));
 expect(result.premium?.amount).toBe("0.999998"); expect(result.maxLoss?.amount).toBe(result.premium.amount);
 expect(result.capped).toBe(expected.capped);
 expect(spy.mock.calls.every(call => call[2] === env.THESIS_REFERRER)).toBe(true);
 spy.mockRestore();
});
test("decoded sell put: 22000000 collateral, 21268 premium, 2658 estimated fee", () => {
 const row = fixture(false); const spy = spyOn(client.optionBook, "previewFillOrder");
 const expected = quoteSellFill({ client, order: row, collateralBudget: 22000000n, referrer: env.THESIS_REFERRER });
 expect([expected.collateralRequired, expected.premiumGross, expected.feeEstimate]).toEqual([22000000n, 21268n, 2658n]);
 const result = sizeFill(view(row), "22", client);
 expect(result.executable).toBe(true);
 if (!result.executable) throw new Error(result.reason);
 expect(result.raw.numContracts).toBe(expected.numContracts.toString());
 expect(result.contracts).toBe(decimalString(expected.numContracts, 10n ** BigInt(result.contractSizeDecimals!)));
 expect(result.collateralRequired?.amount).toBe("22"); expect(result.maxLoss?.amount).toBe("22");
 expect(result.premium?.amount).toBe("0.021268"); expect(result.feeEstimate?.amount).toBe("0.002658");
 expect(result.verification).toBe("verified");
 expect(result.contractSizeDecimals).toBe(expected.contractSizeDecimals);
 expect(result.premium.decimals).toBe(expected.collateralDecimals);
 expect(spy.mock.calls.every(call => call[2] === env.THESIS_REFERRER)).toBe(true);
 spy.mockRestore();
});
test("gated sell pair is non-executable without opting out", () => {
 const result = sizeFill(view(fixture(false, client.chainConfig.tokens.USDC.address)), "1", client);
 expect(result).toMatchObject({ found: true, executable: false, verification: "unverified" });
 if (!result.executable) expect(result.reason).toContain("STRUCTURE_COLLATERAL_UNVERIFIED");
});
test("SDK config supplies token decimals and excess precision is rejected", () => {
 expect(sizeFill(view(fixture()), "0.0000001", client).executable).toBe(false);
});
test("snapshot uses SDK methods, keeps all collateral and sides, caches and deduplicates", async () => {
 const orders = spyOn(rawOrderApi, "request").mockResolvedValue({ orders: [rawFixture(fixture()), rawFixture(fixture(false)), rawFixture(fixture(true, A("7")))] });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 2000, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const [a, b] = await Promise.all([getOrderSnapshot(), getOrderSnapshot()]);
  expect(a).toBe(b); expect(a.orders).toHaveLength(3); expect(a.marketData).toEqual({ ETH: 2000 });
  expect(await getOrderSnapshot()).toBe(a); expect(orders).toHaveBeenCalledTimes(1); expect(data).toHaveBeenCalledTimes(1);
  await getOrderSnapshot(true); expect(orders).toHaveBeenCalledTimes(2);
 } finally { orders.mockRestore(); data.mockRestore(); }
});

test("USD limit compares exact side-specific loss, including just over the ceiling", () => {
 expect(usdRisk("10", 1, 10)).toEqual({ amount: "10", withinLimit: true });
 expect(usdRisk("10.000000000000000001", 1, 10)?.withinLimit).toBe(false);
 expect(usdRisk("22", 1, 10)?.withinLimit).toBe(false);
 expect(usdRisk("0.021268", 1, 10)?.withinLimit).toBe(true);
 expect(usdRisk("1", undefined, 10)).toBeNull();
});

function rawFixture(row: OrderWithSignature) {
 return { signature: row.signature, order: { ...row.rawApiData,
  maker: row.order.maker, price: row.order.price.toString(), expiry: Number(row.order.expiry) } };
}

test("other PHYSICAL_PUT implementation is rejected by the package gate", () => {
 const row = fixture(false);
 row.rawApiData!.implementation = "0xac5eca7129909de8c12e1a41102414b5a5f340aa";
 const result = sizeFill(view(row), "1", client);
 console.log("OTHER_IMPLEMENTATION", JSON.stringify(result));
 expect(result).toMatchObject({ executable: false, verification: "unverified" });
 if (!result.executable) expect(result.reason).toContain("STRUCTURE_COLLATERAL_UNVERIFIED");
});

test("decoded buy has human contracts and explicitly denominated money", () => {
 const row = fixture(true, client.chainConfig.tokens.USDC.address);
 row.order.price = 256458427n;
 row.order.strikes = [234000000000n];
 row.order.strikePrice = 234000000000n;
 row.rawApiData!.strikes = ["234000000000"];
 const result = sizeFill(view(row), "1", client);
 expect(result.executable).toBe(true);
 if (!result.executable) throw Error(result.reason);
 console.log("BUY_DECODED", JSON.stringify(result));
 expect(result.contracts).toBe("0.389926");
 expect(result.contractsUnit).toBe("contracts");
 expect(result.premium).toEqual({ amount: "0.999998", token: "USDC", decimals: 6 });
 expect(result.raw.numContracts).toBe("389926");
});

test("buy put units follow package decimals for 8 and 18 decimal tokens", () => {
 for (const token of Object.values(client.chainConfig.tokens).filter(t => [8, 18].includes(t.decimals))) {
  const row = fixture(true, token.address);
  const result = sizeFill(view(row), "1", client);
  expect(result.executable).toBe(true);
  if (!result.executable) throw Error(result.reason);
  expect(result.contractSizeDecimals).toBe(token.decimals);
  expect(result.contracts).toBe(decimalString(BigInt(result.raw.numContracts), 10n ** BigInt(token.decimals)));
  expect(result.premium.decimals).toBe(token.decimals);
 }
 expect(decimalString(1000000000000000001n, 10n ** 18n)).toBe("1.000000000000000001");
});

test("cached signature and option deadlines refresh at equality and exclude expired rows", async () => {
 const epoch = Math.floor(Date.now() / 1000) * 1000;
 const clock = spyOn(Date, "now").mockReturnValue(epoch);
 const signature = fixture();
 signature.rawApiData!.orderExpiryTimestamp = epoch / 1000 + 2;
 const option = fixture();
 option.order.expiry = BigInt(epoch / 1000 + 2);
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [rawFixture(signature), rawFixture(option)] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  expect((await getOrderSnapshot(true)).orders).toHaveLength(2);
  clock.mockReturnValue(epoch + 1000);
  expect((await searchOrders()).orders).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(epoch + 2000);
  expect((await searchOrders()).orders).toHaveLength(0);
  expect(request).toHaveBeenCalledTimes(2);
  clock.mockReturnValue(epoch + 3000);
  const result = await searchOrders();
  console.log("EXPIRED_CACHE", JSON.stringify({ returned: result.orders.length }));
  expect(result.orders).toHaveLength(0);
 } finally { clock.mockRestore(); request.mockRestore(); data.mockRestore(); }
});

test("malformed rows are isolated through SDK normalization and counted", async () => {
 const valid = rawFixture(fixture());
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [
  valid, null, { order: { ...valid.order, price: "bad" } },
  { order: { ...valid.order, orderExpiryTimestamp: "bad" } },
 ] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const result = await getOrderSnapshot(true);
  console.log("MALFORMED_ROWS", JSON.stringify({ retained: result.orders.length, droppedEntries: result.droppedEntries }));
  expect(result.orders).toHaveLength(1);
  expect(result.droppedEntries).toBe(3);
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("tool schema excludes binary and exposes signature deadlines", async () => {
 mock.module("@/lib/thesis-context", () => ({ getThesisContext: async () => ({ available: false, reason: "not_found" }) }));
 const { searchOptionBookOrders } = await import("../agent/tools");
 const schema = searchOptionBookOrders.inputSchema as ZodType;
 expect(schema.safeParse({ kind: "binary" }).success).toBe(false);
 expect(schema.safeParse({ kind: "vanilla" }).success).toBe(true);
 const row = fixture();
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ orders: [rawFixture(row)] });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  await getOrderSnapshot(true);
  const result = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  if (!result || !("orders" in result)) throw Error("Missing orders");
  expect(result.orders[0]?.orderExpiresAt).toBe(new Date(row.rawApiData!.orderExpiryTimestamp * 1000).toISOString());
  expect(result.orders[0]?.secondsUntilOrderExpiry).toBeGreaterThan(0);
 } finally { request.mockRestore(); data.mockRestore(); }
});
