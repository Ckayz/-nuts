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
		NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

		/** OpenRouter key for the agent's model calls. Server-only, never exposed. */
		OPENROUTER_API_KEY: z.string().min(1),
		/** Primary model for agent turns. */
		AGENT_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4.5"),
		/**
		 * Small, fast model for the pre-model scope gate (PRD 10.8 layer 1).
		 * Runs on every inbound message, so it must stay cheap.
		 */
		AGENT_GATE_MODEL: z.string().min(1).default("anthropic/claude-haiku-4.5"),

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
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
