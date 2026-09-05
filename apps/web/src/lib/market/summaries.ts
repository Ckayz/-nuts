import "server-only";
import { connection } from "next/server";
import { usingDatabase } from "../data/source";
import { rankAssets, type AssetDepth } from "../farcaster/assets";
import type { MarketSummary } from "../display-types";
import type { LiveBook } from "./live";
import type { FeedUnavailable } from "../thetanuts/types";

export interface MarketSummariesData {
	markets: MarketSummary[];
	unavailable: boolean;
	/**
	 * Owner decision 8 (2026-09-06): the market the nav's "Markets" item opens.
	 * Undefined only when there is no market to open at all.
	 */
	navMarketSlug?: string;
}

/**
 * Owner decision 8 (2026-09-06, default ratified): "Markets" opens the market
 * with the MOST OPEN ORDERS on the live book; ties break on the earlier ticker.
 *
 * TODO-OWNER: the RULE itself. The owner ratified this default over the four
 * other candidates fold-final-D listed (alphabetically first — which is what
 * shipped before and was an accident of `lib/market/live.ts`'s ticker sort —
 * deepest book, most traded, last visited, or a markets index route of its
 * own). Depth is ORDER COUNT, not `structures.length`: `preferOrder()` collapses
 * several makers quoting one structure into one row, and that duplication IS
 * depth (`lib/farcaster/assets.ts` `rankAssets`, whose measured book of
 * 2026-09-05 was BTC 147 · ETH 123 · BNB 33 · SOL 30 · AVAX 16 · XRP 13).
 *
 * `rankAssets` is reused rather than re-implemented so the app has ONE ranking
 * of book depth: the Farcaster rail and this nav item cannot disagree about
 * which market is the busiest.
 *
 * Pure, so the rule is asserted against a literal book with no network.
 * Falls back to the first summary when no depth row matches — an empty or
 * unreadable depth list must not make the nav item disappear.
 */
export function busiestMarketSlug(
	markets: readonly MarketSummary[],
	depths: readonly AssetDepth[],
): string | undefined {
	const busiest = rankAssets(depths, 1)[0];
	const match = busiest === undefined ? undefined : markets.find((row) => row.asset === busiest);
	return match?.slug ?? markets[0]?.slug;
}

/** Injected reads keep production-mode source selection testable without a network. */
export async function readMarketSummaries(
	databaseMode: boolean,
	live: () => Promise<LiveBook | FeedUnavailable>,
	fixtures: () => Promise<MarketSummary[]>,
	/**
	 * Per-asset OPEN ORDER counts, for the nav target above. Reads the SAME
	 * cached order snapshot `live()` reads (`getOrderSnapshot` caches inside
	 * `lib/thetanuts/orders.ts`), so it costs no extra network call. A reader
	 * that throws, or one that is not supplied, leaves the nav on the first
	 * summary rather than failing the layout.
	 */
	depths: () => Promise<readonly AssetDepth[]> = async () => [],
): Promise<MarketSummariesData> {
	if (!databaseMode) {
		const markets = await fixtures();
		return { markets, unavailable: false, navMarketSlug: markets[0]?.slug };
	}
	try {
		const book = await live();
		if ("error" in book) return { markets: [], unavailable: true, navMarketSlug: undefined };
		const { amount } = await import("../display");
		const markets = book.assets.map(asset => ({
			slug: asset.slug, asset: asset.asset, name: asset.asset,
			spotUsd: amount(asset.spotUsd?.toFixed(2) ?? null), changeLabel: "", changeClass: "",
		}));
		let depthRows: readonly AssetDepth[] = [];
		try {
			depthRows = await depths();
		} catch {
			// The nav target degrades to the first summary; the markets list, which
			// is what this function is for, is already read and stays true.
			depthRows = [];
		}
		return { markets, unavailable: false, navMarketSlug: busiestMarketSlug(markets, depthRows) };
	} catch {
		return { markets: [], unavailable: true, navMarketSlug: undefined };
	}
}

export async function marketSummariesData(): Promise<MarketSummariesData> {
	const databaseMode = usingDatabase();
	if (databaseMode) await connection();
	return readMarketSummaries(databaseMode,
		async () => (await import("@/lib/market/live")).getLiveMarkets(),
		async () => (await import("../view-data")).marketSummaries,
		async () => {
			const { getAvailableAssets, isFeedUnavailable } = await import("@/lib/thetanuts/orders");
			const rows = await getAvailableAssets();
			return isFeedUnavailable(rows) ? [] : rows;
		});
}


/**
 * Book statistics for one asset's stat tiles and its About panel: the makers'
 * median implied vol, how the live orders split between calls and puts, and how
 * they split between the two sides a taker can take.
 *
 * `buys` / `sells` are TAKER sides, which is what `TradeableOrder.side` carries
 * (`lib/thetanuts/orders.ts` sets it from `takerSide(order)`, and CLAUDE.md
 * records that raw `isLong` is the MAKER's flag): `buy` is an order this app's
 * visitor could take by paying a premium, `sell` one they could take by posting
 * collateral. They are ORDERS RESTING ON THE BOOK, never trades — the OptionBook
 * publishes no trade history, so a "234 buys / 23 sells" in fomo's sense does not
 * exist here and is not invented.
 *
 * Reads the SAME cached order snapshot the rest of the page already reads, so
 * this costs no extra network call. Returns an empty object in mock mode and
 * whenever the book cannot be read — the tiles and bars then simply do not
 * appear, which is the honest rendering of "we do not know", never a zero.
 */
export interface MarketBookStats {
	impliedVol?: number | null;
	calls?: number | null;
	puts?: number | null;
	/** Live orders whose TAKER side is a buy (pay premium). */
	buys?: number | null;
	/** Live orders whose TAKER side is a sell (post collateral). */
	sells?: number | null;
}

export async function marketBookStats(asset: string): Promise<MarketBookStats> {
	if (!usingDatabase()) return {};
	try {
		const { getOrderSnapshot, isFeedUnavailable } = await import("@/lib/thetanuts/orders");
		const snapshot = await getOrderSnapshot();
		if (isFeedUnavailable(snapshot)) return {};
		const wanted = asset.trim().toUpperCase();
		const orders = snapshot.orders.filter((order) => order.asset?.toUpperCase() === wanted);
		if (orders.length === 0) return {};
		const { medianImpliedVol } = await import("./implied-vol");
		let calls = 0;
		let puts = 0;
		let buys = 0;
		let sells = 0;
		for (const order of orders) {
			if (order.isCall) calls += 1;
			else puts += 1;
			if (order.side === "buy") buys += 1;
			else sells += 1;
		}
		// `sdkOrder` is where the SDK parks `rawApiData.greeks`; the reader checks
		// every documented position and returns null when none carries an iv.
		//
		// D-R3-3: `orders` here is EVERY live order for this asset — every strike
		// and every expiry — and the statistic is an unweighted median. Both the
		// cohort and the statistic are TODO-OWNER; see `medianImpliedVol`'s own
		// comment in `./implied-vol.ts`. Neither is changed here.
		return { impliedVol: medianImpliedVol(orders), calls, puts, buys, sells };
	} catch {
		return {};
	}
}
