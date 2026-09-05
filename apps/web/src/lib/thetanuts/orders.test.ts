import { expect, test, mock, spyOn } from "bun:test";
import { createReadClient, deriveMarkets, quoteFill, quoteSellFill } from "@nuts/thetanuts";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";

mock.module("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";
const { toTradeable, sizeFill, readClient, getOrderSnapshot, usdRisk } = await import("./orders");
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
 expect(result.contracts).toBe(expected.numContracts.toString());
 expect(result.premium).toBe("0.999998"); expect(result.maxLoss).toBe(result.premium);
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
 expect(result.contracts).toBe(expected.numContracts.toString());
 expect(result.collateralRequired).toBe("22"); expect(result.maxLoss).toBe("22");
 expect(result.premium).toBe("0.021268"); expect(result.feeEstimate).toBe("0.002658");
 expect(result.verification).toBe("verified");
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
 const orders = spyOn(readClient.api, "fetchOrders").mockResolvedValue([fixture(), fixture(false), fixture(true, A("7"))]);
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
