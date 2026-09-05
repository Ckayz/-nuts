/**
 * Push environment variables from a local env file to a Vercel environment.
 *
 * This script is fail-CLOSED. Before this round it read `apps/web/.env`, sent
 * EVERY key it found (minus three) with `vercel env add --force --yes`, and only
 * printed a WARNING when a value looked local. On the owner's machine that file
 * holds loopback `DATABASE_URL`, the production database password and both
 * production connection strings — so the documented deploy command would have
 * overwritten production `DATABASE_URL` with `127.0.0.1` and uploaded secrets
 * that no deployed code reads. Four refusals replace that warning:
 *
 *  1. ALLOWLIST — only keys in the validated schemas (`@nuts/env/schema-keys`)
 *     are ever sent. Everything else is skipped, by NAME only.
 *  2. LOCAL VALUES — any value that would be pushed matching the local pattern
 *     refuses the whole run (exit 1) before a single `vercel` call.
 *  3. EMPTY IN PRODUCTION — an empty value targeting `production` refuses the
 *     whole run.
 *  4. `--yes` — `vercel env add --force` OVERWRITES. Without an explicit `--yes`
 *     the script prints the key names it would change and exits 1.
 *
 * `--dry-run` prints the plan (key names and value LENGTHS) and never calls
 * Vercel. Refusals 1-3 run BEFORE it, so a local or empty value refuses even a
 * dry run — measured 2026-09-06 against the owner's own `apps/web/.env`. No secret value is ever written to stdout or stderr by this script;
 * values reach `vercel` only through the child's stdin.
 *
 * Usage:
 *   bun run env:preview                     # plan only; refuses without --yes
 *   bun run env:production -- --dry-run
 *   bun run env:production -- --yes
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { validatedEnvKeys } from "@nuts/env/schema-keys";
import dotenv from "dotenv";

const DEFAULT_ENVIRONMENT = "preview";
const VALID_ENVIRONMENTS = new Set(["development", "preview", "production"]);
const VERCEL_COMMAND = ["bunx", "vercel"] as const;
const DEFAULT_FILES = ["apps/web/.env"];
/**
 * Denied on top of the schema allowlist. Only `NODE_ENV` is load-bearing — it IS
 * a schema key and Vercel sets it itself. `BETTER_AUTH_URL` and `CORS_ORIGIN`
 * are carried over from the previous version of this script and are redundant
 * now: measured 2026-09-06, neither appears in `validatedEnvKeys()`, so the
 * allowlist already drops them. TODO-OWNER: confirm this deny list.
 */
const SKIP_KEYS = new Set(["BETTER_AUTH_URL", "CORS_ORIGIN", "NODE_ENV"]);
/**
 * Values that must never reach a deployed environment.
 *
 * The substring pattern is the fallback for values that are not URLs. It is not
 * enough on its own: A-C3 (one-shot review 2026-09-06) measured the real script
 * accepting `postgresql://u:p@[::1]:5432/postgres` for `production --dry-run`
 * (`exit 0`, "would sync 1 env var") while the `127.0.0.1` fixture exited 1 —
 * IPv6 loopback is not in the pattern, and neither are `127.0.0.2`, `0177.1` or
 * `[0:0:0:0:0:0:0:1]`. So any value that PARSES as a URL is judged by its
 * hostname instead, which the URL parser has already normalised.
 */
const LOCAL_VALUE_PATTERN = /localhost|127\.0\.0\.1|0\.0\.0\.0|^file:/i;
/** Hostnames, after URL normalisation, that a deployed environment can never reach. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::1]", "[::]"]);

/**
 * True when this hostname resolves on the machine that ran the script and
 * nowhere else. `new URL(...).hostname` keeps IPv6 literals bracketed and
 * lower-cases everything, so the bracketed forms are what this compares.
 */
function isLoopbackHostname(host: string): boolean {
	if (LOOPBACK_HOSTNAMES.has(host)) return true;
	// The whole 127.0.0.0/8 block, not just 127.0.0.1.
	if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
	// Any written form of ::1 or ::, e.g. [0:0:0:0:0:0:0:1].
	if (host.startsWith("[") && host.endsWith("]")) {
		const address = host.slice(1, -1);
		const groups = address.includes("::")
			? (() => {
					const [head = "", tail = ""] = address.split("::", 2);
					const left = head === "" ? [] : head.split(":");
					const right = tail === "" ? [] : tail.split(":");
					return [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
				})()
			: address.split(":");
		if (groups.length === 8 && groups.every((group) => /^0*[01]$/.test(group))) {
			return groups.every((group) => /^0*$/.test(group)) || groups.slice(0, 7).every((group) => /^0*$/.test(group));
		}
	}
	return false;
}

/** True when the value would point a deployed environment at the machine that ran this script. */
function isLocalValue(value: string): boolean {
	try {
		if (isLoopbackHostname(new URL(value).hostname.toLowerCase())) return true;
	} catch {
		// Not a URL: only the substring pattern below can speak.
	}
	// `file:` URLs carry no host, and non-URL values still need the old reach.
	return LOCAL_VALUE_PATTERN.test(value);
}
/** TODO-OWNER: exit code for a refused run. 1 chosen so a pipeline stops. */
const REFUSAL_EXIT_CODE = 1;

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");
const scriptArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex);
const forwardedArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);

const environment =
	scriptArgs[0] && VALID_ENVIRONMENTS.has(scriptArgs[0]) ? scriptArgs[0] : DEFAULT_ENVIRONMENT;
