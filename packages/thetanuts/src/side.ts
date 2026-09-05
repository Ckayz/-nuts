import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { ThetanutsLogicError } from "./errors";

/**
 * Which side of an OptionBook order the TAKER (the wallet that calls `fillOrder`) is on.
 *
 * `rawApiData.isLong` is the MAKER's long flag, so the taker takes the OTHER side:
 *
 *     isLong === false  ->  maker is the seller  ->  the taker BUYS  (pays premium)
 *     isLong === true   ->  maker is the buyer   ->  the taker SELLS (posts collateral)
 *
 * MEASURED FROM CHAIN BYTES on Base mainnet 2026-09-05, not taken from the SDK. Two
 * production fills of OptionBook 0x1bDff855d6811728acaDC00989e79143a2bdfDed, each decoded
 * from its own `fillOrder` calldata, its `OrderFilled` event and its ERC-20 transfers:
 *
 *   tx 0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c (block 50884962)
 *     calldata order.isLong = false; OrderFilled.sellerWasMaker = true;
 *     OrderFilled.buyer === tx.from (0xB792296bE8202ba2fc5D3276fA184e5B479920E3);
 *     that wallet PAID 874999 + 124999 = 999998 USDC (the premium) and posted no
 *     collateral, while the MAKER posted 912426840 USDC.  -> taker BUYS.
 *
 *   tx 0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3 (block 50891956)
 *     calldata order.isLong = true; OrderFilled.sellerWasMaker = false;
 *     OrderFilled.seller === tx.from (0x37E04839dB16A445b2646Abf85C49b0e055d368e);
 *     that wallet PAID 22000000 aBasUSDC (strike x contracts) to the OptionBook and
 *     RECEIVED 18610 (premium - fee).  -> taker SELLS.
 *
 * Scan of every `OrderFilled` in blocks 50823786..50897786: 105 direct `fillOrder`
 * transactions decoded, 104 with isLong=false (sellerWasMaker=true, tx.from === buyer) and
 * 1 with isLong=true (sellerWasMaker=false, tx.from === seller). Zero contradicted the rule
 * `isLong === !sellerWasMaker`. A wider event-only sweep of blocks 50700595..50900594 found
 * 234 `OrderFilled` events of which exactly one had sellerWasMaker=false — the tx above — so
 * the SELL direction rests on that single decoded fill, which is nonetheless decisive: the
 * money moved the opposite way from every buy fill.
 *
 * DO NOT use the SDK for this decision. SDK 0.3.0 `normalizeOdetteOrder`
 * (dist/index.js:3343, 3360-3361) sets `isBuyer: !rawOrder["isLong"]` and comments
 * "isLong=true means maker sells, so taker buys" — both are the INVERSE of what the chain
 * does, and `client.utils.isLong` (dist/index.js:11521) just reads that wrong `isBuyer`.
 * Only `rawApiData.isLong` with the mapping above is trustworthy.
 */
export function takerSide(order: OrderWithSignature): "buy" | "sell" {
  if (!order.rawApiData) throw new ThetanutsLogicError("INVALID_ORDER", "Order is missing rawApiData");
  return order.rawApiData.isLong ? "sell" : "buy";
}
