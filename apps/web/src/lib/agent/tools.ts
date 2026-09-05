import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { getThesisContext as loadThesisContext } from "@/lib/thesis-context";

import { instrumentKey, findByInstrumentKey } from "@/lib/thetanuts/instrument";
import {
	getAvailableAssets,
	getOrderSnapshot,
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
		premiumPerContract: order.pricePerContractUsd,
		makerCollateralBudget: order.makerBudgetUsd,
	};
}

export const searchOptionBookOrders = tool({
	description:
		"Search live Thetanuts OptionBook liquidity on Base mainnet. Returns buy and sell orders, labelled by taker side and collateral token. " +
		"Use this before discussing any specific trade: never describe an option that is not in these results. " +
		"Product kinds: 'binary' is a simple yes/no bet on a price level by a date and is the easiest to explain; " +
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
			.enum(["binary", "vanilla", "multi_leg"])
			.optional()
			.describe("Filter by product shape. Prefer 'binary' for beginners."),
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

		const { orders, fetchedAt, totalMatched } = await searchOrders({
			asset, side,
			isCall: direction === undefined ? undefined : direction === "call",
			expiryBefore,
			limit: 200,
		});

		const filtered = kind ? orders.filter((o) => o.kind === kind) : orders;

		return {
			asOf: fetchedAt.toISOString(),
			totalMatched: kind ? filtered.length : totalMatched,
			returned: Math.min(filtered.length, limit),
			orders: filtered.slice(0, limit).map(describe),
			note:
				filtered.length === 0
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
		return {
			asOf: snapshot.fetchedAt.toISOString(),
			chain: "Base mainnet",
			assets: assets.map((a) => ({
				asset: a.asset,
				spotUsd: a.spotUsd === null ? null : String(a.spotUsd),
				tradeableOrders: a.orders,
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
		// Fresh snapshot: a preview built from a stale price misleads the user.
		const snapshot = await getOrderSnapshot();
		const order = findByInstrumentKey(snapshot.orders, key);

		if (!order) {
			return {
				found: false as const,
				reason:
					"That instrument is no longer quoted. The book re-signs about every minute. Search again and use a current instrumentKey.",
			};
		}

        const fill = sizeFill(order, budget);
        if (!fill.executable) return { ...fill, instrument: describe(order) };
        // Never treat a collateral amount as USD or assume a wrapper's exchange rate.
        // TODO-OWNER: supply a verified collateral/USD valuation source for tokens absent here.
        const tokenUsd = snapshot.marketData[fill.collateralToken.symbol];
        const valuation = usdRisk(fill.maxLoss, tokenUsd, MAX_LOSS_USD);
        const maxLossUsd = valuation?.amount ?? null;
        const executable = valuation?.withinLimit ?? false;
        const token = fill.collateralToken.symbol;
        return {
            ...fill, executable, asOf: snapshot.fetchedAt.toISOString(), instrument: describe(order),
            reason: executable ? undefined : maxLossUsd === null ? "Collateral USD valuation unavailable; cannot verify the 10 USD risk limit." : "Maximum loss exceeds the 10 USD agent risk limit.",
            budget,
            risk: {
                maxLossUsd: maxLossUsd === null ? null : String(maxLossUsd),
                maxLoss: fill.maxLoss,
                explanation: fill.side === "buy"
                    ? `You BUY this option. You pay the premium up front in ${token}. The most you can lose is that premium.`
                    : `You SELL this option. You receive the premium minus the protocol fee and must LOCK ${fill.collateralRequired} in ${token} as collateral. You can lose up to that collateral.`,
                maxPayoutUsd: null, breakEvenUsd: null,
                unavailable: "Maximum payout and break-even are not computed yet and must not be estimated. Say they are unavailable if asked.",
            },
        };
	},
});

export const getThesisContext = tool({
	description:
		"Look up a thesis posted on Thesis.fun by id, including its option structure and economics.",
	inputSchema: z.object({ thesisId: z.string() }),
	execute: async ({ thesisId }) => {
		const result = await loadThesisContext(thesisId);
		return result.available
			? { found: true as const, context: result.context }
			: { found: false as const, reason: result.reason, thesisId };
	},
});

/** Every read tool. Safe to run without user approval. */
export const readTools = {
	searchOptionBookOrders,
	getMarketData,
	previewOptionBookTrade,
	getThesisContext,
};
