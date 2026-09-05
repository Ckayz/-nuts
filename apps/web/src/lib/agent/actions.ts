"use server";

/**
 * C3-r2 (lane C confirming pass, finding 3). The agent's own preparation action.
 *
 * The execution card has TWO preparation legs: the one the tool runs before the
 * approval, and the one the browser runs after the collateral approval is mined.
 * The second called `prepareTrade` — the market ticket's action — which knows
 * nothing about the agent, so the PRD 10.2 ceiling applied to the first leg and
 * not to the leg that actually produced the fill calldata.
 *
 * This is that leg, with the same gate. `withinAgentLimits` is the one
 * implementation and it runs on the server in both places, which is what PRD 14
 * asks for: "Enforce agent spend and loss limits outside the model process."
 *
 * Every export in a `"use server"` module is a client-callable entry point, so
 * this one is treated as untrusted: the session comes from the cookie inside
 * `prepareTrade`, and the structure, side and budget are re-read against the
 * live book there.
 */
import { prepareTrade } from "@/lib/trade/prepare";
import type { PrepareTradeInput } from "@/lib/trade/prepare";
import type { PrepareResult } from "@/lib/trade/types";
import { withinAgentLimits } from "./limits";

export async function prepareAgentTrade(input: PrepareTradeInput): Promise<PrepareResult> {
	const prepared = await prepareTrade(input);
	const gate = withinAgentLimits(prepared);
	if (!gate.ok) return { ok: false, code: "AGENT_LIMIT", reason: gate.reason };
	return prepared;
}
