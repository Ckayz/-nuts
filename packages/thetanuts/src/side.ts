import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { ThetanutsLogicError } from "./errors";

/** SDK normalizeOdetteOrder: raw isLong=true means maker sells, so taker buys. */
export function takerSide(order: OrderWithSignature): "buy" | "sell" {
  if (!order.rawApiData) throw new ThetanutsLogicError("INVALID_ORDER", "Order is missing rawApiData");
  return order.rawApiData.isLong ? "buy" : "sell";
}
