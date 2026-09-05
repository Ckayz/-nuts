import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { getThesisContext as loadThesisContext } from "@/lib/thesis-context";

import { instrumentKey, findByInstrumentKey } from "@/lib/thetanuts/instrument";
import {
	COLLATERAL_USD_UNAVAILABLE,
	CONTRACT_UNITS_UNVERIFIED,
	collateralUsdPrice,
	getAvailableAssets,
	getOrderSnapshot,
	isFeedUnavailable,
	searchOrders,
	sizeFill,
	usdRisk,
} from "@/lib/thetanuts/orders";
import type { TradeableOrder } from "@/lib/thetanuts/types";

/**
 * Read-only agent tools (PRD 10.5).
 *
 * These run without approval because they cannot move funds or change state.
 * The approval-gated write tools are separate and land in step 5.
 *
 * Three rules every tool here follows:
 *
 * 1. **Decimal strings, never floats.** Money and quantities cross into model
 *    context as strings, matching the ThesisAiContext contract (PRD 10.3).
 * 2. **Bounded output.** The book is ~200 orders; returning all of them would
 *    burn context and bury the answer. Results are capped and summarised.
 * 3. **Say when a value is unknown.** A missing number is reported as missing,
 *    never estimated (PRD 10.1).
 */

/** Ceiling on agent-prepared trades (PRD 10.2). */
const MAX_LOSS_USD = 10;

function describe(order: TradeableOrder) {
	return {
		instrumentKey: instrumentKey(order),
		label: order.label,
		side: order.side,
		implementation: order.implementation,
		collateralToken: order.collateralToken,
		asset: order.asset,
		kind: order.kind,
		direction: order.isCall ? "call" : "put",
		strikesUsd: order.strikesUsd,
		expiryAt: order.expiryAt,
        orderExpiresAt: order.orderExpiresAt,
        secondsUntilOrderExpiry: Math.max(0, Math.floor((Date.parse(order.orderExpiresAt) - Date.now()) / 1000)),
		// null whenever the SDK's contract-size unit for this order is unproven: the maker
		// price is scaled per contract-size unit, so it is not a token-per-contract amount.
		premiumPerContract: {
			amount: order.pricePerContractUsd,
			token: order.collateralToken.symbol,
			decimals: order.collateralToken.decimals,
			unit: "token per contract",
			contractSizeDecimals: order.contractSizeDecimals,
			unavailable: order.pricePerContractUsd === null ? CONTRACT_UNITS_UNVERIFIED : undefined,
		},
		makerCollateralBudget: { amount: order.makerBudgetUsd, token: order.collateralToken.symbol, decimals: order.collateralToken.decimals },
	};
}

