import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { buildFillTransactions } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";

import { findByInstrumentKey, instrumentKey } from "@/lib/thetanuts/instrument";
import { structureIdOf } from "@/lib/market/structures";
import { prepareTradeFor } from "@/lib/trade/prepare";
import {
	COLLATERAL_USD_UNAVAILABLE,
	collateralUsdPrice,
	getOrderSnapshot,
	isFeedUnavailable,
	readClient,
	sizeFill,
	usdRisk,
} from "@/lib/thetanuts/orders";

/**
 * The approval-gated write tool (PRD 10.5).
 *
 * It prepares a transaction and returns calldata. It never signs and never
 * broadcasts: the user's wallet is the sole execution authority (PRD 10.1, 14).
 * Approval is enforced by the model runtime, not by this code — the chat route
 * declares `toolApproval` for this tool name, so `execute` cannot run until the
 * user has answered the approval request.
 *
 * The connected account is bound at construction, never taken from the model.
 * A tool argument for "which wallet" would let a prompt-injected model point the
 * approval at an address the user never chose.
 *
 * FOLD (money path). The calldata is NOT built here any more. This tool decides
 * whether the agent is allowed to prepare the trade — the PRD §10.2 risk ceiling,
 * the taker side, the signature lifetime — and then hands the work to
 * `prepareTradeFor`, the SAME server path the market ticket uses. Two reasons:
 *
 *  - `prepareTradeFor` issues the signed trade TICKET, and `recordTrade` cannot
 *    bind a receipt to a position without one. Built directly from
 *    `buildFillTransactions`, an agent fill produced calldata that nothing could
 *    ever record: the money left the wallet and no position row existed.
 *  - it is the only path carrying the receipt/order fences (C1-C3), so an agent
 *    fill and a market-page fill are checked identically. A second recording
 *    path is exactly what those fences exist to prevent.
 */

/** Ceiling on agent-prepared trades (PRD 10.2), re-enforced here at prepare time. */
const MAX_LOSS_USD = 10;

