import { existsSync, readFileSync } from "node:fs";
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
// `.env.<NODE_ENV>` sits between them because BUN loads it too (`bun test` runs
// with NODE_ENV=test): pass-5 lane A (2026-09-06) measured that an
// `apps/web/.env.test` was invisible to `envFileValues()`, so the test-database
// fence read its value as a human's choice and the destructive suites ran
// (record.integration 37 pass instead of 3 pass / 35 skip). The same order Bun
// uses: `.env.local`, then `.env.<NODE_ENV>`, then `.env`.
const nodeEnvFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : null;
const candidates = [
	resolve(process.cwd(), ".env.local"),
	...(nodeEnvFile ? [resolve(process.cwd(), nodeEnvFile)] : []),
	resolve(process.cwd(), ".env"),
	resolve(webEnvDir, ".env.local"),
	...(nodeEnvFile ? [resolve(webEnvDir, nodeEnvFile)] : []),
	resolve(webEnvDir, ".env"),
];

let loaded = false;

function existingCandidates(): string[] {
	return [...new Set(candidates)].filter((p) => existsSync(p));
}

export function loadEnvFiles(): void {
	if (loaded) return;
	loaded = true;

	const paths = existingCandidates();
	if (paths.length > 0) dotenv.config({ path: paths, quiet: true });
}

/**
 * What the env FILES alone would supply, with the same precedence, and without
 * touching `process.env`.
 *
 * The test fence (`packages/db/src/test-fence.ts`) needs to tell "the operator
 * chose this database" from "an env file happened to name one". It cannot do
 * that by reading `process.env` alone: bun loads the current directory's `.env`
 * into the process environment itself, BEFORE any preload runs (measured
 * 2026-09-06: `cd apps/web && env -u DATABASE_URL bun -e 'console.log(...)'`
 * prints the file's value; `bun --no-env-file` prints undefined). So by the time
 * any code runs, a file-supplied value is indistinguishable from a shell-supplied
 * one unless the files are read back and compared — which is what this does.
 */
export function envFileValues(): Record<string, string> {
	const values: Record<string, string> = {};
	// `candidates` is highest priority first and dotenv keeps the FIRST value it
	// sees, so build the effective map lowest-priority first and let higher
	// priority overwrite.
	for (const path of existingCandidates().reverse()) {
		Object.assign(values, dotenv.parse(readFileSync(path)));
	}
	return values;
}

loadEnvFiles();
