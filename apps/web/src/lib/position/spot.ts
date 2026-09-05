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
import type { LivePriceBook } from "./types";

export type { LivePriceBook };

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

/**
 * B1 (user-flow re-walk 2026-09-06). The SAME two prices, for every position a
 * PAGE renders rather than for one.
 *
 * Measured before the fix, on one server at one minute, for position
 * `69125d9b-38e3-4280-9119-61ee46fefff4`:
 *
 *   /p/<id>                     "−$1.00 (▼ −100.0% of max loss)"
 *   /u/<handle> positions row   "—  Live P&L · not available yet"
 *   /new?link=/p/<id> preview   "—  Live P&L · not available yet"
 *
 * The number was never missing; only `positionPageData` asked for it. Every
 * other builder was handed `spotUsd8: null`, and the card then said out loud
 * that the figure did not exist.
 *
 * This reads the SAME cached order snapshot `livePrices` reads, ONCE for the
 * whole page, and answers per asset from it — so a feed with twenty cards costs
 * exactly what one position page costs. `getOrderSnapshot()` caches internally
 * (`lib/thetanuts/orders.ts`), so the two calls a page may make coalesce there
 * too. An asset the feed does not price, or an unpriceable collateral token,
 * keeps its `null` and the existing "not available yet" sentence.
 */
export function emptyPriceBook(): LivePriceBook {
	return { spotUsd8: () => null, collateralUsdPrice8: () => null, feedError: null };
}

export async function livePriceBook(
	assets: Iterable<string | null | undefined>,
	collateralSymbols: Iterable<string | null | undefined>,
): Promise<LivePriceBook> {
	const wantedAssets = new Set([...assets].filter((value): value is string => !!value));
	const wantedCollateral = new Set([...collateralSymbols].filter((value): value is string => !!value));
	if (wantedAssets.size === 0 && wantedCollateral.size === 0) return emptyPriceBook();

	const spot = new Map<string, string | null>();
	const collateral = new Map<string, string | null>();
	let feedError: string | null = null;
	try {
		const { collateralUsdPrice, getOrderSnapshot, isFeedUnavailable } = await import(
			"@/lib/thetanuts/orders"
		);
		for (const symbol of wantedCollateral) {
			const peg = collateralUsdPrice(symbol);
			collateral.set(symbol, peg === null ? null : (usd8FromSpotNumber(peg) ?? null));
		}
		if (wantedAssets.size > 0) {
			const snapshot = await getOrderSnapshot();
			if (isFeedUnavailable(snapshot)) {
				feedError = snapshot.detail;
			} else {
				for (const asset of wantedAssets) {
					const price = snapshot.marketData[asset];
					spot.set(asset, price === undefined ? null : usd8FromSpotNumber(price));
				}
			}
		}
	} catch (error) {
		feedError = error instanceof Error ? error.message : "The Thetanuts order feed could not be read.";
	}

	return {
		spotUsd8: (asset) => (asset === null || asset === undefined ? null : spot.get(asset) ?? null),
		collateralUsdPrice8: (symbol) =>
			symbol === null || symbol === undefined ? null : collateral.get(symbol) ?? null,
		feedError,
	};
}
