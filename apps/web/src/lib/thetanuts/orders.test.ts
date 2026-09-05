import { expect, test, mock, spyOn } from "bun:test";
import { createReadClient, deriveMarkets, quoteFill, quoteSellFill } from "@nuts/thetanuts";
import type { ZodType } from "zod";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";

mock.module("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";
const { toTradeable, sizeFill, readClient, getOrderSnapshot, usdRisk, rawOrderApi, decimalString, searchOrders,
 isSdkIncompatible, isFeedUnusable, isFeedUnavailable, CONTRACT_UNITS_UNVERIFIED, COLLATERAL_USD_UNAVAILABLE,
 collateralUsdPrice, COLLATERAL_USD_SOURCES, buyContractSizeDecimals } = await import("./orders");
const { instrumentKey } = await import("./instrument");
const { env } = await import("@nuts/env/server");
type SdkIncompatible = import("./types").SdkIncompatible;
type FeedUnavailable = import("./types").FeedUnavailable;
/** Narrow away BOTH unreadable-book arms; a test that hits one should fail loudly, not silently skip. */
/** A configured token, or a loud failure. The SDK types the map as partial. */
const tokenAddress = (symbol: string): `0x${string}` => {
 const configured = (client.chainConfig.tokens as Record<string, { address: `0x${string}` } | undefined>)[symbol];
 if (!configured) throw new Error(`SDK chainConfig has no ${symbol} token on this chain`);
 return configured.address;
};
const ok = <T extends object>(value: T | FeedUnavailable): T => {
 if (isFeedUnavailable(value)) throw new Error(`unexpected ${value.error}: ${value.detail}`);
 return value;
};
const client = createReadClient({ rpcUrl: "http://127.0.0.1:1", referrer: env.THESIS_REFERRER });
const A = (digit: string) => `0x${digit.repeat(40)}`;
function fixture(isLong = false, collateral = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab"): OrderWithSignature {
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
 const buy = view(fixture()); const sell = view(fixture(true));
 expect(buy.side).toBe("buy"); expect(sell.side).toBe("sell");
 expect(sell.implementation.info?.name).toBe("PHYSICAL_PUT");
 expect(instrumentKey(buy)).not.toBe(instrumentKey(sell));
 expect(instrumentKey(buy)).not.toBe(instrumentKey(view(fixture(false, A("7")))));
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
 const row = fixture(true); const spy = spyOn(client.optionBook, "previewFillOrder");
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
 const result = sizeFill(view(fixture(true, tokenAddress("USDC"))), "1", client);
 expect(result).toMatchObject({ found: true, executable: false, verification: "unverified" });
 if (!result.executable) expect(result.reason).toContain("STRUCTURE_COLLATERAL_UNVERIFIED");
});
test("SDK config supplies token decimals and excess precision is rejected", () => {
 expect(sizeFill(view(fixture()), "0.0000001", client).executable).toBe(false);
});
test("snapshot uses SDK methods, keeps all collateral and sides, caches and deduplicates", async () => {
 const orders = spyOn(rawOrderApi, "request").mockResolvedValue({ orders: [rawFixture(fixture()), rawFixture(fixture(true)), rawFixture(fixture(false, A("7")))] });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 2000, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const [a, b] = (await Promise.all([getOrderSnapshot(), getOrderSnapshot()])).map(ok);
  if (!a || !b) throw new Error("expected two snapshots");
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
 const row = fixture(true);
 row.rawApiData!.implementation = "0xac5eca7129909de8c12e1a41102414b5a5f340aa";
 const result = sizeFill(view(row), "1", client);
 console.log("OTHER_IMPLEMENTATION", JSON.stringify(result));
 expect(result).toMatchObject({ executable: false, verification: "unverified" });
 if (!result.executable) expect(result.reason).toContain("STRUCTURE_COLLATERAL_UNVERIFIED");
});

