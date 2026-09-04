import { z } from "zod";

interface ParsedOrderFilled {
  readonly nonce: bigint; readonly buyer: string; readonly seller: string; readonly optionAddress: string;
  readonly premiumAmount: bigint; readonly feeCollected: bigint; readonly referrer: string; readonly referralFeePaid: bigint; readonly sellerWasMaker: boolean;
}

const uintString = z.string().regex(/^\d+$/);
export const fillEventSnapshotV1Schema = z.object({ version: z.literal(1), nonce: uintString, buyer: z.string(), seller: z.string(), optionAddress: z.string(), premiumAmount: uintString, feeCollected: uintString, referrer: z.string(), referralFeePaid: uintString, sellerWasMaker: z.boolean() }).strict();
export type FillEventSnapshotV1 = z.infer<typeof fillEventSnapshotV1Schema>;
export function encodeFillEventSnapshot(event: ParsedOrderFilled): FillEventSnapshotV1 {
  return fillEventSnapshotV1Schema.parse({ ...event, version: 1, nonce: event.nonce.toString(), premiumAmount: event.premiumAmount.toString(), feeCollected: event.feeCollected.toString(), referralFeePaid: event.referralFeePaid.toString() });
}
export function decodeFillEventSnapshot(snapshot: FillEventSnapshotV1): ParsedOrderFilled {
  const value = fillEventSnapshotV1Schema.parse(snapshot);
  return { nonce: BigInt(value.nonce), buyer: value.buyer, seller: value.seller, optionAddress: value.optionAddress, premiumAmount: BigInt(value.premiumAmount), feeCollected: BigInt(value.feeCollected), referrer: value.referrer, referralFeePaid: BigInt(value.referralFeePaid), sellerWasMaker: value.sellerWasMaker };
}