export const searchOptionBookOrders = tool({
	description:
		"Search live Thetanuts OptionBook liquidity on Base mainnet. Returns buy and sell orders, labelled by taker side and collateral token. " +
		"Use this before discussing any specific trade: never describe an option that is not in these results. " +
		"Binary filtering is unavailable because SDK 0.3.0 exposes no binary discriminator. Product kinds: " +
		"'vanilla' is a single call or put; 'multi_leg' is a spread or butterfly.",
	inputSchema: z.object({
		side: z.enum(["buy", "sell"]).optional().describe("Taker side: buy pays premium; sell locks collateral and receives premium minus fee."),
		asset: z
			.string()
			.optional()
			.describe("Underlying symbol such as ETH, BTC, SOL, BNB, AVAX, XRP. Omit for all."),
		direction: z
			.enum(["call", "put"])
			.optional()
			.describe("Call or put structure; payoff also depends on taker side and implementation. Omit for both."),
		kind: z
			.enum(["vanilla", "multi_leg"])
			.optional()
			.describe("Filter by product shape. Binary filtering is unavailable."),
		maxDaysToExpiry: z
			.number()
			.int()
			.positive()
			.max(400)
			.optional()
			.describe("Only instruments expiring within this many days."),
		limit: z.number().int().min(1).max(12).default(6),
	}),
	execute: async ({ asset, side, direction, kind, maxDaysToExpiry, limit }) => {
		const expiryBefore = maxDaysToExpiry
			? new Date(Date.now() + maxDaysToExpiry * 86_400_000)
			: undefined;

		const result = await searchOrders({
			asset, side, kind,
			isCall: direction === undefined ? undefined : direction === "call",
			expiryBefore,
			// TODO-OWNER: page size fetched from the adapter before `limit` trims it for the
			// model. Every filter — `kind` included — is applied inside searchOrders, ahead of
			// this cap, so `totalMatched` counts the whole matching set and is never capped by it.
			limit: 200,
		});
		// A broken SDK boundary or an unreadable feed is returned verbatim: neither is an
		// empty book, and neither may be reported as "nothing matches".
		if (isFeedUnavailable(result)) return result;
		const { orders, fetchedAt, totalMatched, droppedEntries } = result;

		return {
			asOf: fetchedAt.toISOString(),
			totalMatched,
			returned: Math.min(orders.length, limit),
			// Feed rows dropped for failing validation. Non-zero means this view of the
			// book is partial; say so rather than implying it is complete. Rows parsed, so
			// this is a partial book, never a lost one: losing every row is `feed_unusable`.
			droppedEntries,
			orders: orders.slice(0, limit).map(describe),
			// Only reachable once rows parsed: the caller's own filters excluded them, or the
			// book really is empty. A feed that returned nothing readable never gets here.
			note:
				totalMatched === 0
					? "Nothing on the book matches those constraints right now. Say so plainly and offer to widen them; do not invent an alternative."
					: undefined,
		};
	},
});

export const getMarketData = tool({
	description:
		"Current spot prices and how much liquidity exists per asset. Use this to ground any statement about " +
		"what an asset is trading at, and to tell the user which markets are actually available.",
	inputSchema: z.object({}),
	execute: async () => {
		const [assets, snapshot] = await Promise.all([getAvailableAssets(), getOrderSnapshot()]);
		// Same two failures as the other tools: a broken SDK boundary or an unreadable feed
		// is returned verbatim, never flattened into an empty asset list.
		if (isFeedUnavailable(snapshot)) return snapshot;
		if (isFeedUnavailable(assets)) return assets;
		return {
			asOf: snapshot.fetchedAt.toISOString(),
			chain: "Base mainnet",
			// Feed rows dropped for failing validation, carried here for the same reason the
			// search tool carries it: non-zero means these counts are of a partial book.
			droppedEntries: snapshot.droppedEntries,
			assets: assets.map((a) => ({
				asset: a.asset,
				spotUsd: a.spotUsd === null ? null : String(a.spotUsd),
				// Orders QUOTED on this asset. Not a count of what could be executed: whether
				// an order is executable depends on the taker's budget and on gates that only
				// previewOptionBookTrade evaluates (contract units, structure/collateral
				// verification, the USD risk limit), so no honest executable count exists here.
				quotedOrders: a.orders,
				calls: a.calls,
				puts: a.puts,
			})),
		};
	},
});

