import type { TradeableOrder } from "./types";

/**
 * A stable identity for the *instrument*, not the order.
 *
 * Maker signatures rotate roughly every 60 seconds, so no order-level id
 * survives long enough to be worth returning to the model. The underlying
 * instrument does persist across re-signing: the same asset, direction, strikes
 * and expiry are quoted again at a slightly different price.
 *
 * So the agent reasons about instruments, and execution re-fetches the book and
 * matches on this key immediately before building calldata (PRD 14).
 */
export function instrumentKey(order: TradeableOrder): string {
	const o = order.entry.order;
	return [
		order.asset ?? "?",
		o.isCall ? "C" : "P",
		o.strikes.join("/"),
		o.expiry,
		o.implementation.toLowerCase(),
	].join("|");
}

export function findByInstrumentKey(
	orders: TradeableOrder[],
	key: string,
): TradeableOrder | undefined {
	return orders.find((o) => instrumentKey(o) === key);
}
