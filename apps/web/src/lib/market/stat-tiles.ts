import { usd } from "@/lib/format";
import type { Market } from "@/lib/display-types";

/**
 * The market header's stat tiles.
 *
 * fomo's token page runs a row of bordered tiles under the instrument name —
 * `Price · Market cap · 24H change · Vol. · Liquidity · Holders`, muted label
 * above, value below (docs/design/FOMO-DIGEST.md, "Token page layout"). Ours is
 * an option book, not a token, so the row is built only from values the page
 * ALREADY holds. Nothing here fetches, and nothing here derives a figure from
 * data the API does not publish.
 *
 * DELIBERATELY ABSENT, each for a measured reason:
 *
 *   24H change  `MarketSummary.changeLabel` is the empty string in database
 *               mode (`lib/market/live.ts` `summaryOf`, and `summaries.ts`
 *               asserts it): Thetanuts publishes a spot price and no history.
 *               That is the same fact that removed the price chart.
 *   Liquidity   `Ticket.liquidityLeftUsd` and every `structures[].liquidityLeftUsd`
 *               describe ONE structure — the freshest maker order's
 *               `availableAmount`. Summing them into a market number would be an
 *               invented aggregate, and printing one of them under the label
 *               "Liquidity" here would read as market-wide.
 *   Market cap / Vol. / Holders
 *               fomo has a token with a supply and a trade history. The
 *               OptionBook publishes none of the three, so there is nothing to
 *               put in the tile.
 *
 * Kept pure so the row can be asserted without rendering the page.
 */
export interface MarketStatTile {
	/** The muted label above, e.g. "Structures". */
	label: string;
	/** The value below, already formatted. */
	value: string;
}

export function marketStatTiles(
	market: Pick<Market, "spotUsd" | "structureCount" | "expiryCount">,
	taggedPostCount: number,
): readonly MarketStatTile[] {
	return [
		{ label: "Spot", value: usd(market.spotUsd) },
		{ label: "Structures", value: String(market.structureCount) },
		{ label: "Expiries", value: String(market.expiryCount) },
		{ label: "Tagged posts", value: String(taggedPostCount) },
	];
}
