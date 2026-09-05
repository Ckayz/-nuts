/**
 * `scripts/sync-vercel-env.ts` is a production-touching step: `vercel env add
 * --force` overwrites whatever a deployed environment already holds. These
 * tests pin its four refusals. They live here (not in `scripts/`) because
 * `bun run verify` runs `bun test` in `packages/env` and never in the repo root,
 * so a test under `scripts/` would never execute.
 *
 * Every case must stop BEFORE any `vercel` invocation, which is why none of them
 * needs a network or a Vercel login: the string "Syncing" is printed only on the
 * line immediately preceding the spawn loop, so its absence proves no key was
 * sent.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const script = join(repoRoot, "scripts/sync-vercel-env.ts");
const workDir = mkdtempSync(join(tmpdir(), "sync-vercel-env-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** Distinctive fake values; every assertion below proves none of them is printed. */
const SECRETS = {
	localPassword: "LOCALPASSWORDFIXTURE",
	remotePassword: "REMOTEPASSWORDFIXTURE",
	prodPassword: "PRODPASSWORDFIXTURE",
	sessionSecret: "SESSIONSECRETFIXTURE0123456789abcdef",
	openrouter: "OPENROUTERKEYFIXTURE",
};

function envFile(name: string, contents: string): string {
	const path = join(workDir, name);
	writeFileSync(path, contents);
	return path;
}

/** An env file shaped like the owner's: a loopback app URL plus non-schema PROD and SUPABASE keys. */
const localFile = envFile(
	"local.env",
	[
		`DATABASE_URL=postgresql://postgres:${SECRETS.localPassword}@127.0.0.1:54322/postgres`,
		`SESSION_SECRET=${SECRETS.sessionSecret}`,
		`OPENROUTER_API_KEY=${SECRETS.openrouter}`,
		`PROD_DIRECT_DATABASE_URL=postgresql://postgres:${SECRETS.prodPassword}@aws-0.pooler.example.invalid:5432/postgres`,
		`SUPABASE_PROD_DB_PASSWORD=${SECRETS.prodPassword}`,
	].join("\n"),
);

/** The same file with a deployable DATABASE_URL, so only the later fences can fire. */
const remoteFile = envFile(
	"remote.env",
	[
		`DATABASE_URL=postgresql://postgres:${SECRETS.remotePassword}@aws-0.pooler.example.invalid:6543/postgres`,
		`SESSION_SECRET=${SECRETS.sessionSecret}`,
		`OPENROUTER_API_KEY=${SECRETS.openrouter}`,
		`PROD_DIRECT_DATABASE_URL=postgresql://postgres:${SECRETS.prodPassword}@aws-0.pooler.example.invalid:5432/postgres`,
		`SUPABASE_PROD_DB_PASSWORD=${SECRETS.prodPassword}`,
	].join("\n"),
);

const emptyProdFile = envFile(
	"empty.env",
	[
		`DATABASE_URL=postgresql://postgres:${SECRETS.remotePassword}@aws-0.pooler.example.invalid:6543/postgres`,
		"SESSION_SECRET=",
	].join("\n"),
);

const runs: { output: string }[] = [];
function run(args: string[]): { code: number; output: string } {
	const child = Bun.spawnSync(["bun", script, ...args], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env },
	});
	const output = `${child.stdout.toString()}${child.stderr.toString()}`;
	runs.push({ output });
	return { code: child.exitCode, output };
}

test("refuses a loopback DATABASE_URL instead of warning, and runs no vercel command", () => {
	const { code, output } = run(["production", localFile]);
	expect(code).toBe(1);
	expect(output).toContain("Refusing to sync to Vercel production");
	expect(output).toContain("local-only value(s)");
	expect(output).toContain("DATABASE_URL");
	expect(output).toContain("No Vercel command was run.");
	expect(output).not.toContain("Syncing");
});

/**
 * A-C3. The reviewer's fixture: `production --dry-run` with an IPv6-loopback
 * DATABASE_URL exited 0 and planned the sync, while the `127.0.0.1` fixture
 * exited 1. Every form below is a host only the machine that ran the script can
 * reach, so every one of them must refuse.
 */