const remainingArgs = scriptArgs.slice(VALID_ENVIRONMENTS.has(scriptArgs[0] ?? "") ? 1 : 0);

// Our own flags are consumed here so they are never forwarded to Vercel. Note
// that `vercel env add` gets its own `--yes` (skip its prompt) unconditionally
// below; that flag and this gate are different things.
const OWN_FLAGS = new Set(["--yes", "--dry-run"]);
const ownFlags = new Set<string>();
// Split the rest into env-file paths and passthrough Vercel CLI flags. A bare
// token counts as a file only when it exists on disk, so flags and their values
// (e.g. `--scope my-team`) forward correctly regardless of argument order.
const files: string[] = [];
const passthroughArgs: string[] = [];
for (const arg of [...remainingArgs, ...forwardedArgs]) {
	if (OWN_FLAGS.has(arg)) ownFlags.add(arg);
	else if (!arg.startsWith("-") && existsSync(arg)) files.push(arg);
	else passthroughArgs.push(arg);
}
const dryRun = ownFlags.has("--dry-run");
const confirmed = ownFlags.has("--yes");
const vercelArgs = passthroughArgs;
const envFiles = files.length > 0 ? files : DEFAULT_FILES;

function refuse(lines: string[]): never {
	console.error(`Refusing to sync to Vercel ${environment}:`);
	for (const line of lines) console.error(`  - ${line}`);
	console.error("No Vercel command was run. Fix the env file (or pass an explicit file) and re-run.");
	process.exit(REFUSAL_EXIT_CODE);
}

const parsed = new Map<string, string>();
for (const file of envFiles) {
	if (!existsSync(file)) {
		console.warn(`Skipping missing env file: ${file}`);
		continue;
	}
	for (const [key, value] of Object.entries(dotenv.parse(readFileSync(file, "utf8")))) {
		parsed.set(key, value);
	}
}

if (parsed.size === 0) {
	console.log("No Vercel env vars found to sync.");
	process.exit(0);
}

// Fence 1: the allowlist. Derived from the schema sources, so a key the app
// cannot read is never uploaded, whatever the env file holds.
const allowed = new Set(validatedEnvKeys().filter((key) => !SKIP_KEYS.has(key)));
const push = new Map<string, string>();
const skipped: string[] = [];
for (const [key, value] of parsed) {
	if (allowed.has(key)) push.set(key, value);
	else skipped.push(key);
}
if (skipped.length > 0) {
	console.log(
		`Skipping ${skipped.length} key(s) outside the validated env schema (names only, values not read): ${skipped.sort().join(", ")}`,
	);
}
if (push.size === 0) {
	console.log("No schema-validated env vars found to sync.");
	process.exit(0);
}

// Fences 2 and 3: refuse, never warn. Key names only — never a value.
const refusals: string[] = [];
const localKeys = [...push.entries()]
	.filter(([, value]) => isLocalValue(value))
	.map(([key]) => key)
	.sort();
if (localKeys.length > 0) {
	refusals.push(
		`local-only value(s) — a loopback host (localhost, 127.0.0.0/8, ::1, 0.0.0.0) or file: — in ${localKeys.join(", ")}. A deployed environment cannot reach those.`,
	);
}
if (environment === "production") {
	const emptyKeys = [...push.entries()]
		.filter(([, value]) => value.trim() === "")
		.map(([key]) => key)
		.sort();
	if (emptyKeys.length > 0) {
		refusals.push(`empty value(s), which production must not receive, in ${emptyKeys.join(", ")}.`);
	}
}
if (refusals.length > 0) refuse(refusals);

const keyNames = [...push.keys()].sort();
if (dryRun) {
	console.log(`Dry run — would sync ${push.size} env var(s) to Vercel ${environment}:`);
	for (const key of keyNames) console.log(`  ${key}  (${push.get(key)?.length ?? 0} chars)`);
	console.log("No Vercel command was run.");
	process.exit(0);
}

// Fence 4: `vercel env add --force` overwrites whatever is already set.
if (!confirmed) {
	console.error(
		`Refusing to overwrite ${push.size} env var(s) in Vercel ${environment} without --yes.`,
	);
	for (const key of keyNames) console.error(`  ${key}`);
	console.error("Re-run with --yes to overwrite these keys, or --dry-run to inspect the plan.");
	process.exit(REFUSAL_EXIT_CODE);
}

console.log(`Syncing ${push.size} env var(s) to Vercel ${environment}: ${keyNames.join(", ")}`);
for (const key of keyNames) {
	const value = push.get(key) ?? "";
	const result = spawnSync(
		VERCEL_COMMAND[0],
		[
			...VERCEL_COMMAND.slice(1),
			"env",
			"add",
			key,
			environment,
			"--force",
			"--yes",
			"--non-interactive",
			...vercelArgs,
		],
		{
			input: `${value}\n`,
			stdio: ["pipe", "inherit", "inherit"],
			encoding: "utf8",
			// Windows resolves bunx/npx/pnpm via .cmd shims, which need a shell
			shell: process.platform === "win32",
		},
	);

	if (result.error) {
		console.error(`Failed to sync ${key}: ${result.error.message}`);
		process.exit(1);
	}

	if (result.status !== 0) {
		console.error(`Failed to sync ${key}`);
		process.exit(result.status ?? 1);
	}
}

console.log("Vercel env sync complete. Redeploy for changes to take effect.");