export const previewOptionBookTrade = tool({
	description:
		"Cost and risk for a buy (premium budget) or sell (collateral budget), denominated in its collateral token. Call this before stating any cost, " +
		"payout or loss figure. Returns the real numbers; never compute them yourself. " +
		"Requires an instrumentKey from searchOptionBookOrders.",
	inputSchema: z.object({
		instrumentKey: z
			.string()
			.describe("The instrumentKey field from a searchOptionBookOrders result."),
		budget: z.string().regex(/^\d+(\.\d+)?$/).describe(
            "Decimal collateral-token amount: premium to pay for buy; collateral to lock for sell. The resulting USD risk must not exceed 10 USD.",
        ),
	}),
	execute: async ({ instrumentKey: key, budget }) => {
		// Cached snapshot, up to the adapter's TTL and never past an order's signature or
		// option deadline. Its age is reported as `asOf` on every result below.
		// TODO: the approval-gated calldata path (build step 5) must call
		// getOrderSnapshot(true) instead — a signature re-read from cache can already be
		// spent by the time a transaction is signed.
		const snapshot = await getOrderSnapshot();
		if (isFeedUnavailable(snapshot)) return snapshot;
		const asOf = snapshot.fetchedAt.toISOString();
		const order = findByInstrumentKey(snapshot.orders, key);

		if (!order) {
			return {
				found: false as const,
				asOf,
				reason:
					"That instrument is no longer quoted. The book re-signs about every minute. Search again and use a current instrumentKey.",
			};
		}

        const fill = sizeFill(order, budget);
        if (!fill.executable) return { ...fill, asOf, instrument: describe(order) };
        // Never treat a collateral amount as USD or assume a wrapper's exchange rate. The
        // spot map is keyed by UNDERLYING ASSET, so it can never be indexed by a collateral
        // token symbol; `collateralUsdPrice` is the explicit collateral -> price-source
        // mapping, and it refuses every token it cannot justify (see orders.ts).
        const tokenUsd = collateralUsdPrice(fill.collateralToken.symbol) ?? undefined;
        const valuation = usdRisk(fill.maxLoss.amount, tokenUsd, MAX_LOSS_USD);
        const maxLossUsd = valuation?.amount ?? null;
        const executable = valuation?.withinLimit ?? false;
        const token = fill.collateralToken.symbol;
        return {
            ...fill, executable, asOf, instrument: describe(order),
            reason: executable ? undefined : maxLossUsd === null ? COLLATERAL_USD_UNAVAILABLE : "Maximum loss exceeds the 10 USD agent risk limit.",
            budget: { amount: budget, token, decimals: fill.collateralToken.decimals },
            risk: {
                maxLossUsd: maxLossUsd === null ? null : String(maxLossUsd),
                maxLoss: fill.maxLoss,
                explanation: fill.side === "buy"
                    ? `You BUY this option. You pay the premium up front in ${token}. The most you can lose is that premium.`
                    : `You SELL this option. You receive the premium minus the protocol fee and must LOCK ${fill.collateralRequired?.amount} in ${token} as collateral. You can lose up to that collateral.`,
                maxPayoutUsd: null, breakEvenUsd: null,
                unavailable: "Maximum payout and break-even are not computed yet and must not be estimated. Say they are unavailable if asked.",
            },
        };
	},
});

export const getThesisContext = tool({
	description:
		"Look up a thesis posted on Thesis.fun by id, including its option structure and economics. " +
		"When it has a structure the result carries `marketUrl`; end your answer with that link so the " +
		"user can trade the same view from the market page.",
	inputSchema: z.object({ thesisId: z.string() }),
	execute: async ({ thesisId }) => {
		const result = await loadThesisContext(thesisId);
		if (!result.available) {
			return { found: false as const, reason: result.reason, thesisId };
		}
		/**
		 * The market page for this thesis, carrying the post so the fill is
		 * recorded as a PARTICIPANT of it rather than as a standalone trade
		 * (migration 0007). The shape is fixed by the fold brief:
		 * `/m/<asset>?thesis=<uuid>`, which `app/m/[asset]/page.tsx` already
		 * reads (`single("thesis")`).
		 *
		 * Built here rather than added to `ThesisAiContext`: that object is the
		 * shared PRD v2.0 §10.3 contract with the AI track and is not changed
		 * without telling them (PRD §15).
		 */
		const asset = result.context.market.underlyingAsset;
		return {
			found: true as const,
			context: result.context,
			marketUrl: `/m/${asset.toLowerCase()}?thesis=${result.context.thesis.id}`,
		};
	},
});

/** Every read tool. Safe to run without user approval. */
export const readTools = {
	searchOptionBookOrders,
	getMarketData,
	previewOptionBookTrade,
	getThesisContext,
};
