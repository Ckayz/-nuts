import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

/**
 * Environment file loading for every entry point in the monorepo.
 *
 * Two problems this solves:
 *
 * 1. Next.js reads `.env.local` ahead of `.env`, but plain `dotenv/config` reads
 *    only `.env`. Without this, the web app and the drizzle CLI could see
 *    different values for the same variable.
 * 2. `dotenv` resolves relative to the current working directory, so a script run
 *    from `packages/db` used to find nothing. Files are located relative to this
 *    package instead, which is always `<repo>/packages/env`.
 *
 * Precedence matches Next.js: `.env.local` overrides `.env`. Real process
 * environment always wins over both, so Vercel and CI are unaffected.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const webEnvDir = resolve(repoRoot, "apps/web");

// Highest priority first: dotenv keeps the first value it sees for a given key.
const candidates = [
	resolve(process.cwd(), ".env.local"),
	resolve(process.cwd(), ".env"),
	resolve(webEnvDir, ".env.local"),
	resolve(webEnvDir, ".env"),
];

let loaded = false;

export function loadEnvFiles(): void {
	if (loaded) return;
	loaded = true;

	const paths = [...new Set(candidates)].filter((p) => existsSync(p));
	if (paths.length > 0) dotenv.config({ path: paths, quiet: true });
}

loadEnvFiles();
