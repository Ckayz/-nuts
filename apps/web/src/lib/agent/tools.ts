import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { instrumentKey, findByInstrumentKey } from "@/lib/thetanuts/instrument";
import {
	getAvailableAssets,
	getOrderSnapshot,
	searchOrders,
	sizeFill,
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
		asset: order.asset,
		kind: order.kind,
		direction: order.isCall ? "call" : "put",
		strikesUsd: order.strikesUsd,
		expiryAt: order.expiryAt,
		premiumPerContractUsd: order.pricePerContractUsd,
		makerBudgetUsd: order.makerBudgetUsd,
	};
}

export const searchOptionBookOrders = tool({
	description:
		"Search live Thetanuts OptionBook liquidity on Base mainnet. Returns instruments the user can buy with USDC. " +
		"Use this before discussing any specific trade: never describe an option that is not in these results. " +
		"Product kinds: 'binary' is a simple yes/no bet on a price level by a date and is the easiest to explain; " +
		"'vanilla' is a single call or put; 'multi_leg' is a spread or butterfly.",
	inputSchema: z.object({
		asset: z
			.string()
			.optional()
			.describe("Underlying symbol such as ETH, BTC, SOL, BNB, AVAX, XRP. Omit for all."),
		direction: z
			.enum(["call", "put"])
			.optional()
			.describe("'call' profits if the price rises, 'put' if it falls. Omit for both."),
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
	execute: async ({ asset, direction, kind, maxDaysToExpiry, limit }) => {
		const expiryBefore = maxDaysToExpiry
			? new Date(Date.now() + maxDaysToExpiry * 86_400_000)
			: undefined;

		const { orders, fetchedAt, totalMatched } = await searchOrders({
			asset,
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
		"Cost and risk for buying a specific instrument with a USDC budget. Call this before stating any cost, " +
		"payout or loss figure. Returns the real numbers; never compute them yourself. " +
		"Requires an instrumentKey from searchOptionBookOrders.",
	inputSchema: z.object({
		instrumentKey: z
			.string()
			.describe("The instrumentKey field from a searchOptionBookOrders result."),
		budgetUsd: z
			.number()
			.positive()
			.max(MAX_LOSS_USD)
			.describe(
				`USDC the user is willing to spend and lose. Capped at ${MAX_LOSS_USD} for agent-prepared trades.`,
			),
	}),
	execute: async ({ instrumentKey: key, budgetUsd }) => {
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

		const fill = sizeFill(order, budgetUsd);
		const spot = order.asset ? snapshot.marketData[order.asset] : undefined;

		return {
			found: true as const,
			asOf: snapshot.fetchedAt.toISOString(),
			instrument: describe(order),
			spotUsd: spot === undefined ? null : String(spot),
			cost: {
				budgetUsd: String(budgetUsd),
				actualCostUsd: fill.costUsd,
				contracts: fill.contractsDecimal,
				cappedByOrderSize: fill.cappedByOrderSize,
			},
			risk: {
				maxLossUsd: fill.maxLossUsd,
				maxLossIsBounded: true,
				explanation:
					"This is a long option bought with USDC. The most that can be lost is the premium paid, and that loss happens if the option expires worthless.",
				maxPayoutUsd: null,
				breakEvenUsd: null,
				unavailable:
					"Maximum payout and break-even are not computed yet and must not be estimated. Say they are unavailable if asked.",
			},
			expiry: {
				expiresAt: order.expiryAt,
				settlement: "Cash settled at expiry against the Chainlink price feed.",
			},
		};
	},
});

export const getThesisContext = tool({
	description:
		"Look up a thesis posted on Thesis.fun by id, including its option structure and economics.",
	inputSchema: z.object({ thesisId: z.string() }),
	execute: async ({ thesisId }) => ({
		found: false as const,
		reason:
			"Thesis data is not available yet: the social product's tables are still being built. " +
			"Tell the user theses cannot be looked up right now, and offer to search live market liquidity instead. " +
			"Do not invent a thesis.",
		thesisId,
	}),
});

/** Every read tool. Safe to run without user approval. */
export const readTools = {
	searchOptionBookOrders,
	getMarketData,
	previewOptionBookTrade,
	getThesisContext,
};
