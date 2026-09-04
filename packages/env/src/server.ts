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

// Exposed for future URL-derived env (CORS/auth origins); unused today.
export const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
	...process.env,
};

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	},
	runtimeEnv: runtimeEnv,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
