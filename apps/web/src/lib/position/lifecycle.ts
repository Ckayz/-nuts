/**
 * The lifecycle and the P&L RULES, with no risk model attached.
 *
 * Split out of `pnl.ts` because `display.ts` needs `lifecycleStatus`,
 * `resolvePnl` and `failedButOnChain` (D5 and C#9) and is imported by CLIENT
 * components — `pnl.ts` imports `@nuts/thetanuts`, whose bundle reaches for
 * `fs/promises`, so the shared import turned a passing test suite into a broken
 * production build:
 *   Module not found: Can't resolve 'fs/promises'
 *     … @thetanuts-finance/thetanuts-client/dist/index.mjs
 *     … apps/web/src/lib/position/pnl.ts [Client Component SSR]
 *     … apps/web/src/lib/display.ts [Client Component SSR]
 *     … apps/web/src/components/position/pnl-card.tsx [Client Component SSR]
 * Measured on a db-mode `next build`, which is the only check that sees it.
 *
 * So the risk model stays in `pnl.ts` (server only) and the DERIVED figure is
 * passed in: `resolvePnl` decides what a number is allowed to SAY, and never
 * computes one from the model itself. `pnl.ts` re-exports everything here, so
 * every existing import keeps working.
 *
 * The rules come from the PRD, not from taste:
 *  - PRD 14: "Never label an estimate as settled P&L." A settled row shows only
 *    the recorded final P&L; the estimate is never promoted into its place.
 *  - PRD 13 / 8.5.3: "Expired but unsettled: show settlement pending; do not
 *    invent final P&L."
 *  - PRD 13: "Confirmed but not indexed: show syncing."
 *  - PRD 13: "Missing AI context: explicitly identify unavailable values." Every
 *    `unavailable` carries the reason it is unavailable.
 *
 * TODO-OWNER: the wording of `detail` on each branch is descriptive, not
 * approved product copy. The mockup has no standalone position page, so it
 * specifies none.
 */
import type { PositionStatus } from "@/types";
import { decimalFromBaseUnits } from "@/lib/data/decimal";

/** USD prices and payoffs are carried at 8 decimals, the scale `risk.ts` uses (`PRICE_SCALE`). */
export const USD_DECIMALS = 8;

export type PnlBasis = "settled" | "estimate" | "derived" | "unavailable";

/**
 * C#9, widened by C-R4 (lane C confirming pass, confirming round). The
 * `failure_reason` values that mean the fill IS on chain.
 *
 * `positions.status = 'failed'` covers two different worlds, and the row's
 * reason is the only thing that separates them.
 *
 * `lib/trade/record.ts` writes every reason below AFTER a SUCCESSFUL receipt
 * and, for the first three, after `matchFillEvent` has already bound the
 * OptionBook, the maker, the nonce and this wallet as the taker
 * (`record.ts:266`, `:274`, `:288`). The money left the wallet in all three;
 * what failed is OUR ability to reproduce the trade's economics, so the guard
 * stays closed and nothing is recorded. Round 2 mapped only the quantity case,
 * and the reviewer measured the other two telling the holder of a real position
 * "This transaction failed, so there is no position.":
 *
 *   fill_quantity_unproven             -> Your fill is on chain, …
 *   filled_order_differs_from_prepared -> This transaction failed, …
 *   debit_differs_from_prepared        -> This transaction failed, …
 *
 * NOT in the set, and why:
 *  - `transaction_reverted` (`record.ts:234`) — the receipt itself is a revert.
 *  - `no_matching_order_filled` (`record.ts:243`) — the receipt succeeded but
 *    carries no OptionBook fill of the prepared order for THIS wallet, so
 *    nothing proves this holder's money moved.
 *  - `superseded_by_onchain_taker` (`record.ts:590`) — this row belongs to a
 *    wallet that merely CLAIMED the hash and was then proven, by the same
 *    `matchFillEvent` binding, not to be its taker. Only one address can be the
 *    taker of a fill, so the superseded holder's own money did not move here.
 *    TODO-OWNER: that row still reads "This transaction failed", which is not
 *    what happened to it either; a third sentence for "someone else's fill" is
 *    a product decision and is NOT made here.
 *
 * No new `position_status` value and no migration: the row already carries the
 * reason, and it is the reason that distinguishes the outcomes.
 */
