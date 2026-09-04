import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "@nuts/env/server";

/**
 * The model provider is replaceable (PRD 11). Product behaviour is defined by
 * the context contract, the tools and the guardrails, not by a vendor.
 */
const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });

/** Primary model for agent turns. */
export const agentModel = openrouter(env.AGENT_MODEL);

/** Small, fast model for the scope gate. Runs on every inbound message. */
export const gateModel = openrouter(env.AGENT_GATE_MODEL);