for (const [label, url] of [
	["ipv6 loopback", "postgresql://u:p@[::1]:5432/postgres"],
	["ipv6 loopback, expanded", "postgresql://u:p@[0:0:0:0:0:0:0:1]:5432/postgres"],
	["ipv6 unspecified", "postgresql://u:p@[::]:5432/postgres"],
	["127.0.0.0/8 beyond .1", "postgresql://u:p@127.0.0.2:5432/postgres"],
	["uppercase host", "postgresql://u:p@LOCALHOST:5432/postgres"],
	/**
	 * A2-2 (one-shot review pass 2). Every spelling below is 127.0.0.1 or
	 * 0.0.0.0 to the OS resolver (`inet_aton`: 1-4 parts, decimal/octal/hex, the
	 * last absorbing the remaining octets) and every one of them exited 0 and
	 * planned the sync before the fold — measured 2026-09-06 against the real
	 * script. `new URL("http://127.1").hostname` normalises to `127.0.0.1`, but
	 * `postgresql:` is not a special scheme, so the parser never does that here.
	 *
	 * `[::ffff:127.0.0.1]` is deliberately NOT in this list: the dotted tail
	 * makes the old substring pattern fire, so it would pass without any of the
	 * new parsing. `[::ffff:7f00:1]` is the same address written the way that
	 * pattern cannot see.
	 */
	["abbreviated ipv4", "postgresql://u:p@127.1:5432/postgres"],
	["three-part ipv4", "postgresql://u:p@127.0.1:5432/postgres"],
	["octal ipv4", "postgresql://u:p@0177.1:5432/postgres"],
	["integer ipv4", "postgresql://u:p@2130706433:5432/postgres"],
	["hexadecimal ipv4", "postgresql://u:p@0x7f000001:5432/postgres"],
	["integer unspecified", "postgresql://u:p@0:5432/postgres"],
	["hex ipv4-mapped ipv6", "postgresql://u:p@[::ffff:7f00:1]:5432/postgres"],
	["ipv4-compatible ipv6", "postgresql://u:p@[::7f00:1]:5432/postgres"],
] as const) {
	test(`refuses a ${label} value for production`, () => {
		const file = envFile(`loopback-${label.replace(/[^a-z0-9]+/gi, "-")}.env`, `DATABASE_URL=${url}\nSESSION_SECRET=${SECRETS.sessionSecret}\n`);
		const { code, output } = run(["production", file, "--dry-run"]);
		expect(code).toBe(1);
		expect(output).toContain("local-only value(s)");
		expect(output).toContain("DATABASE_URL");
		expect(output).not.toContain("Dry run");
		expect(output).not.toContain("Syncing");
	});
}

test("a deployable remote host is still accepted (the fence is not refusing everything)", () => {
	const { code, output } = run(["production", remoteFile, "--dry-run"]);
	expect(code).toBe(0);
	expect(output).toContain("Dry run");
	expect(output).not.toContain("local-only value(s)");
});

/**
 * The other direction of A2-2: the numeric parsing must not swallow reachable
 * hosts. `3232235777` is 192.168.1.1 and `8.8.8.8` is a public address — neither
 * is loopback, so neither is this fence's business.
 */
for (const [label, url] of [
	["dotted public ipv4", "postgresql://u:p@8.8.8.8:5432/postgres"],
	["integer non-loopback ipv4", "postgresql://u:p@3232235777:5432/postgres"],
	["global ipv6", "postgresql://u:p@[2001:db8::1]:5432/postgres"],
	["ordinary hostname", "postgresql://u:p@db.example.invalid:5432/postgres"],
] as const) {
	test(`accepts a ${label} value for production`, () => {
		const file = envFile(`remote-${label.replace(/[^a-z0-9]+/gi, "-")}.env`, `DATABASE_URL=${url}\nSESSION_SECRET=${SECRETS.sessionSecret}\n`);
		const { code, output } = run(["production", file, "--dry-run"]);
		expect(code).toBe(0);
		expect(output).toContain("Dry run");
		expect(output).not.toContain("local-only value(s)");
	});
}

test("skips keys outside the validated schema, naming them without reading their values", () => {
	const { code, output } = run(["production", remoteFile, "--dry-run"]);
	expect(code).toBe(0);
	expect(output).toContain("outside the validated env schema");
	expect(output).toContain("PROD_DIRECT_DATABASE_URL");
	expect(output).toContain("SUPABASE_PROD_DB_PASSWORD");
	// The plan lists only schema keys.
	const plan = output.slice(output.indexOf("Dry run"));
	expect(plan).toContain("DATABASE_URL");
	expect(plan).toContain("SESSION_SECRET");
	expect(plan).not.toContain("PROD_DIRECT_DATABASE_URL");
	expect(plan).not.toContain("SUPABASE_PROD_DB_PASSWORD");
	expect(output).not.toContain("Syncing");
});

test("refuses to overwrite without --yes, listing the keys it would change", () => {
	const { code, output } = run(["production", remoteFile]);
	expect(code).toBe(1);
	expect(output).toContain("without --yes");
	expect(output).toContain("DATABASE_URL");
	expect(output).toContain("SESSION_SECRET");
	expect(output).not.toContain("Syncing");
});

test("refuses an empty value when the target environment is production", () => {
	const production = run(["production", emptyProdFile]);
	expect(production.code).toBe(1);
	expect(production.output).toContain("empty value(s), which production must not receive");
	expect(production.output).toContain("SESSION_SECRET");
	// The same file is not refused for preview; the --yes gate stops it instead.
	const preview = run(["preview", emptyProdFile]);
	expect(preview.code).toBe(1);
	expect(preview.output).not.toContain("must not receive");
	expect(preview.output).toContain("without --yes");
});

test("no env value reaches stdout or stderr in any of the runs above", () => {
	expect(runs.length).toBeGreaterThan(0);
	for (const { output } of runs) {
		for (const [name, secret] of Object.entries(SECRETS)) {
			expect(output.includes(secret), `${name} leaked`).toBe(false);
		}
	}
});
