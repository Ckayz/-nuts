import { describe, expect, test } from "bun:test";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { decodeFillEventSnapshot, encodeFillEventSnapshot } from "../src/fill-event-snapshot";
import { decodeOrderSnapshot, encodeOrderSnapshot, orderSnapshotV1Schema } from "../src/order-snapshot";

describe("snapshot codecs", () => {
  test("OrderWithSignature round-trips bigint fields through JSON", () => {
    const order: OrderWithSignature = { order: { maker: "0x1", taker: "0x0", option: "", isBuyer: false, numContracts: 3n, price: 123456789n, expiry: 2000000000n, nonce: 7n, strikes: [7800000000000n, 7400000000000n], strikePrice: 7800000000000n, deadline: 1999999999n }, signature: "0x12", availableAmount: 99n, makerAddress: "0x1" };
    const snapshot = encodeOrderSnapshot(order);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(orderSnapshotV1Schema.parse(snapshot).version).toBe(1);
    expect(decodeOrderSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(order);
  });

  test("ParsedOrderFilled round-trips bigint fields through JSON", () => {
    const event = { nonce: 1n, buyer: "0xb", seller: "0xs", optionAddress: "0xo", premiumAmount: 2n, feeCollected: 3n, referrer: "0xr", referralFeePaid: 4n, sellerWasMaker: true };
    expect(decodeFillEventSnapshot(JSON.parse(JSON.stringify(encodeFillEventSnapshot(event))))).toEqual(event);
  });
});