export const FILL_ON_CHAIN_UNPROVEN = "fill_quantity_unproven";

/**
 * C-R4. Every refusal `record.ts` writes AFTER proving this wallet is the taker
 * of a successful fill. Frozen as a set so `resolvePnl`, `positionStatusDisplay`
 * and every card, row, OG image and portfolio list read the SAME rule.
 */
export const ON_CHAIN_REFUSAL_REASONS = [
	FILL_ON_CHAIN_UNPROVEN,
	"filled_order_differs_from_prepared",
	"debit_differs_from_prepared",
] as const;

export type OnChainRefusalReason = (typeof ON_CHAIN_REFUSAL_REASONS)[number];

/** C#9 / C-R4. Is this `failed` row a REVERTED transaction, or a refusal over a fill that IS on chain? */
export function failedButOnChain(status: PositionStatus, failureReason: string | null | undefined): boolean {
	if (status !== "failed") return false;
	if (typeof failureReason !== "string") return false;
	return (ON_CHAIN_REFUSAL_REASONS as readonly string[]).includes(failureReason);
}

/**
 * C-R4. The one honest sentence for each on-chain refusal.
 *
 * Same family, different cause. TODO-OWNER: both sentences. The first is the
 * one round 2 shipped; the second is provisional and covers the two refusals
 * where the fill is on chain but its economics could not be reproduced from it.
 */
export function onChainRefusalDetail(failureReason: string): string {
	if (failureReason === FILL_ON_CHAIN_UNPROVEN) {
		return "Your fill is on chain, but the contract count could not be proven from this transaction, so the position is not tracked yet.";
	}
	return "Your fill is on chain, but it does not match the trade that was prepared, so the position is not tracked yet.";
}

export interface PnlInputs {
	readonly status: PositionStatus;
	/** C#9. `positions.failure_reason`; only read when `status` is `failed`. */
	readonly failureReason?: string | null;
	readonly finalPnlUsd: string | null;
	readonly estimatedPnlUsd: string | null;
	readonly settlementPriceUsd: string | null;
	/**
	 * Whether a derivation was POSSIBLE at all. False means this position's
	 * structure cannot be modelled and `unavailableReason` says why; true means
	 * it could be, and `derivedPnlUsd` carries the result (or null when the model
	 * itself declined).
	 */
	readonly derivable: boolean;
	/**
	 * The intrinsic value at `spotUsd8`, already computed by the caller with
	 * `derivePnlAtSpot`. Null or absent when there is none.
	 */
	readonly derivedPnlUsd?: string | null;
	/** Current spot as an 8-decimal integer string, or null when the book is unreadable. */
	readonly spotUsd8: string | null;
	/** Why no derivation is possible. Shown verbatim when nothing else supplies a number. */
	readonly unavailableReason: string;
	/**
	 * C7. When this option expires, ISO 8601, or null when it cannot be read.
	 *
	 * There is no expiry or settlement reconciliation yet (`markIndexed` is
	 * referenced in `trade/record.ts` but does not exist), so a position stays
	 * `confirmed` for ever after its option expires. Without these two fields the
	 * derivation below kept valuing an EXPIRED option at TODAY's spot, which is a
	 * number that cannot happen: the option is finished and its payoff was fixed
	 * at the settlement price, not at today's.
	 */
	readonly expiryAt: string | null;
	/** The instant this page is rendered for, ISO 8601. */
	readonly asOf: string;
}


