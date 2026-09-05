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
 * C#9 (lane C confirming pass, finding 9). The `failure_reason` that means the
 * fill IS on chain.
 *
 * `lib/trade/record.ts` writes it when a transaction carries a matched
 * OptionBook fill for this wallet but does not expose the `fillOrder` call, so
 * the contract count cannot be proven (a batched smart-wallet execution, an
 * ERC-4337 UserOperation). The guard stays closed — nothing is recorded from
 * the browser's own figure — but the money DID move, and the reviewer measured
 * the page telling that holder "This transaction failed, so there is no
 * position." (`record.ts:266` -> `pnl.ts:268`).
 *
 * No new `position_status` value and no migration: the row already carries the
 * reason, and it is the reason that distinguishes the two outcomes.
 */
export const FILL_ON_CHAIN_UNPROVEN = "fill_quantity_unproven";

/** C#9. Is this `failed` row a REVERTED transaction, or a proof failure? */
export function failedButOnChain(status: PositionStatus, failureReason: string | null | undefined): boolean {
	return status === "failed" && failureReason === FILL_ON_CHAIN_UNPROVEN;
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
		// C#9. A quantity-unproven fill is NOT a reverted transaction: the money
		// left the wallet and the option exists. Saying otherwise is a false
		// statement about a real position.
		if (failedButOnChain(inputs.status, inputs.failureReason)) {
			return {
				pnlUsd: null,
				basis: "unavailable",
				// TODO-OWNER: wording.
				detail:
					"Your fill is on chain, but the contract count could not be proven from this transaction, so the position is not tracked yet.",
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
