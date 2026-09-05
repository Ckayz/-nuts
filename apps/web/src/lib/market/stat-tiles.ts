import { usd } from "@/lib/format";
import type { Market } from "@/lib/display-types";
import { impliedVolLabel } from "./implied-vol";

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
 * PRESENT INSTEAD, and better for an option book: IMPLIED VOL, from the makers'
 * own `greeks.iv` on the live orders (see `./implied-vol.ts` for why that field
 * and not `market_weather.curVol`, which is a different quantity). Where fomo
 * puts 24H volume, an options page wants the volatility being quoted.
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
	book: { readonly impliedVol?: number | null; readonly calls?: number | null; readonly puts?: number | null } = {},
): readonly MarketStatTile[] {
	const tiles: MarketStatTile[] = [{ label: "Spot", value: usd(market.spotUsd) }];
	// Omitted rather than zeroed when no maker quotes one: "0.0%" would read as
	// "this market has no volatility", which is a claim the book does not make.
	const iv = impliedVolLabel(book.impliedVol ?? null);
	if (iv !== null) tiles.push({ label: "Implied vol", value: iv });
	tiles.push({ label: "Structures", value: String(market.structureCount) });
	tiles.push({ label: "Expiries", value: String(market.expiryCount) });
	if (typeof book.calls === "number" && typeof book.puts === "number") {
		tiles.push({ label: "Calls / Puts", value: `${book.calls} / ${book.puts}` });
	}
	tiles.push({ label: "Theses", value: String(taggedPostCount) });
	return tiles;
}