/**
 * C7-r2 (lane C confirming pass, finding 10). The status the CARD may show.
 *
 * There is no expiry or settlement reconciliation yet (`markIndexed` is
 * referenced in `trade/record.ts` but does not exist), so a row stays
 * `confirmed`/`indexed` for ever after its option expires. `resolvePnl` already
 * refuses to value such a position, but the card kept printing that stored
 * status — "Open · syncing" beside "not available yet", which reads as a live
 * position whose number is merely late.
 *
 * The vocabulary is not new: `POSITION_STATUS_DISPLAY.expired` already says
 * "Settlement pending", and the detailed page already explains it. This only
 * routes a past-expiry row to the word the app already has for it.
 *
 * `pending` and `failed` are never rewritten — a fill that never confirmed is
 * not a settlement — and `settled` is already terminal.
 */
export function lifecycleStatus(status: PositionStatus, expiryAt: string | null, asOf: string): PositionStatus {
	if (status !== "confirmed" && status !== "indexed") return status;
	return isPastExpiry(expiryAt, asOf) ? "expired" : status;
}

/**
 * Which way a position is betting: the market direction, not whose side of a
 * thesis it is.
 *
 * These are two different facts and conflating them was a real defect. A
 * `PositionSide` is "back" or "counter" — did you back the author's thesis, or
 * take the other side of it. That says nothing about the market: BACKING a BEAR
 * thesis is a bear position. `lib/display.ts` printed `side === "back"` as
 * "Bull", so every position card read Bull, bear positions included.
 *
 * The market direction is a property of the OPTION, and it is standard options
 * semantics:
 *
 *   buy a call   long upside          bull
 *   sell a put   short downside       bull   (you are paid to accept the strike)
 *   buy a put    long downside        bear
 *   sell a call  short upside         bear
 *
 * `takerSide` is already the MEASURED taker side from `measuredTakerSide()`,
 * which is derived from the maker's `isLong` flag against chain bytes — see
 * `lib/market/taker-side.ts`. This function only reads it; it does not re-derive
 * the side, so the chain-verified rule stays in one place.
 */
export function marketDirection(option: { readonly isCall: boolean; readonly takerSide: "buy" | "sell" }): "bull" | "bear" {
	const longTheOption = option.takerSide === "buy";
	// buy call / sell put are bullish; buy put / sell call are bearish.
	return option.isCall === longTheOption ? "bull" : "bear";
}

/**
 * D-R3-1 / C-1 (pass 3, Astra lanes C and D). THE displayed-direction rule, for
 * every surface that shows a direction: list rows, the share card, the post-fill
 * card, the OG images and `/p/<id>`.
 *
 * Measured before this existed: `lib/display.ts` mapped `side === "back"` to
 * "bull" while `lib/position/view.ts` called `marketDirection(instrument)`, and
 * the SAME position (`isCall: false`, `takerSide: "buy"` — a bought put)
 * rendered `{"rowSide":"bull","cardSideLabel":"Bear"}`. `lib/trade/record.ts`
 * passed `ticket.side` instead, so the post-fill card repeated the ticket's own
 * Bull/Bear button rather than the option that was actually filled.
 *
 * Null — not a guess — when no instrument could be decoded: a direction that
 * cannot be read is printed as nothing, which is what `PnlCardInput.direction`
 * has always done.
 */
export function positionDirection(
	instrument: { readonly isCall: boolean; readonly takerSide: "buy" | "sell" } | null | undefined,
): "bull" | "bear" | null {
	return instrument === null || instrument === undefined ? null : marketDirection(instrument);
}

/** C7. True once the option's expiry has passed. Unreadable dates count as NOT expired: a false "settlement pending" would be its own wrong claim. */
export function isPastExpiry(expiryAt: string | null, asOf: string): boolean {
	if (expiryAt === null) return false;
	const expiry = Date.parse(expiryAt);
	const now = Date.parse(asOf);
	if (Number.isNaN(expiry) || Number.isNaN(now)) return false;
	return expiry <= now;
}

export interface PnlResolution {
	/** Decimal USD string, or null when no honest number exists. */
	readonly pnlUsd: string | null;
	readonly basis: PnlBasis;
	/** One factual sentence naming exactly where the number above came from. */
	readonly detail: string;
}


