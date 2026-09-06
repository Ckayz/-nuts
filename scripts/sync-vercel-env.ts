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
 *  3. DESTINATION OVERRIDES — a value that parses as a URL and carries one of
 *     the shared `DESTINATION_OVERRIDE_PARAMETERS` query parameters refuses the
 *     whole run, whatever its authority says.
 *  4. EMPTY IN PRODUCTION — an empty value targeting `production` refuses the
 *     whole run.
 *  5. `--yes` — `vercel env add --force` OVERWRITES. Without an explicit `--yes`
 *     the script prints the key names it would change and exits 1.
 *
 * `--dry-run` prints the plan (key names and value LENGTHS) and never calls
 * Vercel. Refusals 1-4 run BEFORE it, so a local, redirected or empty value
 * refuses even a dry run — measured 2026-09-06 against the owner's own
 * `apps/web/.env`. No secret value is ever written to stdout or stderr by this
 * script; values reach `vercel` only through the child's stdin.
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
// ONE list, shared with both bun-test preloads, `scripts/verify.ts` and
// `packages/db/drizzle.config.ts`. Imported by relative path because the root
// workspace does not depend on `@nuts/db`; `test-fence.ts` has no imports of its
// own for exactly that reason. See `packages/db/src/test-fence.ts`.
import { DESTINATION_OVERRIDE_PARAMETERS } from "../packages/db/src/test-fence";

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
 * hostname instead.
 *
 * A2-2 (pass 2 of the same review) corrected the sentence that used to end that
 * paragraph — "which the URL parser has already normalised". It has not:
 * `postgresql:` is not one of the URL standard's special schemes, so
 * `new URL("postgresql://u:p@127.1/x").hostname` stays `127.1` where
 * `new URL("http://127.1").hostname` becomes `127.0.0.1`. The hostname is
 * therefore normalised HERE, the way the OS resolver does it, before it is
 * judged: see `parseIPv4` and `parseIPv6` below.
 */
const LOCAL_VALUE_PATTERN = /localhost|127\.0\.0\.1|0\.0\.0\.0|^file:/i;
/** Named hostnames, after URL normalisation, that a deployed environment can never reach. */
const LOOPBACK_HOSTNAMES = new Set(["localhost"]);

/**
 * One part of a dotted address, in any base the OS resolver accepts: decimal,
 * octal (a leading `0`) or hexadecimal (a leading `0x`). Returns null when the
 * part is not a number at all, which is how a real hostname exits.
 */
