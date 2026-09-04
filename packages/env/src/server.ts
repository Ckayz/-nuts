import "dotenv/config";
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

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
	...process.env,
};

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
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
