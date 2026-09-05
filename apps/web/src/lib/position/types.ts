/**
 * The shape `/p/[id]` reads, kept out of `./read.ts` so the pure view and P&L
 * modules can be imported (and unit-tested) without pulling `@nuts/db` and its
 * eager connection pool into the module graph.
 */
import type * as Domain from "@/types";
import type { PositionInstrument } from "./instrument";

/** Raw fill amounts, each beside the decimals column that gives it its unit. */
export interface PositionQuantities {
	/** Option contract base units. */
	readonly contracts: string;
	readonly contractDecimals: number;
	/** Collateral-token base units. */
	readonly premium: string;
	readonly premiumDecimals: number;
	readonly fees: string;
	readonly feeDecimals: number;
	readonly collateral: string;
	readonly collateralDecimals: number;
}

export interface PositionPageDetail {
	readonly position: Domain.Position;
	readonly owner: Domain.Creator;
	/** Null when the stored order snapshot does not describe the instrument. */
	readonly instrument: PositionInstrument | null;
	/**
	 * Null when the source records no raw amounts — the typed fixtures do not, and
	 * without them no payoff can be recomputed, so the card falls back to whatever
	 * P&L the row itself recorded.
	 */
	readonly quantities: PositionQuantities | null;
	/** The post this position backs; null for a standalone fill (migration 0007). */
	readonly thesis: { readonly slug: string; readonly headline: string } | null;
}
