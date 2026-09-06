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

/**
 * One configured model: which variable holds it, and what it is set to.
 *
 * `id` is typed as possibly absent because it really is: `@nuts/env/server`
 * hands back raw `process.env` whenever validation is skipped, and a zod
 * `.default()` only exists when zod parses. B-1 — the type used to say `string`,
 * so nothing forced the callers to consider the case that crashed the health
 * endpoint.
 */
export interface ConfiguredModel {
	readonly variable: string;
	readonly id: string | undefined;
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
	// B-1 (one-shot review of the RFQ build, MAJOR). A MISSING id is checked
	// first, and independently of the provider.
	//
	// `model.id` used to be dereferenced straight away. `env.AGENT_MODEL` carries
	// a zod `.default()`, and a default only exists when zod actually parses — so
	// whenever validation is skipped (`packages/db/src/test-fence.ts` sets
	// `SKIP_ENV_VALIDATION` in every `bun test` preload, and `scripts/verify.ts`
	// sets it for the offline lane) the id is `undefined` and
	// `model.id.includes(":free")` threw:
	//
	//   TypeError: undefined is not an object (evaluating 'model.id.includes')
	//     at providerModelProblem (model-config.ts:51)
	//     at agentHealth (health.ts:173)
	//     at GET (app/api/agent/health/route.ts:61)
	//
	// So the one endpoint whose job is to say why the agent is down answered 500
	// instead of naming the problem. An unset model id IS the configuration
	// problem this module reports; it is not an exception.
	for (const model of config.models) {
		if (typeof model.id !== "string" || model.id.trim() === "") {
			return (
				`${model.variable} is not set. The agent has no model to call, so every turn would fail. ` +
				`Fix: set ${model.variable} in the environment (see apps/web/.env.example).`
			);
		}
		if (!config.usingGateway) continue;
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
