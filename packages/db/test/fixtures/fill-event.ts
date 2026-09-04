import { encodeFillEventSnapshot } from "../../src/fill-event-snapshot";

// Synthetic receipt fields for offline tests only; not evidence of an onchain fill.
export const canonicalFillEvent = encodeFillEventSnapshot({
  nonce: 1n,
  buyer: "0xabc",
  seller: "0xdef",
  optionAddress: "0xc",
  premiumAmount: 1n,
  feeCollected: 0n,
  referrer: "0x0",
  referralFeePaid: 0n,
  sellerWasMaker: true,
});