function parseIPv4Part(part: string): number | null {
	let value: number;
	if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = Number.parseInt(part.slice(2), 16);
	else if (/^0[0-7]+$/.test(part)) value = Number.parseInt(part.slice(1), 8);
	else if (/^(0|[1-9][0-9]*)$/.test(part)) value = Number.parseInt(part, 10);
	else return null;
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * A2-2 (one-shot review pass 2). `inet_aton`, which is what the OS resolver
 * actually applies to a numeric host: one to four parts, each decimal, octal or
 * hexadecimal, and the LAST part absorbs every octet the earlier ones did not
 * name. So `127.1`, `0177.1`, `2130706433` and `0x7f000001` are all 127.0.0.1.
 *
 * Measured 2026-09-06 before this change: `production --dry-run` with
 * `postgresql://u:fixture@127.1:5432/x` exited 0 and planned the sync, as did
 * `0177.1`, `2130706433`, `0x7f000001`, `127.0.1` and `[::ffff:7f00:1]`, while
 * the `127.0.0.1` spelling exited 1. `new URL("http://127.1").hostname`
 * canonicalises to `127.0.0.1`, but the `postgresql:` scheme is not special to
 * the URL parser, so that normalisation never happens here.
 *
 * Returns the 32-bit address, or null when the host is not a numeric IPv4 in any
 * of those spellings. No DNS: a name that is not itself an address is left to
 * the substring pattern.
 */
function parseIPv4(host: string): number | null {
	const parts = host.split(".");
	if (parts.length > 4) return null;
	const values: number[] = [];
	for (const part of parts) {
		const value = parseIPv4Part(part);
		if (value === null) return null;
		values.push(value);
	}
	const last = values[values.length - 1];
	if (last === undefined) return null;
	const leading = values.slice(0, -1);
	if (leading.some((value) => value > 0xff)) return null;
	// The final part covers the remaining octets: 4 parts → 8 bits, 1 part → 32.
	if (last >= 2 ** (8 * (4 - leading.length))) return null;
	let address = last;
	for (const [index, value] of leading.entries()) address += value * 2 ** (8 * (3 - index));
	return address;
}

/** 127.0.0.0/8 (every loopback address) and 0.0.0.0 (this host, any interface). */
function isLoopbackIPv4(address: number): boolean {
	return Math.floor(address / 2 ** 24) === 127 || address === 0;
}

/**
 * An IPv6 literal expanded to its eight 16-bit groups, including the embedded
 * IPv4 form (`::ffff:127.0.0.1`). Returns null when it does not parse.
 */
function parseIPv6(address: string): number[] | null {
	let text = address;
	const dotted = /:(\d+(?:\.\d+){3})$/.exec(text);
	if (dotted?.[1] !== undefined) {
		const octets = dotted[1].split(".").map((part) => Number.parseInt(part, 10));
		if (octets.some((octet) => !Number.isInteger(octet) || octet > 0xff)) return null;
		const [a = 0, b = 0, c = 0, d = 0] = octets;
		text = `${text.slice(0, dotted.index + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (chunk: string): number[] | null => {
		if (chunk === "") return [];
		const groups: number[] = [];
		for (const group of chunk.split(":")) {
			if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
			groups.push(Number.parseInt(group, 16));
		}
		return groups;
	};
	const left = parse(halves[0] ?? "");
	if (left === null) return null;
	if (halves.length === 1) return left.length === 8 ? left : null;
	const right = parse(halves[1] ?? "");
	if (right === null) return null;
	const fill = 8 - left.length - right.length;
	if (fill < 0) return null;
	return [...left, ...Array<number>(fill).fill(0), ...right];
}

/**
 * `::1` and `::` in any spelling, plus both embedded-IPv4 forms — IPv4-mapped
 * (`::ffff:7f00:1`, the spelling the reviewer's fixture used) and the deprecated
 * IPv4-compatible (`::7f00:1`) — judged by the IPv4 rule above.
 */
function isLoopbackIPv6(groups: number[]): boolean {
	const zeroThrough = (count: number) => groups.slice(0, count).every((group) => group === 0);
	if (zeroThrough(8)) return true;
	if (zeroThrough(7) && groups[7] === 1) return true;
	if (zeroThrough(5) && (groups[5] === 0 || groups[5] === 0xffff)) {
		return isLoopbackIPv4((groups[6] ?? 0) * 0x10000 + (groups[7] ?? 0));
	}
	return false;
}

/**
 * A4-1 (one-shot review pass 4). `postgresql:` is not one of the URL standard's
 * special schemes, so `new URL(...).hostname` hands back the authority host with
 * its percent-escapes INTACT, while `pg` decodes them. Measured 2026-09-06 with
 * the installed `pg@8.23.0`:
 *
 *   new URL("postgresql://u:p@%6cocalhost:5432/x").hostname  === "%6cocalhost"
 *   new pg.Client({connectionString: …}).connectionParameters.host === "localhost"
 *
 * and the same for `127.0.0.%31` (pg: `127.0.0.1`) and `%5B%3A%3A1%5D`
 * (pg: `[::1]`). All three exited 0 and planned a production sync before this
 * fold. One decode — never a loop — is what matches the driver: a
 * double-encoded `%256cocalhost` stays `%6cocalhost` for both.
 *
 * A malformed escape (`%zz`, a lone `%`) makes `decodeURIComponent` throw; the
 * value is then judged exactly as it was written, which is what `pg` does too.
 */
function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * True when this hostname resolves on the machine that ran the script and
 * nowhere else. `new URL(...).hostname` keeps IPv6 literals bracketed and
 * lower-cases everything, so the bracketed forms are what this sees — after
 * `safeDecode`, since the parser leaves percent-escapes in place (see above).
 */
function isLoopbackHostname(host: string): boolean {
	if (LOOPBACK_HOSTNAMES.has(host)) return true;
	if (host.startsWith("[") && host.endsWith("]")) {
		const groups = parseIPv6(host.slice(1, -1));
		return groups !== null && isLoopbackIPv6(groups);
	}
	// An unbracketed IPv6 literal is not a legal URL host, but a raw env value
	// that never reached the URL parser can still be one.
	if (host.includes(":")) {
		const groups = parseIPv6(host);
		return groups !== null && isLoopbackIPv6(groups);
	}
	const address = parseIPv4(host);
	return address !== null && isLoopbackIPv4(address);
}

/** True when the value would point a deployed environment at the machine that ran this script. */
function isLocalValue(value: string): boolean {
	try {
		// Decode BEFORE lower-casing: `%5B` and `%5b` both decode to `[`, and the
		// judge below needs the delimiters the driver will see.
		if (isLoopbackHostname(safeDecode(new URL(value).hostname).toLowerCase())) return true;
	} catch {
		// Not a URL: only the substring pattern below can speak.
	}
	// `file:` URLs carry no host, and non-URL values still need the old reach.
	return LOCAL_VALUE_PATTERN.test(value);
}

/**
 * A3-1 (one-shot review pass 3). `isLocalValue` judges the URL's AUTHORITY
 * hostname, but `pg` reads a handful of query parameters that REPLACE that
 * destination, so a value whose authority is a perfectly deployable host can
 * still point production at the machine that ran this script. Measured
 * 2026-09-06 before this change: `production --dry-run` with
 * `postgresql://u:p@db.example.invalid:5432/x?host=%3A%3A1` exited 0 and planned
 * the sync, and the installed driver reported that value's effective host as
 * `::1` (`new pg.Client({connectionString}).connectionParameters`); `?host=`
 * with the integer spelling `2130706433` behaved the same way.
 *
 * Returns the offending parameter name AS WRITTEN (never its value — no env
 * value reaches stdout or stderr), or null. Judged for EVERY value that parses
 * as a URL rather than for a list of key names: the fence fails closed, and no
 * deployable value of any key in `validatedEnvKeys()` needs one of these
 * parameters. Values that are not URLs (API keys, model ids) cannot carry a
 * query at all and are unaffected.
 *
 * `URLSearchParams` keys are already percent-decoded, so `?%68ost=` is caught
 * — measured 2026-09-06: `[...new URL("postgresql://u:p@h/x?h%6fst=::1")
 * .searchParams.keys()]` is `["host"]`, and the `%68ost=` fixture below has been
 * refusing since A3-1. `safeDecode` is applied anyway so the name is judged the
 * way the hostname now is (A4-1); it can only ever ADD a refusal (a name written
 * `%2568ost`, which `pg` reads as the harmless `%68ost`), and this fence is
 * fail-closed by design — no deployable value of any key in `validatedEnvKeys()`
 * carries a percent-escaped `host`-shaped parameter name.
 *
 * The comparison is lower-cased like the shared fence's — `?HOST=` is
 * refused even though the installed `pg` happens to ignore that spelling today.
 * Measured the same day: a query written after a `#` (`…/x#?host=::1`) is a
 * fragment to BOTH parsers — `pg` keeps the authority host — so the two agree on
 * every fixture probed, and this check sees what the driver would apply.
 */
function destinationOverrideParameter(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null; // Not a URL: it carries no query parameters to obey.
	}
	for (const name of url.searchParams.keys()) {
		if ((DESTINATION_OVERRIDE_PARAMETERS as readonly string[]).includes(safeDecode(name).toLowerCase())) {
			return name;
		}
	}
	return null;
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
const overriddenKeys = [...push.entries()]
	.map(([key, value]) => [key, destinationOverrideParameter(value)] as const)
	.filter((entry): entry is readonly [string, string] => entry[1] !== null)
	.sort(([left], [right]) => left.localeCompare(right));
if (overriddenKeys.length > 0) {
	refusals.push(
		`destination-override query parameter(s) — ${overriddenKeys
			.map(([key, name]) => `${key} carries "${name}"`)
			.join(", ")}. \`pg\` obeys ${DESTINATION_OVERRIDE_PARAMETERS.join(", ")} over the host, port and database written in the URL, so the value's real destination is not the one it shows.`,
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
