/**
 * The shape `/p/[id]` reads, kept out of `./read.ts` so the pure view and P&L
 * modules can be imported (and unit-tested) without pulling `@nuts/db` and its
 * eager connection pool into the module graph.
 */
import type * as Domain from "@/types";
import type { PositionInstrument } from "./instrument";

/** Re-exported so `@/types` and the read layer can name it without importing the SDK-heavy `./instrument` module. */
export type { PositionInstrument };

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

/**
 * B1. The two live prices a card needs, for MANY positions at once.
 *
 * A page resolves this once (`lib/position/spot.ts` `livePriceBook`) from the
 * one cached order snapshot and hands it to every card and row builder, so the
 * feed, the thread, a profile, the portfolio and `/p/[id]` all print the same
 * figure for the same fill. Every lookup may answer `null`, which keeps the
 * existing "not available yet" sentence instead of inventing a price.
 */
export interface LivePriceBook {
	spotUsd8(asset: string | null | undefined): string | null;
	collateralUsdPrice8(symbol: string | null | undefined): string | null;
	/** Set when the order feed could not be read at all; never shown as "$0". */
	readonly feedError: string | null;
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
