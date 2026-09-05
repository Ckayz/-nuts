import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { env } from "@nuts/env/server";

import { providerModelProblem } from "./model-config";

/**
 * The model provider is replaceable (PRD 11). Product behaviour is defined by
 * the context contract, the tools and the guardrails, not by a vendor.
 *
 * Two providers are configured, and which one runs is decided by what is in the
 * environment rather than by a code change:
 *
 * - **Vercel AI Gateway** when `AI_GATEWAY_API_KEY` is set. The AI SDK routes a
 *   plain `"creator/model"` string through the gateway with no wrapper, so the
 *   model identifiers already in `AGENT_MODEL` / `AGENT_GATE_MODEL` are used
 *   verbatim. Verified against the gateway's public model list: both
 *   `anthropic/claude-sonnet-4.5` and `anthropic/claude-haiku-4.5` are served.
 * - **OpenRouter** otherwise, which is what shipped first and what a local
 *   checkout without the gateway key still uses.
 *
 * The gateway is preferred because the OpenRouter key is a personal free-tier
 * key that expires 2026-09-11 and had already exhausted its credit in
 * production, taking the agent down. Every Vercel team gets renewing gateway
 * credit, and on a Vercel deployment the credential is managed for us.
 *
 * Model identifiers are NOT hardcoded here. They stay in the env schema so a
 * slug change is a configuration change; the gateway's catalogue moves faster
 * than this file will.
 */

/** True when the gateway credential is present. */
export const usingGateway = Boolean(env.AI_GATEWAY_API_KEY);

// One of the two credentials must exist. Failing here names both acceptable
// options; a schema error would have named only one and sent the reader to fix
// the wrong thing.
if (!usingGateway && !env.OPENROUTER_API_KEY) {
	throw new Error(
		"No model credential. Set AI_GATEWAY_API_KEY (preferred) or OPENROUTER_API_KEY.",
	);
}

/**
 * F-E item 1. The id and the provider must agree, checked ONCE here rather than
 * discovered on every turn.
 *
 * `da09e81` measured the cost of not doing this: an OpenRouter `:free` id while
 * the gateway key was set killed every agent turn, and because `streamText`
 * reports through `onError` the route still answered HTTP 200. A boot error
 * names the variable, the id and the two ways out; a silent 200 names nothing.
 */
const configProblem = providerModelProblem({
	usingGateway,
	models: [
		{ variable: "AGENT_MODEL", id: env.AGENT_MODEL },
		{ variable: "AGENT_GATE_MODEL", id: env.AGENT_GATE_MODEL },
	],
});
if (configProblem !== null) throw new Error(configProblem);

const openrouter = usingGateway
	? null
	: createOpenRouter({ apiKey: env.OPENROUTER_API_KEY as string });

function resolve(modelId: string): LanguageModel {
	// A bare string is the AI SDK's gateway path. Wrapping it would defeat that.
	if (usingGateway) return modelId;
	return openrouter!(modelId);
}

/** Primary model for agent turns. */
export const agentModel = resolve(env.AGENT_MODEL);

/** Small, fast model for the scope gate. Runs on every inbound message. */
export const gateModel = resolve(env.AGENT_GATE_MODEL);