/** A plain decimal, or null. Guards every recorded column before it is printed as money. */
function decimalOrNull(value: string | null): string | null {
	if (value === null) return null;
	return /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? value.trim() : null;
}

export function resolvePnl(inputs: PnlInputs): PnlResolution {
	const final = decimalOrNull(inputs.finalPnlUsd);
	const estimate = decimalOrNull(inputs.estimatedPnlUsd);
	const settlementPrice = decimalOrNull(inputs.settlementPriceUsd);

	if (inputs.status === "failed") {
		// C#9 / C-R4. A refusal written after a proven fill is NOT a reverted
		// transaction: the money left the wallet and the option exists. Saying
		// otherwise is a false statement about a real position.
		if (failedButOnChain(inputs.status, inputs.failureReason)) {
			return {
				pnlUsd: null,
				basis: "unavailable",
				// TODO-OWNER: wording, in `onChainRefusalDetail`.
				detail: onChainRefusalDetail(inputs.failureReason as string),
			};
		}
		return { pnlUsd: null, basis: "unavailable", detail: "This transaction failed, so there is no position." };
	}
	if (inputs.status === "pending") {
		return { pnlUsd: null, basis: "unavailable", detail: "This fill has not been confirmed on Base yet." };
	}

	// A finished option reports its recorded result or nothing at all. Falling
	// through to the estimate here is exactly what PRD 14 forbids.
	if (inputs.status === "settled" || inputs.status === "expired") {
		if (final !== null) {
			return {
				pnlUsd: final,
				basis: "settled",
				detail:
					settlementPrice === null
						? "Final P&L recorded at settlement."
						: `Final P&L recorded at settlement, settled at $${settlementPrice}.`,
			};
		}
		return {
			pnlUsd: null,
			basis: "unavailable",
			detail: "Settlement pending: Thetanuts has not published this option's settlement yet.",
		};
	}

	// C7. Past expiry but not settled: the option is FINISHED. Its result is
	// whatever Thetanuts settles it at, which nothing here knows yet, so no
	// estimate and no spot derivation may be shown — both would assert a live
	// position that no longer exists. A recorded final P&L is handled above.
	if (isPastExpiry(inputs.expiryAt, inputs.asOf)) {
		return {
			pnlUsd: null,
			basis: "unavailable",
			detail:
				"Settlement pending: this option has expired and Thetanuts has not published its settlement yet, so there is no final figure and no live estimate.",
		};
	}

	if (estimate !== null) {
		return {
			pnlUsd: estimate,
			basis: "estimate",
			detail:
				inputs.status === "confirmed"
					? "Estimated P&L recorded with the fill; the indexer has not synced this position yet."
					: "Estimated P&L recorded with the fill.",
		};
	}

	// The DERIVED figure is computed by the caller (`lib/position/view.ts`, which
	// owns the risk model) and handed in, so this module stays free of
	// `@nuts/thetanuts` and therefore safe in a client bundle.
	if (inputs.derivedPnlUsd !== null && inputs.derivedPnlUsd !== undefined && inputs.spotUsd8 !== null) {
		const derived = decimalOrNull(inputs.derivedPnlUsd);
		if (derived !== null) {
			const spot = decimalFromBaseUnits(inputs.spotUsd8, USD_DECIMALS);
			return {
				pnlUsd: derived,
				basis: "derived",
				// Says exactly what the number is: intrinsic value at today's spot,
				// with no time value in it.
				detail: `Estimate: what this position would pay if it settled at the current spot of $${spot}. It is not a mark-to-market value and carries no time value.`,
			};
		}
	}

	return {
		pnlUsd: null,
		basis: "unavailable",
		detail:
			inputs.derivable === false
				? inputs.unavailableReason
				: inputs.spotUsd8 === null
					? "No P&L: the Thetanuts price feed could not be read, so there is no spot price to value this position at."
					: inputs.unavailableReason,
	};
}
