import { OPTION_BOOK_ABI } from "@thetanuts-finance/thetanuts-client";
import { parseEventLogs, type Address, type Hex, type Log } from "viem";

export interface ParsedOrderFilled { readonly nonce: bigint; readonly buyer: Address; readonly seller: Address; readonly optionAddress: Address; readonly premiumAmount: bigint; readonly feeCollected: bigint; readonly referrer: Address; readonly referralFeePaid: bigint; readonly sellerWasMaker: boolean }

export function parseOrderFilled(logs: readonly Log<bigint, number, false>[]): ParsedOrderFilled[] {
  const parsed = parseEventLogs({ abi: OPTION_BOOK_ABI, logs: logs.map((log) => ({ ...log, data: log.data as Hex })), eventName: "OrderFilled", strict: true });
  return parsed.map(({ args }) => ({ nonce: args.nonce, buyer: args.buyer, seller: args.seller, optionAddress: args.optionAddress, premiumAmount: args.premiumAmount, feeCollected: args.feeCollected, referrer: args.referrer, referralFeePaid: args.referralFeePaid, sellerWasMaker: args.sellerWasMaker }));
}