/** Decimal token amount to base units. Mirrors the parsing sizeFill already validated. */
function toBaseUnits(amount: string, decimals: number): bigint {
	const [whole = "0", fraction = ""] = amount.split(".");
	return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * Refuse to hand over calldata built from an order whose signature is about to
 * expire. Measured signature lifetimes are 59-113s, so a preview that survives
 * this check still leaves the user time to sign (PRD 14).
 */
const MIN_SIGNATURE_SECONDS = 25;

export interface ExecutionToolsParams {
	/** Connected wallet, from the request. Null when the user has not connected. */
	readonly account: `0x${string}` | null;
	/**
	 * The signed-in session, read server-side from the cookie — never from the
	 * request body and never from the model. `prepareTradeFor` binds the ticket
	 * to it, so a prepared trade can only ever be recorded by the wallet that
	 * signed in.
	 */
	readonly session: { userId: string; walletAddress: string } | null;
	/** The post this conversation is about (`/agent?thesis=<uuid>`), or null. */
	readonly thesisId: string | null;
}

export function createExecutionTools({ account, session, thesisId }: ExecutionToolsParams) {
	const requestOptionBookExecution = tool({
		description:
			"Prepare a real Base mainnet OptionBook purchase for the user's wallet to sign. " +
			"Returns unsigned transactions; it never sends them. Call this only after the user has seen " +
			"a preview and asked to proceed. Requires an instrumentKey from searchOptionBookOrders.",
		inputSchema: z.object({
			instrumentKey: z
				.string()
				.describe("The instrumentKey field from a searchOptionBookOrders result."),
			budget: z
				.string()
				.regex(/^\d+(\.\d+)?$/)
				.describe(
					"Decimal premium to pay, in the order's collateral token. The resulting USD risk must not exceed 10 USD.",
				),
		}),
		execute: async ({ instrumentKey: key, budget }) => {
			if (!account) {
				return {
					prepared: false as const,
					reason:
						"No wallet is connected. Ask the user to connect their wallet before preparing a transaction.",
				};
			}
			if (session === null) {
				return {
					prepared: false as const,
					reason:
						"This wallet is not signed in. Ask the user to sign in with their wallet; a trade cannot be recorded without it.",
				};
			}
			if (session.walletAddress.toLowerCase() !== account.toLowerCase()) {
				return {
					prepared: false as const,
					reason:
						"The connected wallet is not the one that signed in. Ask the user to sign in again with the wallet they want to trade from.",
				};
			}

			// Forced refresh, never the cache. A cached signature can already be spent
			// or expired by the time the user signs, and this is the last read before
			// calldata reaches a wallet.
			const snapshot = await getOrderSnapshot(true);
			if (isFeedUnavailable(snapshot)) return { prepared: false as const, ...snapshot };

			const asOf = snapshot.fetchedAt.toISOString();
			const order = findByInstrumentKey(snapshot.orders, key);
			if (!order) {
				return {
					prepared: false as const,
					asOf,
					reason:
						"That instrument is no longer quoted. Search again, show the user the current price, and ask before preparing anything.",
				};
			}

			if (order.side !== "buy") {
				return {
					prepared: false as const,
					asOf,
					reason:
						"This order can only be taken by selling, which locks collateral rather than paying a premium. The agent prepares buys only.",
				};
			}

			const secondsLeft = Math.floor((Date.parse(order.orderExpiresAt) - Date.now()) / 1000);
			if (secondsLeft < MIN_SIGNATURE_SECONDS) {
				return {
					prepared: false as const,
					asOf,
					reason: `This order's signature expires in ${Math.max(0, secondsLeft)}s, too soon to sign safely. Search again for a freshly signed order.`,
				};
			}

			// Re-quote and re-check the limit here rather than trusting the earlier
			// preview: the price moves between the preview the user saw and this call.
			const quote = sizeFill(order, budget);
			if (!quote.executable) {
				return { prepared: false as const, asOf, instrumentKey: key, ...quote };
			}

			const tokenUsd = collateralUsdPrice(quote.collateralToken.symbol) ?? undefined;
			const valuation = usdRisk(quote.maxLoss.amount, tokenUsd, MAX_LOSS_USD);
			if (!valuation) {
				return { prepared: false as const, asOf, reason: COLLATERAL_USD_UNAVAILABLE };
			}
			if (!valuation.withinLimit) {
				return {
					prepared: false as const,
					asOf,
					reason: `Maximum loss ${valuation.amount} USD exceeds the ${MAX_LOSS_USD} USD agent risk limit.`,
				};
			}

			// The instrument the agent chose, as the market page names it. Same hash
			// over the same fields, so the ticket the shared path issues describes
			// exactly the order matched above.
			const structureId = structureIdOf({
				priceFeed: order.entry.order.priceFeed,
				implementationAddress: order.entry.order.implementation,
				collateralAddress: order.entry.order.collateral,
				isCall: order.entry.order.isCall,
				strikes: order.entry.order.strikes.map((strike) => BigInt(strike)),
				expiry: BigInt(order.entry.order.expiry),
			});

			// THE one money path. It re-reads the book, re-quotes, re-checks the
			// taker side, builds the calldata and issues the signed ticket that
			// `recordTrade` needs to bind the receipt to a position.
			const prepared = await prepareTradeFor(session, {
				structureId,
				// The agent prepares BUYS only (refused above otherwise), which is
				// the Bull side of the ticket's vocabulary.
				side: "bull",
				budgetInput: budget,
				thesisId,
			});
			if (!prepared.ok) {
				return {
					prepared: false as const,
					asOf,
					reason: `The trade could not be prepared (${prepared.code}): ${prepared.reason}`,
				};
			}

			return {
				prepared: true as const,
				asOf,
				instrumentKey: instrumentKey(order),
				account,
				chainId: 8453,
				label: order.label,
				/**
				 * What the browser needs to finish through the shared server
				 * actions. `structureId`, `side` and `budgetInput` let it RE-PREPARE
				 * after the approval is mined, exactly as the market ticket does, so
				 * no calldata is ever sent against a stale allowance.
				 */
				structureId,
				side: "bull" as const,
				budgetInput: budget,
				thesisId,
				stage: prepared.stage,
				transactions:
					prepared.stage === "approve"
						? { approve: prepared.approve }
						: { fill: prepared.fill },
				/** Present only at the fill stage; hand back to `recordTrade` unchanged. */
				...(prepared.stage === "fill" ? { token: prepared.token, expected: prepared.expected } : {}),
				preview: {
					premium: quote.premium,
					contracts: quote.contracts,
					contractsUnit: quote.contractsUnit,
					/**
					 * True when the maker's remaining size, not the user's budget, set
					 * the amount. Asking for 50 and receiving 8.83 is the normal case on
					 * a thin book, and the user must be told rather than left assuming
					 * they bought what they asked for.
					 */
					cappedByOrderSize: quote.capped,
					requestedBudget: { amount: budget, token: quote.collateralToken.symbol },
					maxLoss: quote.maxLoss,
					maxLossUsd: String(valuation.amount),
				},
				/** After this instant the maker signature is dead and the fill will revert. */
				signatureExpiresAt: order.orderExpiresAt,
				secondsUntilSignatureExpiry: secondsLeft,
				instruction:
					"Show the user the cost, the maximum loss and the expiry, then tell them their wallet will ask them to confirm. " +
					"Do not claim the trade is done: it is not done until their wallet reports a confirmed transaction. " +
					"If cappedByOrderSize is true, say plainly that the order could not absorb the full budget and state what will actually be spent.",
			};
		},
	});

	return { requestOptionBookExecution };
}

/** Tool names that must never run without an explicit user approval. */
export const APPROVAL_REQUIRED_TOOLS = ["requestOptionBookExecution"] as const;