test("decoded buy has human contracts and explicitly denominated money", () => {
 const row = fixture(false, tokenAddress("USDC"));
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

test("buy contract units are proven only for 6-decimal collateral; 8 and 18 are refused", () => {
 expect(buyContractSizeDecimals(6)).toBe(6);
 expect([buyContractSizeDecimals(8), buyContractSizeDecimals(18), buyContractSizeDecimals(null)]).toEqual([null, null, null]);
 for (const token of Object.values(client.chainConfig.tokens).filter(t => [8, 18].includes(t.decimals))) {
  const order = view(fixture(false, token.address));
  // The order view must not publish a per-contract price it cannot justify.
  expect(order.pricePerContractUsd).toBeNull();
  expect(order.contractSizeDecimals).toBeNull();
  const result = sizeFill(order, "1", client);
  expect(result).toMatchObject({ found: true, executable: false, verification: "unverified", reason: CONTRACT_UNITS_UNVERIFIED });
  // Base units stay available; nothing scaled to human units is emitted.
  expect(result).not.toHaveProperty("contracts");
  expect(result).not.toHaveProperty("premium");
  if (!result.executable) {
   expect(result.raw?.contractSizeDecimals).toBeNull();
   expect(BigInt(result.raw!.numContracts)).toBeGreaterThan(0n);
  }
 }
 for (const token of Object.values(client.chainConfig.tokens).filter(t => t.decimals === 6)) {
  const order = view(fixture(false, token.address));
  const result = sizeFill(order, "1", client);
  expect(result.executable).toBe(true);
  if (!result.executable) throw Error(result.reason);
  expect(result.contractSizeDecimals).toBe(6);
  expect(order.pricePerContractUsd).toBe(decimalString(order.sdkOrder.order.price, 100_000_000n));
  expect(result.contracts).toBe(decimalString(BigInt(result.raw.numContracts), 10n ** 6n));
  expect(result.premium.decimals).toBe(6);
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
  expect(ok(await getOrderSnapshot(true)).orders).toHaveLength(2);
  clock.mockReturnValue(epoch + 1000);
  expect(ok(await searchOrders()).orders).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(epoch + 2000);
  expect(ok(await searchOrders()).orders).toHaveLength(0);
  expect(request).toHaveBeenCalledTimes(2);
  clock.mockReturnValue(epoch + 3000);
  const result = ok(await searchOrders());
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
  const result = ok(await getOrderSnapshot(true));
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
  ok(await getOrderSnapshot(true));
  const result = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  if (!result || !("orders" in result)) throw Error("Missing orders");
  expect(result.orders[0]?.orderExpiresAt).toBe(new Date(row.rawApiData!.orderExpiryTimestamp * 1000).toISOString());
  expect(result.orders[0]?.secondsUntilOrderExpiry).toBeGreaterThan(0);
 } finally { request.mockRestore(); data.mockRestore(); }
});

const ABASWETH = "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7";
/** The reviewer's CALL_UNITS fixture: single-strike call on 18-decimal aBasWETH, where the
 * SDK's capacity cap sizes contracts in 10**6 while the collateral is 10**18. */
function callRow18() {
 const row = fixture(false, ABASWETH);
 row.rawApiData!.isCall = true;
 row.order.optionType = 0;
 row.order.price = 1000000000000000000n;
 row.availableAmount = 22000000000000000000n;
 row.rawApiData!.maxCollateralUsable = "22000000000000000000";
 return row;
}

test("string isLong is dropped before the SDK coerces it into a SELL", async () => {
 // SDK dist/index.js:3387 does isLong: Boolean(rawOrder["isLong"]), so the string "false"
 // would become true. isLong is the MAKER's long flag (packages/thetanuts/src/side.ts), so
 // true means the TAKER SELLS: a genuine taker-BUY row would be presented as a sell, and the
 // user would be asked to lock collateral instead of paying a premium.
 // A genuine BUY row rides along so the book stays readable: a book whose EVERY row is
 // dropped is a feed failure and is covered by its own test below.
 const stringified = rawFixture(fixture(false));
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [
  rawFixture(fixture(false)),
  { ...stringified, order: { ...stringified.order, isLong: "false" } },
 ] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const result = ok(await getOrderSnapshot(true));
  console.log("STRING_FALSE", JSON.stringify({ retained: result.orders.length, dropped: result.droppedEntries, sides: result.orders.map(o => o.side) }));
  expect(result.orders).toHaveLength(1);
  expect(result.droppedEntries).toBe(1);
  // The survivor is the real buy row; the row that would have been coerced into a SELL
  // never reached the book.
  expect(result.orders.map(o => o.side)).toEqual(["buy"]);
  // And at the agent surface: the dropped row can never be previewed as an executable BUY.
  const { searchOptionBookOrders, previewOptionBookTrade } = await import("../agent/tools");
  const search = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  if (!search || !("orders" in search)) throw Error("Missing orders");
  expect(search.orders).toHaveLength(1);
  expect(search.droppedEntries).toBe(1);
  const preview = await previewOptionBookTrade.execute!({ instrumentKey: "ETH|sell|x|P|1|1|y", budget: "1" }, { toolCallId: "test", messages: [], context: {} });
  console.log("MALFORMED_SIDE_TOOL", JSON.stringify(preview));
  expect(preview).toMatchObject({ found: false });
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("real boolean sides survive validation and keep their taker side", async () => {
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [rawFixture(fixture(false)), rawFixture(fixture(true))] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const result = ok(await getOrderSnapshot(true));
  expect(result.droppedEntries).toBe(0);
  expect(result.orders.map(o => o.side)).toEqual(["buy", "sell"]);
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("every load-bearing raw field is validated, never coerced", async () => {
 const base = rawFixture(fixture());
 const mutations: Array<[string, unknown]> = [
  ["isLong", "true"], ["isLong", 1], ["isLong", null], ["isLong", undefined],
  ["isCall", "false"], ["isCall", 0],
  ["price", "1.5"], ["price", "-1"], ["price", null], ["price", "abc"],
  ["strikes", []], ["strikes", ["x"]], ["strikes", "220000000000"], ["strikes", null],
  ["orderExpiryTimestamp", "later"], ["orderExpiryTimestamp", null],
  ["expiry", "soon"], ["expiry", null],
  ["maxCollateralUsable", "22.5"], ["maxCollateralUsable", null],
  ["collateral", "0xnothex"], ["collateral", "0x123"], ["collateral", null],
  ["implementation", "PHYSICAL_PUT"], ["implementation", null],
 ];
 const rows = mutations.map(([field, value]) => ({ ...base, order: { ...base.order, [field]: value } }));
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [...rows, base] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const result = ok(await getOrderSnapshot(true));
  console.log("FIELD_VALIDATION", JSON.stringify({ mutations: rows.length, retained: result.orders.length, dropped: result.droppedEntries }));
  expect(result.droppedEntries).toBe(rows.length);
  expect(result.orders).toHaveLength(1);
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("single-strike call on 18-decimal collateral is refused, with no human price or contracts", async () => {
 const row = callRow18();
 const order = view(row);
 expect(order.pricePerContractUsd).toBeNull();
 expect(order.contractSizeDecimals).toBeNull();
 const result = sizeFill(order, "0.01", client);
 console.log("CALL_UNITS", JSON.stringify({
  executable: result.executable,
  reason: result.executable ? null : result.reason,
  viewPricePerContract: order.pricePerContractUsd,
  raw: result.executable ? result.raw : result.raw,
 }));
 expect(result).toMatchObject({ found: true, executable: false, verification: "unverified", reason: CONTRACT_UNITS_UNVERIFIED });
 expect(result).not.toHaveProperty("contracts");
 expect(result).not.toHaveProperty("premium");
 expect(result).not.toHaveProperty("maxLoss");
 if (!result.executable) {
  // Base units only: the quote ran, its unit is simply unknown.
  expect(result.raw).toMatchObject({ numContracts: "1000000", premium: "10000000000000000", contractSizeDecimals: null, collateralDecimals: 18 });
 }
 // And the agent tool must not print the 1e8-scaled number as a per-contract price.
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [rawFixture(row)] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 const { searchOptionBookOrders } = await import("../agent/tools");
 try {
  await getOrderSnapshot(true);
  const tool = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  if (!tool || !("orders" in tool)) throw Error("Missing orders");
  console.log("CALL_UNITS_TOOL", JSON.stringify(tool.orders[0]?.premiumPerContract));
  expect(tool.orders[0]?.premiumPerContract.amount).toBeNull();
  expect(tool.orders[0]?.premiumPerContract.unavailable).toBe(CONTRACT_UNITS_UNVERIFIED);
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("a missing SDK normalizer is an adapter failure, never an empty book", async () => {
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [rawFixture(fixture())] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 const original = rawOrderApi.normalizeOdetteOrder;
 const { searchOptionBookOrders, getMarketData, previewOptionBookTrade } = await import("../agent/tools");
 try {
  (rawOrderApi as { normalizeOdetteOrder?: unknown }).normalizeOdetteOrder = undefined;
  const snapshot = await getOrderSnapshot(true);
  const search = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  const market = await getMarketData.execute!({}, { toolCallId: "test", messages: [], context: {} });
  const preview = await previewOptionBookTrade.execute!({ instrumentKey: "none", budget: "1" }, { toolCallId: "test", messages: [], context: {} });
  console.log("MISSING_NORMALIZER", JSON.stringify({ snapshot, search, market, preview }));
  expect(isSdkIncompatible(snapshot)).toBe(true);
  for (const result of [snapshot, search, market, preview]) {
   expect(result).toMatchObject({ error: "sdk_incompatible" });
   expect((result as SdkIncompatible).detail).toContain("normalizeOdetteOrder");
   expect(JSON.stringify(result)).not.toContain("Nothing on the book");
  }
  // The feed is never touched when the boundary is broken.
  expect(request).not.toHaveBeenCalled();
 } finally { (rawOrderApi as { normalizeOdetteOrder?: unknown }).normalizeOdetteOrder = original; request.mockRestore(); data.mockRestore(); }
});

test("a missing SDK request method is reported the same way", async () => {
 const original = rawOrderApi.request;
 try {
  (rawOrderApi as { request?: unknown }).request = undefined;
  const snapshot = await getOrderSnapshot(true);
  expect(snapshot).toMatchObject({ error: "sdk_incompatible" });
  expect((snapshot as SdkIncompatible).detail).toContain("request");
 } finally { (rawOrderApi as { request?: unknown }).request = original; }
});

test("the search tool exposes droppedEntries so a partial book is visible", async () => {
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [
  rawFixture(fixture()), null, { order: { ...rawFixture(fixture()).order, isLong: "false" } },
 ] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 const { searchOptionBookOrders } = await import("../agent/tools");
 try {
  await getOrderSnapshot(true);
  const result = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  if (!result || !("orders" in result)) throw Error("Missing orders");
  console.log("DROPPED_ENTRIES", JSON.stringify({ returned: result.returned, droppedEntries: result.droppedEntries }));
  expect(result.droppedEntries).toBe(2);
  expect(result.returned).toBe(1);
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("the sell view withholds a per-contract price for the family the package refuses", () => {
 // Single-strike calls are the one family whose two SDK decimals views can disagree;
 // quoteSellFill throws STRUCTURE_UNSUPPORTED for them, so no unit is supplied.
 const call = fixture(true);
 call.rawApiData!.isCall = true;
 call.order.optionType = 0;
 const callView = view(call);
 expect(callView.side).toBe("sell");
 expect(callView.contractSizeDecimals).toBeNull();
 expect(callView.pricePerContractUsd).toBeNull();
 // A sell PUT on the same collateral keeps its price: the package supplies that unit.
 const put = view(fixture(true));
 expect(put.contractSizeDecimals).toBe(6);
 expect(put.pricePerContractUsd).toBe(decimalString(put.sdkOrder.order.price, 100_000_000n));
});


// ─── Round 5 folds ──────────────────────────────────────────────────────────────
const CTX = { toolCallId: "test", messages: [], context: {} };
const FLAT_PRICES = { prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } };
/** The live spot map, measured 2026-09-05: keyed by UNDERLYING ASSET only. */
const REAL_PRICES = { prices: { ETH: 2451.42, BTC: 79536.18, SOL: 101.86565608, XRP: 1.3989, BNB: 722.05638627, AVAX: 7.412 }, metadata: { lastUpdated: 0, currentTime: 0 } };
const PUT_SPREAD = "0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134"; // SPREAD, 2 strikes (SDK dist/index.js)
async function tools() { return await import("../agent/tools"); }
function mockBook(rows: unknown[], prices = FLAT_PRICES) {
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: rows } } as never);
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue(prices);
 return () => { request.mockRestore(); data.mockRestore(); };
}
/** Push the clock past the 20s snapshot TTL so an UNFORCED read re-fetches through the
 * current mock. Needed only where the forced read cannot refresh the cache itself: an
 * unusable feed is deliberately never cached, so a still-valid earlier snapshot survives it.
 * Fixture deadlines sit ~10000s out, so the jump does not expire any order. */
function expireSnapshotCache() {
 const future = Date.now() + 60_000;
 const clock = spyOn(Date, "now").mockReturnValue(future);
 return () => clock.mockRestore();
}
/** Pick the arm of a tool's result union that actually reached the book. The streaming and
 * structured-error arms are real outcomes elsewhere; in these tests reaching one is the bug,
 * so it throws rather than silently skipping the assertions. */
function armed<T, S extends object>(result: T, shape: keyof S, label: string): Extract<T, S> {
 if (!result || typeof result !== "object" || !(shape in result)) {
  throw new Error(`expected a ${label} result, got ${JSON.stringify(result)}`);
 }
 return result as Extract<T, S>;
}
const searched = <T,>(result: T) => armed<T, { totalMatched: number; returned: number; truncated: boolean; droppedEntries: number; note?: string; orders: Array<{ kind: string | null }> }>(result, "totalMatched", "search");
const previewed = <T,>(result: T) => armed<T, { found: boolean; asOf: string }>(result, "found", "preview");

test("MAJOR1: the spot map is keyed by asset, so no collateral symbol can ever be looked up in it", async () => {
 const restore = mockBook([rawFixture(fixture())], REAL_PRICES);
 try {
  const snapshot = ok(await getOrderSnapshot(true));
  const collateralSymbols = Object.values(readClient.chainConfig.tokens).map(t => t.symbol);
  const overlap = collateralSymbols.filter(s => s in snapshot.marketData);
  console.log("MAJOR1_KEYSPACES", JSON.stringify({ marketData: Object.keys(snapshot.marketData), collateralSymbols, overlap }));
  expect(overlap).toEqual([]);
  // Which is exactly why valuation goes through the explicit mapping, not the price map.
  for (const symbol of collateralSymbols) expect(snapshot.marketData[symbol]).toBeUndefined();
 } finally { restore(); }
});

test("MAJOR1: collateral USD sources price the stablecoins and refuse everything else", () => {
 expect(Object.keys(COLLATERAL_USD_SOURCES).sort()).toEqual(["USDC", "aBasUSDC"]);
 expect(collateralUsdPrice("USDC")).toBe(1);
 expect(collateralUsdPrice("aBasUSDC")).toBe(1);
 // Wrapped/bridged majors have no citable token -> underlying relation, so they are refused,
 // never silently valued at 0 and never assumed 1:1 with their underlying.
 for (const symbol of ["WETH", "aBasWETH", "cbBTC", "aBascbBTC", "cbDOGE", "cbXRP"]) {
  expect(collateralUsdPrice(symbol)).toBeNull();
 }
 // Nothing resolves through Object.prototype, and an ASSET symbol is not a collateral symbol.
 for (const symbol of ["constructor", "toString", "__proto__", "hasOwnProperty", "", "ETH", "BTC"]) {
  expect(collateralUsdPrice(symbol)).toBeNull();
 }
 expect(collateralUsdPrice(null)).toBeNull();
});

test("MAJOR1: the decoded aBasUSDC taker-BUY put previews as executable with maxLossUsd equal to its premium", async () => {
 const row = fixture(); // aBasUSDC (6 decimals), taker BUY, PHYSICAL_PUT 0x6aD53D…
 const restore = mockBook([rawFixture(row)], REAL_PRICES);
 try {
  const snapshot = ok(await getOrderSnapshot(true));
  const order = snapshot.orders[0]!;
  expect(order.collateralToken.symbol).toBe("aBasUSDC");
  const { previewOptionBookTrade } = await tools();
  const preview = previewed(await previewOptionBookTrade.execute!({ instrumentKey: instrumentKey(order), budget: "1" }, CTX));
  console.log("D1_TOOL_WITH_REAL_PRICES", JSON.stringify(preview));
  expect(preview).toMatchObject({ found: true, executable: true, verification: "verified", side: "buy" });
  if (!("risk" in preview) || !("premium" in preview)) throw new Error("expected an executable preview");
  // maxLossUsd is the premium itself, at the documented 1 USD stablecoin peg.
  expect(preview.premium.amount).toBe("0.999998");
  expect(preview.risk.maxLossUsd).toBe(preview.premium.amount);
  expect(preview.reason).toBeUndefined();
 } finally { restore(); }
});

test("MAJOR1: an aBasWETH order is refused, never valued at zero", async () => {
 const row = callRow18(); // aBasWETH (18 decimals)
 const restore = mockBook([rawFixture(row)], REAL_PRICES);
 try {
  const snapshot = ok(await getOrderSnapshot(true));
  const order = snapshot.orders[0]!;
  expect(order.collateralToken.symbol).toBe("aBasWETH");
  const { previewOptionBookTrade } = await tools();
  const preview = previewed(await previewOptionBookTrade.execute!({ instrumentKey: instrumentKey(order), budget: "0.01" }, CTX));
  console.log("D1_ABASWETH", JSON.stringify(preview));
  expect(preview).toMatchObject({ found: true, executable: false });
  // Never a zero valuation: either the units gate or the valuation gate refuses it outright.
  if (!("reason" in preview)) throw new Error("expected a refusal reason");
  expect([CONTRACT_UNITS_UNVERIFIED, COLLATERAL_USD_UNAVAILABLE]).toContain(String(preview.reason));
  expect(JSON.stringify(preview)).not.toContain('"maxLossUsd":"0"');
  // The valuation layer itself refuses the token, independently of the units gate.
  expect(collateralUsdPrice("aBasWETH")).toBeNull();
  expect(usdRisk("1", collateralUsdPrice("aBasWETH") ?? undefined, 10)).toBeNull();
 } finally { restore(); }
});

test("MAJOR2a: a payload carrying no orders array is feed_unusable in every tool, not an empty book", async () => {
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { market_data: {} } } as never);
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue(FLAT_PRICES);
 const unfreeze = expireSnapshotCache();
 const { searchOptionBookOrders, getMarketData, previewOptionBookTrade } = await tools();
 try {
  const snapshot = await getOrderSnapshot(true);
  const search = await searchOptionBookOrders.execute!({ limit: 6 }, CTX);
  const market = await getMarketData.execute!({}, CTX);
  const preview = await previewOptionBookTrade.execute!({ instrumentKey: "x", budget: "1" }, CTX);
  console.log("S1_ALL_TOOLS", JSON.stringify({ snapshot, search, market, preview }));
  for (const result of [snapshot, search, market, preview]) {
   expect(result).toMatchObject({ error: "feed_unusable", droppedEntries: 0 });
   expect(JSON.stringify(result)).not.toContain("Nothing on the book");
  }
  expect(isFeedUnusable(snapshot)).toBe(true);
  expect(isFeedUnavailable(snapshot)).toBe(true);
  expect(isSdkIncompatible(snapshot)).toBe(false);
  // A non-array `orders` is the same failure.
  request.mockResolvedValue({ data: { orders: "many" } } as never);
  expect(await getOrderSnapshot(true)).toMatchObject({ error: "feed_unusable" });
  // The error is never cached: an unforced read goes back to the feed and reports it again.
  expect(await getOrderSnapshot()).toMatchObject({ error: "feed_unusable" });
 } finally { unfreeze(); request.mockRestore(); data.mockRestore(); }
});

test("MAJOR2b: losing every row is feed_unusable in every tool, however the rows fail", async () => {
 // A real taker-BUY row (isLong false) published with the string "false", which the SDK
 // would coerce to true, i.e. into a taker SELL. Every row here fails validation.
 const stringified = rawFixture(fixture(false));
 const cases: Array<[string, unknown[]]> = [
  ["S4_schema", [null, null, { order: {} }]],
  ["E2_stringified_isLong", Array.from({ length: 5 }, () => ({ ...stringified, order: { ...stringified.order, isLong: "false" } }))],
 ];
 const { searchOptionBookOrders, getMarketData, previewOptionBookTrade } = await tools();
 for (const [name, rows] of cases) {
  const restore = mockBook(rows);
  const unfreeze = expireSnapshotCache();
  try {
   const snapshot = await getOrderSnapshot(true);
   const search = await searchOptionBookOrders.execute!({ limit: 6 }, CTX);
   const market = await getMarketData.execute!({}, CTX);
   const preview = await previewOptionBookTrade.execute!({ instrumentKey: "x", budget: "1" }, CTX);
   console.log(name, JSON.stringify({ snapshot, search, market, preview }));
   for (const result of [snapshot, search, market, preview]) {
    expect(result).toMatchObject({ error: "feed_unusable", droppedEntries: rows.length });
    expect(JSON.stringify(result)).not.toContain("Nothing on the book");
    expect(JSON.stringify(result)).not.toContain("no longer quoted");
   }
  } finally { unfreeze(); restore(); }
 }
});

test("MAJOR2c/d: a readable book keeps the empty-book note, and getMarketData carries droppedEntries", async () => {
 const { searchOptionBookOrders, getMarketData } = await tools();
 // S5: genuinely empty. The feed worked; there is simply nothing on the book.
 let restore = mockBook([]);
 try {
  ok(await getOrderSnapshot(true));
  const search = searched(await searchOptionBookOrders.execute!({ limit: 6 }, CTX));
  const market = await getMarketData.execute!({}, CTX);
  console.log("S5_EMPTY", JSON.stringify({ search, market }));
  expect(search).toMatchObject({ totalMatched: 0, droppedEntries: 0 });
  expect(String(search.note)).toContain("Nothing on the book");
  expect(market).toMatchObject({ droppedEntries: 0, assets: [] });
  expect(market).not.toHaveProperty("error");
 } finally { restore(); }
 // S6: rows parsed; the caller's own filters excluded them. Note, and a partial-book count.
 restore = mockBook([rawFixture(fixture()), null]);
 try {
  ok(await getOrderSnapshot(true));
  const search = searched(await searchOptionBookOrders.execute!({ limit: 6, asset: "SOL" }, CTX));
  const market = await getMarketData.execute!({}, CTX);
  console.log("S6_FILTERED_OUT", JSON.stringify({ search, market }));
  expect(search).toMatchObject({ totalMatched: 0, droppedEntries: 1 });
  expect(String(search.note)).toContain("Nothing on the book");
  // getMarketData reports the same partial-book signal the search tool does.
  expect(market).toMatchObject({ droppedEntries: 1 });
  // A book that still holds rows is never the structured error.
  expect(searched(await searchOptionBookOrders.execute!({ limit: 6 }, CTX))).toMatchObject({ totalMatched: 1 });
 } finally { restore(); }
});

test("MAJOR3: kind is filtered before the page cap, so totalMatched counts the whole set", async () => {
 const spreadRow = (i: number) => {
  const row = fixture();
  row.rawApiData!.implementation = PUT_SPREAD;
  row.rawApiData!.strikes = [String(220000000000 + i), String(230000000000 + i)];
  row.rawApiData!.orderExpiryTimestamp += 1000 + i;
  row.order.expiry = BigInt(row.rawApiData!.orderExpiryTimestamp);
  return rawFixture(row);
 };
 const vanillaRow = (i: number) => {
  const row = fixture();
  row.rawApiData!.strikes = [String(220000000000 + i)];
  row.rawApiData!.orderExpiryTimestamp += i;
  row.order.expiry = BigInt(row.rawApiData!.orderExpiryTimestamp);
  return rawFixture(row);
 };
 // 227 vanilla FIRST, so a 200-row page would contain no spread at all.
 const rows = [...Array.from({ length: 227 }, (_, i) => vanillaRow(i)), ...Array.from({ length: 101 }, (_, i) => spreadRow(i))];
 const { searchOptionBookOrders } = await tools();
 let restore = mockBook(rows);
 try {
  const snapshot = ok(await getOrderSnapshot(true));
  const truth = snapshot.orders.reduce<Record<string, number>>((a, o) => { const k = String(o.kind); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  console.log("E1_TRUE_COUNTS", JSON.stringify({ total: snapshot.orders.length, ...truth }));
  expect(snapshot.orders).toHaveLength(328);
  expect(truth).toEqual({ vanilla: 227, multi_leg: 101 });
  for (const kind of ["vanilla", "multi_leg"] as const) {
   const result = searched(await searchOptionBookOrders.execute!({ limit: 6, kind }, CTX));
   console.log("E1_TOOL_" + kind, JSON.stringify({ totalMatched: result.totalMatched, returned: result.returned }));
   // The whole filtered set, not the 200-row page it was once counted from.
   expect(result.totalMatched).toBe(truth[kind]!);
   expect(result.returned).toBe(6);
   // m6: a page of a bigger set now SAYS it is a page. What this assertion has always
   // been about is that the empty-book note did not fire, which it still does not.
   expect(result.truncated).toBe(true);
   expect(String(result.note)).toContain(`Showing 6 of ${truth[kind]!}`);
   expect(String(result.note)).not.toContain("Nothing on the book");
   expect(result.orders.every(o => o.kind === kind)).toBe(true);
  }
  // Unfiltered still counts the whole book.
  expect(searched(await searchOptionBookOrders.execute!({ limit: 6 }, CTX)).totalMatched).toBe(328);
 } finally { restore(); }
 // A kind nothing matches is the empty-book note, not a structured error.
 restore = mockBook([rawFixture(fixture())]);
 try {
  ok(await getOrderSnapshot(true));
  const none = searched(await searchOptionBookOrders.execute!({ limit: 6, kind: "multi_leg" }, CTX));
  console.log("E1_TOOL_none", JSON.stringify({ totalMatched: none.totalMatched, returned: none.returned, note: none.note }));
  expect(none.totalMatched).toBe(0);
  expect(String(none.note)).toContain("Nothing on the book");
 } finally { restore(); }
});

test("MINOR1: a taker-SELL view withholds the unit and price on non-6-decimal collateral", () => {
 // aBasWETH is 18-decimal; sellContractSizeDecimals is UNVERIFIED beyond 6 decimals
 // (packages/thetanuts/src/quote.ts), and the package's own quote refuses the pair.
 const sell = view(fixture(true, ABASWETH));
 expect(sell.side).toBe("sell");
 expect(sell.contractSizeDecimals).toBeNull();
 expect(sell.pricePerContractUsd).toBeNull();
 const quoted = sizeFill(sell, "1", client);
 console.log("D2_SELL_18DEC", JSON.stringify({ csd: sell.contractSizeDecimals, price: sell.pricePerContractUsd, executable: quoted.executable }));
 expect(quoted.executable).toBe(false);
 // 8-decimal collateral is withheld for the same reason.
 const eight = view(fixture(true, tokenAddress("cbBTC")));
 expect(eight.contractSizeDecimals).toBeNull();
 expect(eight.pricePerContractUsd).toBeNull();
 // The proven 6-decimal unit is still published.
 const six = view(fixture(true));
 expect(six.contractSizeDecimals).toBe(6);
 expect(six.pricePerContractUsd).toBe(decimalString(six.sdkOrder.order.price, 100_000_000n));
});

test("MINOR3/4: every preview result carries asOf, and market counts are named for what they count", async () => {
 const restore = mockBook([rawFixture(fixture()), rawFixture(callRow18())], REAL_PRICES);
 const { previewOptionBookTrade, getMarketData } = await tools();
 try {
  const snapshot = ok(await getOrderSnapshot(true));
  const asOf = snapshot.fetchedAt.toISOString();
  const executable = previewed(await previewOptionBookTrade.execute!({ instrumentKey: instrumentKey(snapshot.orders[0]!), budget: "1" }, CTX));
  const refused = previewed(await previewOptionBookTrade.execute!({ instrumentKey: instrumentKey(snapshot.orders[1]!), budget: "0.01" }, CTX));
  const missing = previewed(await previewOptionBookTrade.execute!({ instrumentKey: "no-such-instrument", budget: "1" }, CTX));
  console.log("ASOF", JSON.stringify({ executable: executable.asOf, refused: refused.asOf, missing: missing.asOf }));
  expect(executable).toMatchObject({ found: true, executable: true, asOf });
  expect(refused).toMatchObject({ found: true, executable: false, asOf });
  expect(missing).toMatchObject({ found: false, asOf });
  const market = await getMarketData.execute!({}, CTX);
  if (!market || !("assets" in market)) throw new Error("expected market data");
  console.log("MARKET_COUNT_NAME", JSON.stringify(market.assets[0]));
  expect(market.assets[0]).toHaveProperty("quotedOrders");
  expect(market.assets[0]).not.toHaveProperty("tradeableOrders");
 } finally { restore(); }
});

/**
 * C-m1. `feed_unusable` describes "the book could not be read". A TRANSPORT
 * failure is exactly that, but it used to throw out of `fetchSnapshot` and out
 * of `getOrderSnapshot`, so every caller had to survive an exception instead of
 * reading the result the type already provides. A null payload threw a
 * TypeError from the same place.
 */
test("C-m1: a transport failure becomes feed_unusable, never a thrown error", async () => {
 const request = spyOn(rawOrderApi, "request").mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));
 try {
  const result = await getOrderSnapshot(true);
  expect(isFeedUnusable(result)).toBe(true);
  if (!isFeedUnusable(result)) throw new Error("unreachable");
  expect(result.detail).toContain("could not be reached");
  expect(result.detail).toContain("ECONNREFUSED");
  // Never described as an empty book.
  expect(result.detail).toContain("not an empty book");
  // Not cached: the next call re-reads.
  const second = await getOrderSnapshot(true);
  expect(isFeedUnusable(second)).toBe(true);
 } finally {
  request.mockRestore();
 }
});

test("C-m1: an HTTP rejection and a non-Error rejection are both feed_unusable", async () => {
 for (const rejection of [Object.assign(new Error("HTTP 503"), { status: 503 }), "gateway timeout", 500]) {
  const request = spyOn(rawOrderApi, "request").mockRejectedValue(rejection);
  try {
   const result = await getOrderSnapshot(true);
   expect(isFeedUnusable(result)).toBe(true);
  } finally {
   request.mockRestore();
  }
 }
});

test("C-m1: a null response body is feed_unusable, not a TypeError", async () => {
 // `rawOrderApi` IS `readClient.api`, so mocking `request` also breaks the
 // `getMarketData` call that uses it internally. Both are stubbed so the null
 // BODY branch is the one under test rather than the transport branch.
 const request = spyOn(rawOrderApi, "request").mockResolvedValue(null as unknown as { orders?: unknown });
 const market = spyOn(readClient.api, "getMarketData").mockResolvedValue(
  {} as unknown as Awaited<ReturnType<typeof readClient.api.getMarketData>>,
 );
 try {
  const result = await getOrderSnapshot(true);
  expect(isFeedUnusable(result)).toBe(true);
  if (!isFeedUnusable(result)) throw new Error("unreachable");
  expect(result.detail).toContain("no response body");
  expect(result.detail).toContain("not an empty book");
 } finally {
  request.mockRestore();
  market.mockRestore();
 }
});
