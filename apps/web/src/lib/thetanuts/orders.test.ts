import { expect, test, mock, spyOn } from "bun:test";
import { createReadClient, deriveMarkets, quoteFill, quoteSellFill } from "@nuts/thetanuts";
import type { ZodType } from "zod";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";

mock.module("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";
const { toTradeable, sizeFill, readClient, getOrderSnapshot, usdRisk, rawOrderApi, decimalString, searchOrders,
 isSdkIncompatible, CONTRACT_UNITS_UNVERIFIED, buyContractSizeDecimals } = await import("./orders");
const { instrumentKey } = await import("./instrument");
const { env } = await import("@nuts/env/server");
type SdkIncompatible = import("./types").SdkIncompatible;
/** Narrow away the adapter-failure arm; a test that hits it should fail loudly, not silently skip. */
const ok = <T extends object>(value: T | SdkIncompatible): T => {
 if (isSdkIncompatible(value)) throw new Error(`unexpected sdk_incompatible: ${value.detail}`);
 return value;
};
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
  const [a, b] = (await Promise.all([getOrderSnapshot(), getOrderSnapshot()])).map(ok);
  expect(a).toBe(b); expect(a!.orders).toHaveLength(3); expect(a!.marketData).toEqual({ ETH: 2000 });
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

test("buy contract units are proven only for 6-decimal collateral; 8 and 18 are refused", () => {
 expect(buyContractSizeDecimals(6)).toBe(6);
 expect([buyContractSizeDecimals(8), buyContractSizeDecimals(18), buyContractSizeDecimals(null)]).toEqual([null, null, null]);
 for (const token of Object.values(client.chainConfig.tokens).filter(t => [8, 18].includes(t.decimals))) {
  const order = view(fixture(true, token.address));
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
  const order = view(fixture(true, token.address));
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
 const row = fixture(true, ABASWETH);
 row.rawApiData!.isCall = true;
 row.order.optionType = 0;
 row.order.price = 1000000000000000000n;
 row.availableAmount = 22000000000000000000n;
 row.rawApiData!.maxCollateralUsable = "22000000000000000000";
 return row;
}

test("string isLong is dropped before the SDK coerces it into a BUY", async () => {
 // SDK dist/index.js:3387 does isLong: Boolean(rawOrder["isLong"]), so "false" would become true.
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [
  { ...rawFixture(fixture(false)), order: { ...rawFixture(fixture(false)).order, isLong: "false" } },
 ] } });
 const data = spyOn(readClient.api, "getMarketData").mockResolvedValue({ prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } });
 try {
  const result = ok(await getOrderSnapshot(true));
  console.log("STRING_FALSE", JSON.stringify({ retained: result.orders.length, dropped: result.droppedEntries, side: result.orders[0]?.side }));
  expect(result.orders).toHaveLength(0);
  expect(result.droppedEntries).toBe(1);
  // And at the agent surface: the row can never be previewed as an executable BUY.
  const { searchOptionBookOrders, previewOptionBookTrade } = await import("../agent/tools");
  const search = await searchOptionBookOrders.execute!({ limit: 6 }, { toolCallId: "test", messages: [], context: {} });
  if (!search || !("orders" in search)) throw Error("Missing orders");
  expect(search.orders).toHaveLength(0);
  expect(search.droppedEntries).toBe(1);
  const preview = await previewOptionBookTrade.execute!({ instrumentKey: "ETH|buy|x|P|1|1|y", budget: "1" }, { toolCallId: "test", messages: [], context: {} });
  console.log("MALFORMED_SIDE_TOOL", JSON.stringify(preview));
  expect(preview).toMatchObject({ found: false });
 } finally { request.mockRestore(); data.mockRestore(); }
});

test("real boolean sides survive validation and keep their taker side", async () => {
 const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: [rawFixture(fixture(true)), rawFixture(fixture(false))] } });
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
 const call = fixture(false);
 call.rawApiData!.isCall = true;
 call.order.optionType = 0;
 const callView = view(call);
 expect(callView.side).toBe("sell");
 expect(callView.contractSizeDecimals).toBeNull();
 expect(callView.pricePerContractUsd).toBeNull();
 // A sell PUT on the same collateral keeps its price: the package supplies that unit.
 const put = view(fixture(false));
 expect(put.contractSizeDecimals).toBe(6);
 expect(put.pricePerContractUsd).toBe(decimalString(put.sdkOrder.order.price, 100_000_000n));
});
