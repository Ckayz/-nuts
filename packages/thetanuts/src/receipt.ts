import { OPTION_BOOK_ABI } from "@thetanuts-finance/thetanuts-client";
import { parseEventLogs, type Address, type Hex, type Log } from "viem";
import { ThetanutsLogicError } from "./errors";

export interface ParsedOrderFilled { readonly nonce: bigint; readonly buyer: Address; readonly seller: Address; readonly optionAddress: Address; readonly premiumAmount: bigint; readonly feeCollected: bigint; readonly referrer: Address; readonly referralFeePaid: bigint; readonly sellerWasMaker: boolean }
export interface ParseOrderFilledParams { readonly optionBook: Address }
export interface ExpectOrderFilledParams extends ParseOrderFilledParams { readonly buyer?: Address; readonly seller?: Address; readonly nonce?: bigint }

export function parseOrderFilled(logs: readonly Log<bigint, number, false>[], { optionBook }: ParseOrderFilledParams): ParsedOrderFilled[] {
  const expectedEmitter = optionBook.toLowerCase();
  const parsed = parseEventLogs({ abi: OPTION_BOOK_ABI, logs: logs.filter((log) => log.address.toLowerCase() === expectedEmitter).map((log) => ({ ...log, data: log.data as Hex })), eventName: "OrderFilled", strict: true });
  return parsed.map(({ args }) => ({ nonce: args.nonce, buyer: args.buyer, seller: args.seller, optionAddress: args.optionAddress, premiumAmount: args.premiumAmount, feeCollected: args.feeCollected, referrer: args.referrer, referralFeePaid: args.referralFeePaid, sellerWasMaker: args.sellerWasMaker }));
}

export function expectOrderFilled(logs: readonly Log<bigint, number, false>[], { optionBook, buyer, seller, nonce }: ExpectOrderFilledParams): ParsedOrderFilled {
  const events = parseOrderFilled(logs, { optionBook }).filter((event) =>
    (buyer === undefined || event.buyer.toLowerCase() === buyer.toLowerCase()) &&
    (seller === undefined || event.seller.toLowerCase() === seller.toLowerCase()) &&
    (nonce === undefined || event.nonce === nonce));
  if (events.length !== 1) throw new ThetanutsLogicError("ORDER_FILLED_NOT_FOUND", "Expected exactly one OrderFilled event", { count: events.length });
  const event = events[0];
  if (!event) throw new ThetanutsLogicError("ORDER_FILLED_NOT_FOUND", "Expected exactly one OrderFilled event", { count: 0 });
  return event;
}
