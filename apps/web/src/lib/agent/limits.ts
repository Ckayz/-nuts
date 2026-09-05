/**
 * C3-r2 (lane C confirming pass, finding 3). The agent's spend limits, applied
 * to what was ACTUALLY PREPARED.
 *
 * PRD 10.2, verbatim:
 *   "Base mainnet and USDC collateral only for v1."
 *   "`maximumLossUsd <= 10` and `requiredCollateralUsd <= 10` for
 *    agent-prepared trades."
 *   "Default daily model limits are 10 turns per guest IP and 50 per
 *    authenticated wallet."
 * PRD 14, verbatim: "Enforce agent spend and loss limits outside the model
 * process. A limit expressed only as a system instruction or an in-process
 * check is not a spend control."
 *
 * Every number here is the PRD's, cited above. TODO-OWNER: the numbers
 * themselves belong to the owner; this module only enforces them.
 *
 * Pure and free of `server-only`, `@nuts/db` and the SDK, so the gate can be
 * tested without a database — the reviewer's AGENT_SERVER_GATE probe had to
 * drive the whole tool to see it.
 */
import type { PrepareResult } from "@/lib/trade/types";

/** PRD 10.2. */
export const MAX_LOSS_USD = 10;
/** The same ceiling as an 8-decimal USD integer, the scale every quote uses. */
export const MAX_LOSS_USD8 = BigInt(MAX_LOSS_USD) * 100_000_000n;
/** PRD 10.2, "USDC collateral only for v1". aBasUSDC is a different token. */
export const AGENT_COLLATERAL = "USDC";
/** PRD 10.2 daily model limits. */
export const DAILY_TURNS = { guest: 10, wallet: 50 } as const;

export type AgentGate = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Does a prepared trade stay inside the agent's limits?
 *
 * `approve` is the collateral-approval leg: no fill has been priced yet, so
 * there is nothing to measure and nothing to refuse — the fill it leads to is
 * checked by this same function on the next call. `fill` carries the economics
 * the wallet is about to sign for, and those are what the ceiling is about.
 *
 * A quote with no USD max loss is REFUSED, not waved through: an unpriceable
 * collateral token means the limit cannot be evaluated, and PRD 14 asks for a
 * spend control, not a best effort.
 */
export function withinAgentLimits(prepared: PrepareResult): AgentGate {
	if (!prepared.ok) return { ok: true };
	if (prepared.stage !== "fill") return { ok: true };
	const quote = prepared.expected;
	if (quote.collateralSymbol !== AGENT_COLLATERAL) {
		return {
			ok: false,
			reason: `The prepared trade settles in ${quote.collateralSymbol}; the agent prepares ${AGENT_COLLATERAL} trades only (PRD 10.2). Nothing was prepared.`,
		};
	}
	if (quote.maxLossUsd8 === null || !/^\d+$/.test(quote.maxLossUsd8)) {
		return {
			ok: false,
			reason:
				"The prepared trade states no maximum loss in USD, so the agent limit cannot be checked. Nothing was prepared.",
		};
	}
	const risk = BigInt(quote.maxLossUsd8);
	if (risk > MAX_LOSS_USD8) {
		return {
			ok: false,
			reason: `The prepared trade risks ${usd8(risk)} USD, over the ${MAX_LOSS_USD} USD agent limit (PRD 10.2). Nothing was prepared. Ask for a smaller budget.`,
		};
	}
	return { ok: true };
}

/** 8-decimal USD integer as a plain decimal, for the sentence above. */
function usd8(value: bigint): string {
	const whole = value / 100_000_000n;
	const fraction = (value % 100_000_000n).toString().padStart(8, "0").slice(0, 2);
	return `${whole}.${fraction}`;
}
