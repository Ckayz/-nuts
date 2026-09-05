import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { findByInstrumentKey, instrumentKey } from "@/lib/thetanuts/instrument";
import { AGENT_COLLATERAL, MAX_LOSS_USD, withinAgentLimits } from "./limits";
import { structureIdOf } from "@/lib/market/structures";
import { prepareTradeFor } from "@/lib/trade/prepare";
import { resolveThesisAttachment } from "./attachment";
import {
	COLLATERAL_USD_UNAVAILABLE,
	collateralUsdPrice,
	getOrderSnapshot,
	isFeedUnavailable,
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

/**
 * Refuse to hand over calldata built from an order whose signature is about to
 * expire.
 *
 * C13-r2 (lane C confirming pass, finding 13). This was 25, which is not a
 * number anyone chose: PRD 14 says "calldata must be built and broadcast within
 * 30 seconds of the fetch that produced it", so an order with less than 30
 * seconds of signature life left cannot satisfy that window. 30 is the PRD's
 * number; measured signature lifetimes are 59-113 s, so a fresh order clears it.
 * TODO-OWNER: the PRD's 30 s is the owner's; this file only enforces it.
 */
const MIN_SIGNATURE_SECONDS = 30;

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

			// C3-r2. PRD 10.2's collateral rule, checked before anything is built.
			if (quote.collateralToken.symbol !== AGENT_COLLATERAL) {
				return {
					prepared: false as const,
					asOf,
					reason: `The agent prepares ${AGENT_COLLATERAL} trades only, and this order settles in ${quote.collateralToken.symbol}.`,
				};
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

			// C#7. The conversation's post is CONTEXT. It becomes this position's
			// attachment only when it names an instrument to attach to; a text
			// post has nothing to back, so the fill is standalone (migration 0007)
			// and the model is told to say so. Every other refusal the shared path
			// makes — another market, another instrument, a closed post — still
			// refuses, because those are PRD 8.4's forbidden substitutions.
			const attachment = await resolveThesisAttachment(thesisId);

			// THE one money path. It re-reads the book, re-quotes, re-checks the
			// taker side, builds the calldata and issues the signed ticket that
			// `recordTrade` needs to bind the receipt to a position.
			const prepared = await prepareTradeFor(session, {
				structureId,
				// The agent prepares BUYS only (refused above otherwise), which is
				// the Bull side of the ticket's vocabulary.
				side: "bull",
				budgetInput: budget,
				thesisId: attachment.attach,
			});
			if (!prepared.ok) {
				return {
					prepared: false as const,
					asOf,
					reason: `The trade could not be prepared (${prepared.code}): ${prepared.reason}`,
				};
			}

			/**
			 * C3-r2 (lane C confirming pass, finding 3). THE CEILING, ON WHAT WAS
			 * ACTUALLY PREPARED.
			 *
			 * Everything above checked the quote THIS tool computed. But
			 * `prepareTradeFor` re-reads the book, re-quotes and re-sizes on its
			 * own, so its answer can be larger than the one that passed: the
			 * reviewer measured a $20 request that this tool capped to $5 of risk
			 * on a thin book and that came back as `returnedRiskUsd8` 2000000000 =
			 * $20 of executable risk once liquidity returned. The same gate runs on
			 * the post-approval preparation (`lib/agent/actions.ts`), which is the
			 * leg that used to bypass it entirely.
			 */
			const gate = withinAgentLimits(prepared);
			if (!gate.ok) return { prepared: false as const, asOf, reason: gate.reason };

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
				thesisId: attachment.attach,
				stage: prepared.stage,
				transactions:
					prepared.stage === "approve"
						? { approve: prepared.approve }
						: { fill: prepared.fill },
				/** Present only at the fill stage; hand back to `recordTrade` unchanged. */
				...(prepared.stage === "fill"
					? { token: prepared.token, expected: prepared.expected, preparedAt: prepared.preparedAt }
					: {}),
				/**
				 * C#5. The approval leg's own economics and the allowance decoded
				 * from its calldata. The browser prints these and refuses to send an
				 * approval whose bytes disagree with them.
				 */
				...(prepared.stage === "approve"
					? { allowance: prepared.allowance, expected: prepared.expected }
					: {}),
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
				/** C#7. Present only when the conversation's post could not be attached to. */
				...(attachment.note === null ? {} : { attachmentNote: attachment.note }),
				instruction:
					(attachment.note === null ? "" : `${attachment.note} Say this to the user. `) +
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
