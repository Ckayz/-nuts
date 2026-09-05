/**
 * F-E item 1. Does the configured model id agree with the provider this
 * deployment actually routes through?
 *
 * The failure this exists to stop, measured by the teammate on 2026-09-06
 * (`da09e81`) and re-read from that commit rather than recalled: production sets
 * `AI_GATEWAY_API_KEY`, so `model.ts` routes through the Vercel AI Gateway; the
 * default `AGENT_MODEL` was `minimax/minimax-m3:free`, an OpenRouter id; the
 * gateway lists 373 models and NONE carries a `:free` suffix; every turn died
 * with `GatewayModelNotFoundError` — and, because `streamText` reports through
 * `onError` instead of throwing, the route still answered HTTP 200 and the
 * browser said only "Something went wrong."
 *
 * A per-turn failure is the worst place to learn this. The check runs ONCE at
 * module load, names the variable, the id and the fix, and is a pure function so
 * it can be tested without a provider.
 *
 * Pure: no env, no `server-only`, no I/O.
 */

/** One configured model: which variable holds it, and what it is set to. */
export interface ConfiguredModel {
	readonly variable: string;
	readonly id: string;
}

export interface ProviderConfig {
	/** True when `AI_GATEWAY_API_KEY` is set, which is what selects the gateway. */
	readonly usingGateway: boolean;
	readonly models: readonly ConfiguredModel[];
}

/**
 * The ONE rule measurement supports.
 *
 * A `:free` suffix is an OpenRouter variant marker. The gateway serves no id
 * carrying it (measured 2026-09-06 by the teammate, over the gateway's own model
 * list), so gateway + `:free` is always wrong and always wrong in the same way.
 *
 * The REVERSE direction — an id that only the gateway serves, configured while
 * OpenRouter is the provider — is deliberately NOT checked. It would need a list
 * of gateway-only ids, and no such list has been measured; the one paid id in
 * play, `anthropic/claude-haiku-4.5`, was measured working on BOTH providers
 * (OpenRouter: 5/5 through the gate's own call shape, 2026-09-06 03:5x), so a
 * guessed list would fire on a configuration that works. NOT VERIFIED, so not
 * enforced.
 */
export function providerModelProblem(config: ProviderConfig): string | null {
	if (!config.usingGateway) return null;
	for (const model of config.models) {
		if (model.id.includes(":free")) {
			return (
				`${model.variable}=${model.id} is an OpenRouter model id (the ":free" suffix), ` +
				"but AI_GATEWAY_API_KEY is set, so this deployment calls the Vercel AI Gateway, " +
				"which serves no \":free\" id. Every agent turn would fail with GatewayModelNotFoundError. " +
				`Fix: either unset AI_GATEWAY_API_KEY so OpenRouter serves ${model.id}, or set ` +
				`${model.variable} to a model the gateway serves.`
			);
		}
	}
	return null;
}

/** The provider name this configuration selects. Shown by `/api/agent/health`. */
export function providerName(usingGateway: boolean): "gateway" | "openrouter" {
	return usingGateway ? "gateway" : "openrouter";
}
