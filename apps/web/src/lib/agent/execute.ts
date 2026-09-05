import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { buildFillTransactions } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";

import { findByInstrumentKey, instrumentKey } from "@/lib/thetanuts/instrument";
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
}

export function createExecutionTools({ account }: ExecutionToolsParams) {
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

			// The same decimal -> base-unit conversion sizeFill used, from the token it
			// resolved. buildFillTransactions takes the premium budget in base units.
			const budgetUnits = toBaseUnits(budget, quote.collateralToken.decimals);

			let built: Awaited<ReturnType<typeof buildFillTransactions>>;
			try {
				built = await buildFillTransactions({
					client: readClient,
					order: order.sdkOrder,
					budget: budgetUnits,
					referrer: env.THESIS_REFERRER,
					account,
				});
			} catch (error) {
				// Structured refusals from the trade package are the useful ones: expired
				// order, zero contracts, encode mismatch. Surface the code, not a stack.
				const code =
					error && typeof error === "object" && "code" in error
						? String((error as { code: unknown }).code)
						: "PREPARE_FAILED";
				return {
					prepared: false as const,
					asOf,
					reason: `The trade could not be prepared (${code}). Tell the user plainly and offer to search again.`,
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
				 * Unsigned transactions, in order. `approve` is an exact-amount ERC-20
				 * approval and is absent when the allowance already covers the premium.
				 */
				transactions: {
					...(built.approve
						? { approve: { to: built.approve.to, data: built.approve.data, value: "0" } }
						: {}),
					fill: { to: built.fill.to, data: built.fill.data, value: "0" },
				},
				expected: {
					premium: quote.premium,
					contracts: quote.contracts,
					contractsUnit: quote.contractsUnit,
					/**
					 * True when the maker's remaining size, not the user's budget, set the
					 * amount. Asking for 50 and receiving 8.83 is the normal case on a thin
					 * book, and the user must be told rather than left assuming they bought
					 * what they asked for.
					 */
					cappedByOrderSize: quote.capped,
					requestedBudget: { amount: budget, token: quote.collateralToken.symbol },
					maxLoss: quote.maxLoss,
					maxLossUsd: String(valuation.amount),
					collateralToken: built.expected.collateralToken,
					spender: built.expected.spender,
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
