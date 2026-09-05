import "server-only";

/**
 * The two live prices `/p/[id]` needs, and neither is allowed to fail the page.
 *
 * The spot price comes from the same OptionBook snapshot the market page reads.
 * If the feed is unreadable the position still renders — with its P&L reported
 * as unavailable and the reason said out loud — rather than 500ing, because the
 * fill, the wallet and the transaction hash are all still true without it.
 *
 * The collateral price comes from `lib/thetanuts/orders.ts`'s explicit
 * `COLLATERAL_USD_SOURCES` map, which prices the two USD-pegged tokens (a peg
 * assumption already tagged TODO-OWNER there) and refuses every wrapped major
 * because the SDK publishes no citable token -> underlying relation. This module
 * adds no source of its own: an unpriceable token yields null.
 */
import { usd8FromSpotNumber } from "./pnl";

export interface LivePrices {
	/** 8-decimal integer string, or null when no spot could be read for this asset. */
	readonly spotUsd8: string | null;
	/** 8-decimal integer string USD price of ONE collateral token, or null. */
	readonly collateralUsdPrice8: string | null;
	/** Set when the order feed could not be read at all; shown as the reason, never as "$0". */
	readonly feedError: string | null;
}

const NOTHING: LivePrices = { spotUsd8: null, collateralUsdPrice8: null, feedError: null };

export async function livePrices(
	asset: string | null,
	collateralSymbol: string | null,
): Promise<LivePrices> {
	if (asset === null && collateralSymbol === null) return NOTHING;
	try {
		const { collateralUsdPrice, getOrderSnapshot, isFeedUnavailable } = await import(
			"@/lib/thetanuts/orders"
		);
		const peg = collateralUsdPrice(collateralSymbol);
		// `collateralUsdPrice` returns USD per token as a plain number and only ever
		// returns the peg value 1 today; scaled here to the 8-decimal integer the
		// risk model takes.
		const collateralUsdPrice8 =
			peg === null ? null : (usd8FromSpotNumber(peg) ?? null);
		if (asset === null) return { spotUsd8: null, collateralUsdPrice8, feedError: null };

		const snapshot = await getOrderSnapshot();
		if (isFeedUnavailable(snapshot)) {
			return { spotUsd8: null, collateralUsdPrice8, feedError: snapshot.detail };
		}
		const price = snapshot.marketData[asset];
		return {
			spotUsd8: price === undefined ? null : usd8FromSpotNumber(price),
			collateralUsdPrice8,
			feedError: null,
		};
	} catch (error) {
		// A missing RPC URL, an unreachable feed, a broken adapter: all of them mean
		// "no live price", and none of them mean the position does not exist.
		return {
			...NOTHING,
			feedError: error instanceof Error ? error.message : "The Thetanuts order feed could not be read.",
		};
	}
}
