/**
 * Which side of an OptionBook order the TAKER is on, measured on chain.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MEASURED RULE (Base mainnet, 2026-09-05, 40 consecutive decoded production
 * fills of OptionBook 0x1bDff855d6811728acaDC00989e79143a2bdfDed, blocks
 * 50849607–50899584, every one a direct `fillOrder` call):
 *
 *     on-chain order.isLong === false  ->  OrderFilled.sellerWasMaker === true
 *                                      ->  the maker is the seller
 *                                      ->  the TAKER BUYS            (39 / 39)
 *
 *     on-chain order.isLong === true   ->  OrderFilled.sellerWasMaker === false
 *                                      ->  the maker is the buyer
 *                                      ->  the TAKER SELLS           (1 / 1)
 *
 * No fill contradicted it. The money flows agree, decoded independently in
 * `.research/thetanuts/finding-fill-debits.md`:
 *   tx 0x9c4bb1… (isLong false): taker sent 874999 + 124999 = 999998 USDC, the
 *     premium, and posted no collateral — a buy.
 *   tx 0xdf3323… (isLong true): taker sent 22000000 aBasUSDC to the OptionBook,
 *     strike x contracts, and RECEIVED 18610 — a sell.
 *
 * `rawApiData.isLong` is the same value: the SDK copies it verbatim from the
 * feed (`normalizeOdetteOrder`, dist/index.js:3386) and `buildContractOrder`
 * (dist/index.js:1608) puts it straight into the signed struct, so the field the
 * maker signed and the field the API publishes cannot differ.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * HISTORY: until core round 9 (2026-09-05 15:2x) `packages/thetanuts/src/side.ts`
 * returned the exact inverse, so every quote here was cross-checked against this
 * measured rule and REFUSED (`TAKER_SIDE_CONTRADICTION`). The package now
 * implements the same rule, pinned to the same transactions plus a 105-fill
 * scan. The cross-check stays as a permanent guard: if the two ever disagree
 * again, trading fails closed rather than building calldata on the wrong side.
 */
import { takerSide as packageTakerSide } from "@nuts/thetanuts";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";

export type TakerSide = "buy" | "sell";

export const TAKER_SIDE_CONTRADICTION = "TAKER_SIDE_CONTRADICTION";

/** The measured rule above. `isLong` is the MAKER's position, so the taker takes the other one. */
export function measuredTakerSide(isLong: boolean): TakerSide {
	return isLong ? "sell" : "buy";
}

export function takerSideOf(order: OrderWithSignature): TakerSide {
	const raw = order.rawApiData;
	if (!raw) throw new Error("Order is missing rawApiData");
	return measuredTakerSide(raw.isLong);
}

/**
 * Null when the shared package agrees with the chain, and an explanation when it
 * does not. A disagreement is never resolved in favour of either side here: it
 * blocks the trade, because building calldata on the wrong side would approve a
 * premium and then post collateral, or the reverse.
 */
export function takerSideDisagreement(order: OrderWithSignature): string | null {
	const raw = order.rawApiData;
	if (!raw) return "This order carries no book fields, so its taker side cannot be established.";
	const measured = measuredTakerSide(raw.isLong);
	let fromPackage: TakerSide;
	try {
		fromPackage = packageTakerSide(order);
	} catch (error) {
		return error instanceof Error ? error.message : "The shared trade package could not read this order's side.";
	}
	if (fromPackage === measured) return null;
	return (
		`Trading is blocked on this order: the shared trade package calls the taker side "${fromPackage}" while ` +
		`40 of 40 decoded Base fills say isLong=${raw.isLong} means the taker ${measured === "buy" ? "BUYS" : "SELLS"}. ` +
		"Filling on the wrong side would approve a premium and then post collateral, or the reverse. " +
		"Fix packages/thetanuts/src/side.ts before any fill."
	);
}
