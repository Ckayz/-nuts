/**
 * Which markets the Farcaster rail asks about.
 *
 * CLAUDE.md, an owner ruling: "Every market Thetanuts has liquidity for. Derive
 * assets, strikes, expiries live from OptionBook orders. **Never hardcode an
 * asset list.**" So the rail follows the book — BTC and ETH are today's answer,
 * not a constant.
 *
 * Pure, and separate from the book read, so the ranking is testable against a
 * literal fixture of a measured book.
 */

/** One row of `getAvailableAssets()` — only the two fields the ranking uses. */
export interface AssetDepth {
	readonly asset: string;
	readonly orders: number;
}

/**
 * A tradeable ticker, and the shape allowed to become a search term.
 *
 * The guard that matters: `packages/thetanuts/src/markets.ts:34` names an
 * unmapped price feed `UNKNOWN_FEED:0x…`, and `getAvailableAssets` only skips
 * rows whose asset is empty — that string passes. Without this it would be sent
 * to Neynar as a search query.
 */
const TICKER = /^[A-Z0-9]{2,6}$/;

/**
 * The deepest live markets, most-traded first.
 *
 * Ranked on ORDER count, which is what `getAvailableAssets()` already sorts by
 * (`lib/thetanuts/orders.ts`, `.sort((a, b) => b.orders - a.orders)`) and what
 * was MEASURED on 2026-09-05 across 362 live orders: BTC 147 (40.6%), ETH 123
 * (34.0%), BNB 33, SOL 30, AVAX 16, XRP 13 — BTC and ETH being 74.6% of the
 * book between them.
 *
 * Order count rather than `LiveAsset.structures.length`: `preferOrder()`
 * collapses several makers quoting the same structure into one structure, and
 * that duplication IS depth. Nor is depth weighted by `availableAmount`, which
 * is denominated in different collateral tokens and only valuable for the
 * USDC family — summing it across assets would add unlike units.
 *
 * Ties break alphabetically so two equally-deep assets cannot swap between
 * renders or between server instances; `getAvailableAssets`'s own sort has no
 * tie-break. Returns an empty list for an empty book and NEVER substitutes a
 * default: an empty list is a fact about the book, and the caller decides what
 * to ask when there is nothing to ask about.
 */
export function rankAssets(rows: readonly AssetDepth[], count: number): string[] {
	if (count <= 0) return [];
	return rows
		.filter((row) => row.orders > 0 && TICKER.test(row.asset))
		.slice()
		.sort((left, right) => {
			const depth = right.orders - left.orders;
			if (depth !== 0) return depth;
			return left.asset < right.asset ? -1 : left.asset > right.asset ? 1 : 0;
		})
		.slice(0, count)
		.map((row) => row.asset);
}
