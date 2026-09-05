/**
 * A2-1 (one-shot review pass 2). `scripts/verify.ts` announces the database it
 * is about to verify against. It redacted the URL's AUTHORITY
 * (`://user:pass@` → `://***@`) and printed the rest verbatim, so a password
 * carried in the QUERY reached stdout — and `pg` honours that query: measured
 * 2026-09-06 against the installed `pg`,
 * `new pg.Client({ connectionString: "postgresql://user@127.0.0.1:54322/x?password=S" })`
 * produced `{"host":"127.0.0.1","database":"x","queryPasswordUsed":true}`, so it
 * is a real credential, not a decorative parameter.
 *
 * This file lives in `packages/env` for the same reason
 * `sync-vercel-env.test.ts` does: `bun run verify` runs `bun test` in
 * `packages/env` and never in the repository root, so a test under `scripts/`
 * would never execute.
 *
 * No database is touched. `Bun.spawn` is stubbed inside the child: the first
 * call returns a canned migration-probe result, every later call throws, which
 * makes `verify` print its FAIL table and exit. That is enough to reach — and
 * only just past — the announcement line under test.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = new URL("../../../", import.meta.url).pathname;

/** Never a real value; every assertion below proves it is not printed. */
const QUERY_PASSWORD = "REVIEWFAKESECRETQUERY";
const AUTHORITY_PASSWORD = "REVIEWFAKESECRETAUTHORITY";

/**
 * Stubs `Bun.spawn` before importing the script, exactly as the reviewer's
 * reproduction did, and returns everything the run wrote.
 */
const HARNESS = `
process.argv = [process.execPath, "scripts/verify.ts"];
let calls = 0;
Bun.spawn = () => {
  if (calls++) throw new Error("TEST STOP: no verification steps are spawned here");
  return {
    stdout: new Response("9 migrations applied\\n").body,
    stderr: new Response("").body,
    exited: Promise.resolve(0),
  };
};
await import("./scripts/verify.ts");
`;

function runVerify(databaseUrl: string): string {
	const child = Bun.spawnSync([process.execPath, "--no-env-file", "-e", HARNESS], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PATH: process.env.PATH ?? "",
			HOME: process.env.HOME ?? "",
			DATABASE_URL: databaseUrl,
			DIRECT_DATABASE_URL: "",
		},
	});
	return `${child.stdout.toString()}${child.stderr.toString()}`;
}

test("the announcement names the destination and prints no credential from the query", () => {
	const output = runVerify(
		`postgresql://user:${AUTHORITY_PASSWORD}@127.0.0.1:54322/verify_run?password=${QUERY_PASSWORD}&sslmode=disable`,
	);
	// It reached the line under test at all.
	expect(output).toContain("Verifying against");
	expect(output).toContain("9 migrations applied");
	// The destination an operator needs, and nothing else.
	expect(output).toContain("host 127.0.0.1");
	expect(output).toContain("port 54322");
	expect(output).toContain("database verify_run");
	// Neither password, in either position.
	expect(output).not.toContain(QUERY_PASSWORD);
	expect(output).not.toContain(AUTHORITY_PASSWORD);
	// Not the query at all: `pg` reads more than `password` out of it.
	expect(output).not.toContain("?password=");
	expect(output).not.toContain("sslmode=disable");
	expect(output).not.toContain("user:");
});

test("an IPv6 loopback destination is announced without brackets being mangled", () => {
	const output = runVerify(`postgresql://user:${AUTHORITY_PASSWORD}@[::1]:54322/verify_run`);
	expect(output).toContain("Verifying against");
	expect(output).toContain("host [::1]");
	expect(output).toContain("port 54322");
	expect(output).toContain("database verify_run");
	expect(output).not.toContain(AUTHORITY_PASSWORD);
});

test("the script under test is the repository's own, not a copy", () => {
	expect(Bun.file(join(repoRoot, "scripts/verify.ts")).size).toBeGreaterThan(0);
});
