import "./load";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function getVercelOrigin() {
	const vercelUrl =
		process.env.VERCEL_ENV === "production"
			? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
			: (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);
	if (!vercelUrl) return undefined;
	return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}

// Exposed for future URL-derived env (CORS/auth origins); unused today.
export const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
	...process.env,
};

export const env = createEnv({
	server: {
		/**
		 * Application database connection. On Vercel this must be the Supabase
		 * **transaction pooler** (port 6543): serverless functions open many
		 * short-lived connections and would exhaust a direct connection.
		 */
		DATABASE_URL: z.string().min(1),
		/**
		 * Direct connection (port 5432), used only by drizzle-kit for migrations.
		 * Schema changes cannot run through the transaction pooler. Optional: falls
		 * back to DATABASE_URL, which is correct for a local database where both
		 * are the same.
		 */
		DIRECT_DATABASE_URL: z.string().optional(),
		SESSION_SECRET: z.string().min(32).optional(),
		DATA_SOURCE: z.enum(["mock", "db"]).default("mock"),
		NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

		/**
		 * Vercel AI Gateway credential. When present the agent routes through the
		 * gateway and OPENROUTER_API_KEY is unused. Optional so a local checkout
		 * without it still runs on OpenRouter.
		 */
		AI_GATEWAY_API_KEY: z.string().min(1).optional(),
		/** OpenRouter key for the agent's model calls. Server-only, never exposed. */
		/**
		 * OpenRouter credential. Optional: it is the fallback when
		 * AI_GATEWAY_API_KEY is absent. `model.ts` refuses at startup if neither
		 * is set, which is a clearer failure than a schema error naming only one
		 * of two acceptable credentials.
		 */
		OPENROUTER_API_KEY: z.string().min(1).optional(),
		/**
		 * Primary model for agent turns.
		 *
		 * A free-tier OpenRouter model by owner direction (2026-09-06): the key
		 * that shipped is a personal free-tier key that had already exhausted its
		 * credit in production once. Measured 2026-09-06 02:1x through
		 * `apps/web/src/lib/agent/model.ts` on the agent's real call shape
		 * (`generateText` + a tool): `minimax/minimax-m3:free` returned
		 * `tool_calls: true` with the correct argument, `finish_reason: "stop"`,
		 * 917-919 total tokens across three runs. OpenRouter lists it free
		 * (prompt 0 / completion 0),
		 * `tools` supported, context 1,048,576.
		 *
		 * A free tier is rate-limited and flaky by nature: 429 and 502 are normal,
		 * not exceptional. Measured on this account 2026-09-06 02:2x, a 429 body
		 * reads `Rate limit exceeded: free-models-per-day`, `X-RateLimit-Limit: 50`
		 * — FIFTY free model requests per day, shared across every `:free` id and
		 * reset at 00:00 UTC. A day's probing exhausted it. That ceiling sits under
		 * the app's own daily caps (PRD 10.2), so it, not PRD 10.2, is what a demo
		 * hits first. OpenRouter's stated remedy is adding 10 credits, which lifts
		 * it to 1000/day. TODO-OWNER.
		 *
		 * Both agent call sites already answer a provider failure with an honest
		 * short message rather than a stack trace, verified against a REAL 429
		 * (2026-09-06 02:2x): the chat route's `streamText` does not throw out of
		 * the handler, `onError` fires, and the browser receives only "The agent is
		 * unavailable right now. Please try again." The scope gate's failure path
		 * covers `AGENT_GATE_MODEL` the same way.
		 *
		 * TODO-OWNER: the model id.
		 */
		AGENT_MODEL: z.string().min(1).default("minimax/minimax-m3:free"),
		/**
		 * Small, fast model for the pre-model scope gate (PRD 10.8 layer 1).
		 * Runs on every inbound message, so it must stay cheap.
		 *
		 * NOT moved to a free tier, against the same owner direction, because
		 * measurement refused it. The gate calls `generateObject` under
		 * `maxOutputTokens: 120` (an owner-owned number, see scope.ts), and the
		 * route is fail-closed: a gate that cannot run returns 503, so a gate
		 * model that cannot emit the object breaks EVERY message. Measured
		 * 2026-09-06 02:2x through `checkScope` itself, at the 120-token cap:
		 * `nvidia/nemotron-3.5-lightning:free` (the candidate) degraded 7/7 with
		 * "No object generated: could not parse the response"; `openrouter/free`
		 * passed 3/12; `minimax/minimax-m3:free`, `minimax/minimax-m2.7:free` and
		 * `google/gemma-4-26b-a4b-it:free` degraded every trial; the two
		 * `thinkingmachines/inkling*:free` ids refuse non-agentic callers. Cause,
		 * confirmed by raising the cap in a probe: nemotron spends 247-1300 output
		 * tokens reasoning and then passes 4/4 at `maxOutputTokens: 1500`, so 120
		 * starves it. (`minimax/minimax-m3:free` fails the schema even at 1500.)
		 * The remaining 10 free ids are UNMEASURED: the account's shared
		 * free-models rate limit was exhausted by this sweep, which is itself the
		 * point — one machine probing free models exhausts the tier.
		 *
		 * TODO-OWNER: raise the gate's `maxOutputTokens` (scope.ts already flags
		 * it) to let a free reasoning model run here, or keep paying for this one.
		 */
		AGENT_GATE_MODEL: z.string().min(1).default("anthropic/claude-haiku-4.5"),

		/**
		 * Neynar API key for the "From Farcaster" rail (sent as the `x-api-key`
		 * header, docs.neynar.com/reference/search-casts).
		 *
		 * OPTIONAL by design: the app must run with no Farcaster account at all.
		 * When it is absent the rail renders an honest "not configured" line and
		 * makes no request — see apps/web/src/lib/farcaster/casts.ts. Server-only,
		 * never exposed to the browser.
		 */
		NEYNAR_API_KEY: z.string().optional(),

		/** Base mainnet RPC. Public endpoint works; a keyed provider is better under load. */
		BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
		THESIS_REFERRER: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0xd5E66B6d957C2d5e6C8c167707a49a029D1247dd"),
		/**
		 * OptionBook order feed. This is the only list-all-orders source: the SDK's
		 * filterOrders() is broken and its WebSocket host does not resolve. See PRD 11.
		 */
		THETANUTS_ORDERS_URL: z
			.string()
			.url()
			.default("https://round-snowflake-9c31.devops-118.workers.dev/"),
	},
	runtimeEnv: runtimeEnv,
	/**
	 * A-C5 (one-shot review 2026-09-06). `SKIP_ENV_VALIDATION` is a BUILD-TIME
	 * convenience — it lets a checkout typecheck or build without credentials —
	 * and it used to work in production too. Measured before the fix:
	 *
	 *   NODE_ENV=production DATA_SOURCE=db DATABASE_URL=fixture \
	 *   SESSION_SECRET=short SKIP_ENV_VALIDATION=1 bun -e '…'
	 *   -> {"mode":"production","source":"db","secretLength":5}
	 *
	 * `turbo.json` forwards the variable into builds and Vercel builds run with
	 * NODE_ENV=production, so one stray environment variable could have shipped a
	 * deployment whose env was never checked. `auth/secret.ts` and
	 * `data/source.ts` refuse independently, so this was not by itself a session
	 * forgery — but the fence has to hold on its own. The bypass is now ignored
	 * whenever NODE_ENV is production; read from `process.env` because the
	 * validated `env` does not exist yet at this point.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION && process.env.NODE_ENV !== "production",
	emptyStringAsUndefined: true,
});

// Keep the explicit build-time validation bypass consistent with createEnv:
// production ignores it there, so production ignores it here.
if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production (at least 32 characters)");
}
