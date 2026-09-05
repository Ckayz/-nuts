/**
 * I-1 (owner 2026-09-06, decision 1). WHICH BUTTON FILLS WHICH SIDE OF THE BOOK.
 *
 * Owner's ratified default: **Bull means the ASSET goes up, everywhere** — the
 * post pill, the position row, the share card, the Open Graph image AND the
 * market ticket. Every position surface already reads that rule out of
 * `positionDirection()` / `marketDirection()` (`lib/position/lifecycle.ts`,
 * folded by H-1). The ticket did not: it labelled the TAKER side, so
 * `components/market/take-a-side.tsx:880` printed "Bull · buy" and
 * `lib/market/live.ts` wrote "Bull buys the BTC put 79,000 P" for a trade whose
 * own position page, title and OG card said "Bear" (userflow pass 3, MAJOR-1).
 *
 * Nothing about HOW a side is filled changes here. The chain-verified taker-side
 * rule stays exactly where it is: raw `isLong` is the MAKER's flag
 * (`lib/market/taker-side.ts`, `packages/thetanuts/src/side.ts`), `structure.buy`
 * and `structure.sell` are still the two measured taker sides, and every fence —
 * the 30-second window, the economics compare, the exact approval, the held fill
 * — is untouched. This module only decides which LABEL names which of those two
 * sides, and it derives that from the SAME `marketDirection` the position
 * surfaces use, so the two can never disagree again.
 *
 * The mapping is standard options semantics, and it is `marketDirection` read
 * backwards:
 *
 *   call   taker BUY   long upside        bull
 *   call   taker SELL  short upside       bear
 *   put    taker SELL  short downside     bull
 *   put    taker BUY   long downside      bear
 *
 * so on a PUT the Bull button SELLS and the Bear button BUYS — the exact
 * inversion this fold is for.
 *
 * ## What is NOT named Bull or Bear
 *
 * A direction word is only honest when the payoff is monotone in the spot
 * price. That is true of a single-strike call or put and of a vertical spread,
 * and it is false of a RANGER (pays inside a band), a butterfly and a condor
 * (pay at a pin). `CLASSIFIABLE` below is therefore the set of
 * `riskKindFor()`'s kinds (`lib/market/structures.ts`), which is exactly the
 * four monotone shapes the risk model covers; anything else — a RANGER, a fly,
 * a condor, an inverse or physical call, a binary, an implementation the SDK
 * does not name — returns `null`, and the ticket then shows the raw "Buy" /
 * "Sell" labels rather than a guessed direction. TODO-OWNER: whether a RANGER
 * or a binary should carry a direction word of its own is a product decision
 * and is NOT made here.
 *
 * The app already refuses to call a RANGER a call or a put — `display.strikeSide`
 * prints its strikes bare for the same reason — so this is the same rule, not a
 * new one.
 */
import type { RiskKind } from "@nuts/thetanuts";
import { marketDirection } from "@/lib/position/lifecycle";
import type { TakerSide, TicketSide } from "@/lib/trade/types";

/**
 * The risk kinds whose payoff is monotone in the spot price, so that one of
 * their two taker sides is bullish and the other is bearish.
 *
 * `riskKindFor()` can return exactly these four today. They are listed one by
 * one, not derived, so that a kind added later is NOT silently given a
 * direction word: a new entry has to be a deliberate decision.
 *
 *   call         buy = long upside, sell = short upside            monotone
 *   put          buy = long downside, sell = short downside        monotone
 *   call-spread   buy = long a capped upside                       monotone
 *   put-spread    buy = long a capped downside                     monotone
 */
export const CLASSIFIABLE: ReadonlySet<RiskKind> = new Set<RiskKind>(["call", "put", "call-spread", "put-spread"]);

/** The instrument facts a direction is read from. Both come off `LiveStructure`. */
export interface DirectionalStructure {
	readonly isCall: boolean;
	readonly riskKind: RiskKind | null;
}

/** True when this structure's two taker sides can honestly be called Bull and Bear. */
export function directionNameable(structure: DirectionalStructure): boolean {
	return structure.riskKind !== null && CLASSIFIABLE.has(structure.riskKind);
}

/**
 * The taker side whose RESULTING POSITION has market direction `side`, or null
 * when this structure carries no direction (see the note above).
 *
 * Defined as the inverse of `marketDirection`, never as a second table, so the
 * ticket and the position page cannot drift apart.
 */
export function takerForDirection(structure: DirectionalStructure, side: TicketSide): TakerSide | null {
	if (!directionNameable(structure)) return null;
	return marketDirection({ isCall: structure.isCall, takerSide: "buy" }) === side ? "buy" : "sell";
}

/**
 * The market direction of the position a taker side produces, or null when this
 * structure carries no direction.
 */
export function directionForTaker(structure: DirectionalStructure, taker: TakerSide): TicketSide | null {
	if (!directionNameable(structure)) return null;
	return marketDirection({ isCall: structure.isCall, takerSide: taker });
}

/** "Buy" / "Sell", the raw taker verb, capitalised for a label. */
export const TAKER_WORD: Readonly<Record<TakerSide, string>> = { buy: "Buy", sell: "Sell" };

/**
 * The ONE word a surface prints for one taker side of one structure: the
 * direction when there is one, the raw taker verb when there is not.
 *
 * TODO-OWNER: "Buy" / "Sell" as the fallback words, and whether an
 * unclassifiable structure should be offered at all.
 */
export function sideWord(structure: DirectionalStructure, taker: TakerSide): string {
	const direction = directionForTaker(structure, taker);
	if (direction === null) return TAKER_WORD[taker];
	return direction === "bull" ? "Bull" : "Bear";
}
