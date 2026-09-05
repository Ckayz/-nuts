import { expect, test } from "bun:test";
import type { Address } from "viem";
import { VERIFIED_SELL_PAIRS, type Market, type ParsedOrderFilled } from "../src";
import { compareFill, decimalUnits, selectMarket, type Transfer } from "./tiny-fill";
const wallet = `0x${"1".repeat(40)}` as Address, maker = `0x${"2".repeat(40)}` as Address, book = `0x${"3".repeat(40)}` as Address;
const pair = VERIFIED_SELL_PAIRS[0]!;
function market(side: "buy" | "sell", price: bigint, nonce = 1n): Market {
  // Selection consumes only these fields; quote/encoding fixtures live in test/core.test.ts.
  return { side: "put", pricePerContract: price, collateralToken: { address: pair.collateral, symbol: "aBasUSDC", decimals: 6 }, implementation: { address: pair.implementation, info: null }, order: { order: { maker, nonce }, rawApiData: { isLong: side === "buy" } } } as Market;
}
test("buy selects lowest USDC-family premium with exact side and nonce", () => {
  const low = market("buy", 212682750n), high = market("buy", 256458427n, 2n);
  expect(selectMarket([high, market("sell", 1n), low], { side: "buy", allowUnverified: false })).toBe(low);
  expect(selectMarket([low, high], { side: "buy", nonce: "2", allowUnverified: false })).toBe(high);
  expect(() => selectMarket([low], { side: "buy", collateral: "cbBTC", allowUnverified: false })).toThrow();
  expect(() => selectMarket([low, low], { side: "buy", nonce: "1", allowUnverified: false })).toThrow("ambiguous");
});
test("sell gates the exact verified pair even when pinned", () => {
  const verified = market("sell", 212682750n);
  const unverified = { ...verified, implementation: { ...verified.implementation, address: maker } };
  expect(selectMarket([unverified, verified], { side: "sell", allowUnverified: false })).toBe(verified);
  expect(() => selectMarket([unverified], { side: "sell", nonce: "1", collateral: "aBasUSDC", allowUnverified: false })).toThrow();
  expect(selectMarket([unverified], { side: "sell", allowUnverified: true })).toBe(unverified);
});
test("decimal budgets reject truncation, zero, exponent and negative input", () => {
  expect(decimalUnits("1.00", 6)).toBe(1000000n);
  expect(decimalUnits("0.000000000000000001", 18)).toBe(1n);
  for (const input of ["0", "-1", "1e3", "0.0000001"]) expect(() => decimalUnits(input, 6)).toThrow();
});
// Amounts: main checkout .research/thetanuts/finding-fill-debits.md. Addresses label roles.
for (const side of ["buy", "sell"] as const) {
  test(`${side} production fixture reconciles and detects one-unit mismatches`, () => {
    // buy 0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c
    // sell 0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3
    const premium = side === "buy" ? 999998n : 21268n, fee = side === "buy" ? 124999n : 2658n;
    const collateral = side === "buy" ? 0n : 22000000n;
    const buyer = side === "buy" ? wallet : maker, seller = side === "sell" ? wallet : maker;
    const token = side === "buy" ? "USDC-fixture" : pair.collateral;
    const event: ParsedOrderFilled = { nonce: 1n, buyer, seller, optionAddress: maker, premiumAmount: premium, feeCollected: fee, referrer: maker, referralFeePaid: 0n, sellerWasMaker: side === "buy" };
    const transfers: Transfer[] = [
      { token, from: buyer, to: seller, amount: premium - fee },
      { token, from: buyer, to: book, amount: fee },
      { token, from: seller, to: book, amount: side === "buy" ? 912426840n : collateral },
      { token, from: book, to: "option", amount: side === "buy" ? 912426840n : collateral },
      { token: "unrelated-token", from: wallet, to: book, amount: 123n },
    ];
    const compare = (e = event, ts = transfers) => compareFill(side, { premium, fee, collateral }, e, ts, token, wallet, book);
    expect(compare().every(r => r.match)).toBe(true);
    expect(compare({ ...event, premiumAmount: premium + 1n }).every(r => r.match)).toBe(false);
    expect(compare({ ...event, feeCollected: fee + 1n }).every(r => r.match)).toBe(false);
    expect(compare(event, [...transfers, { token, from: wallet, to: book, amount: 1n }]).every(r => r.match)).toBe(false);
    expect(compare(event, transfers.filter(t => !(side === "sell" ? t.to === wallet : t.from === wallet))).every(r => r.match)).toBe(false);
  });
}
