/**
 * B-m6 + A-C1/CL-1 + A-C2. The live-database fence in `test/setup.ts` (the bun
 * preload), which is `packages/db/src/test-fence.ts`. The suites here INSERT and
 * DELETE rows and an env file can name the database they run against, so the
 * fence refuses anything that is not a loopback host, refuses every parameter
 * that could move the destination, and refuses to treat an env file's value as
 * the operator's choice.
 *
 * The last group runs the REAL preload in a child process with a REAL temporary
 * env file, because the bug this closes was invisible to any in-process test:
 * the fence passed on a value that had not been resolved yet.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { testDatabaseUrlRefusal } from "./setup";

const REMOTE = "postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/fold_money";

describe("test database fence", () => {
	test("loopback hosts are allowed", () => {
		for (const url of [
			LOCAL,
			"postgresql://postgres:postgres@localhost:54322/x",
			"postgresql://postgres:postgres@LOCALHOST:54322/x",
			"postgres://postgres:postgres@127.0.0.1:5432/x",
			"postgresql://postgres:postgres@[::1]:54322/x",
			"postgresql://postgres:postgres@0.0.0.0:54322/x",
		]) {
			expect(testDatabaseUrlRefusal(url, undefined)).toBeNull();
		}
	});

	test("a remote host is refused and the message names it", () => {
		const refusal = testDatabaseUrlRefusal(REMOTE, undefined);
		expect(refusal).not.toBeNull();
		expect(refusal).toContain("db.abcdefghijkl.supabase.co");
		expect(refusal).toContain("TEST_DATABASE_OK=1");
	});

	test("other non-loopback hosts are refused too", () => {
		for (const url of [
			"postgresql://u:p@10.0.0.5:5432/x",
			"postgresql://u:p@127.0.0.1.evil.example:5432/x",
			"postgresql://u:p@localhost.evil.example:5432/x",
			"postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
		]) {
			expect(testDatabaseUrlRefusal(url, undefined)).not.toBeNull();
		}
	});

	test("an unparseable URL is refused rather than assumed local", () => {
		expect(testDatabaseUrlRefusal("not a url", undefined)).toContain("not a parseable URL");
	});

	test("an unset or empty URL is the offline mode and is allowed", () => {
		expect(testDatabaseUrlRefusal(undefined, undefined)).toBeNull();
		expect(testDatabaseUrlRefusal("", undefined)).toBeNull();
		expect(testDatabaseUrlRefusal("   ", undefined)).toBeNull();
	});

	test("TEST_DATABASE_OK=1 is the deliberate override; anything else is not", () => {
		expect(testDatabaseUrlRefusal(REMOTE, "1")).toBeNull();
		expect(testDatabaseUrlRefusal(REMOTE, "true")).not.toBeNull();
		expect(testDatabaseUrlRefusal(REMOTE, "0")).not.toBeNull();
		expect(testDatabaseUrlRefusal(REMOTE, "")).not.toBeNull();
	});
});

/**
 * A-C2. `options` (and `port`, `dbname`, `database`) used to pass this fence
 * while `drizzle.config.ts` refused them, so `?options=-c search_path=other`
 * relocated every unqualified statement with the printed target unchanged. One
 * shared list now, compared lower-cased: `?HOST=` used to pass too.
 */
for (const parameter of [
	"host",
	"hostaddr",
	"port",
	"dbname",
	"database",
	"options",
	"connectionString",
	"service",
	"servicefile",
	"HOST",
	"OPTIONS",
]) {
	test(`refuses destination override ${parameter}`, () => {
		expect(testDatabaseUrlRefusal(`postgresql://u:p@127.0.0.1/x?${parameter}=remote.example`, undefined)).toContain(`"${parameter}"`);
		expect(testDatabaseUrlRefusal(`postgresql://u:p@127.0.0.1/x?${parameter}=`, undefined)).toContain(`"${parameter}"`);
	});
}
test("percent-encoded override names are caught after URLSearchParams decodes them", () => {
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x?%6fptions=-c%20search_path%3Dother", undefined)).not.toBeNull();
});
test("plain loopback and harmless sslmode remain allowed", () => {
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x", undefined)).toBeNull();
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x?sslmode=disable", undefined)).toBeNull();
});

/**
 * A-C1 / CL-1, end to end. The preload is executed for real, in a child whose
 * working directory holds a temporary `.env` — the same two paths that fill the
 * value in production: bun reads the cwd's `.env` itself, and `@nuts/env/load`
 * reads it again for a cwd that has none.
 *
 * The temporary directory lives under `node_modules` so nothing it leaves behind
 * can ever show up in `git status`.
 */
const webRoot = resolve(new URL("..", import.meta.url).pathname);
const scratch = mkdtempSync(resolve(webRoot, "node_modules/.database-fence-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs the REAL preload, then prints the DATABASE_URL the suites would see. */
function runPreload(envFileBody: string, shellEnv: Record<string, string | undefined>) {
	writeFileSync(resolve(scratch, ".env"), envFileBody);
	const environment: Record<string, string | undefined> = { ...process.env, ...shellEnv };
	const result = Bun.spawnSync(
		[process.execPath, "--preload", resolve(webRoot, "test/setup.ts"), "-e", "console.log('RESOLVED=' + JSON.stringify(process.env.DATABASE_URL))"],
		{ cwd: scratch, env: environment as Record<string, string>, stdout: "pipe", stderr: "pipe" },
	);
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const UNSET = { DATABASE_URL: undefined, DIRECT_DATABASE_URL: undefined, SKIP_ENV_VALIDATION: undefined, TEST_DATABASE_OK: undefined, PGOPTIONS: undefined };

describe("the preload fences the RESOLVED database, not the one it was started with", () => {
	test("a remote URL that only an env file supplies refuses the whole run", () => {
		const result = runPreload("DATABASE_URL=postgresql://u:p@db.example.com:5432/x\n", UNSET);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("db.example.com");
		expect(result.stderr).toContain("TEST_DATABASE_OK=1");
		expect(result.stdout).not.toContain("RESOLVED=");
	});

	test("a destination override that only an env file supplies refuses the whole run", () => {
		const result = runPreload("DATABASE_URL=postgresql://u:p@127.0.0.1:54322/x?options=-c%20search_path%3Dother\n", UNSET);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('"options"');
	});

	test("PGOPTIONS refuses the run: pg applies it to every connection", () => {
		const result = runPreload("DATABASE_URL=postgresql://u:p@127.0.0.1:54322/x\n", { ...UNSET, PGOPTIONS: "-c search_path=other" });
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("PGOPTIONS");
	});

	test("a loopback URL that only an env file supplies is NOT a selection: offline, so the live suites skip", () => {
		const result = runPreload("DATABASE_URL=postgresql://u:p@127.0.0.1:54322/from_env_file\n", UNSET);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe('RESOLVED=""');
		expect(result.stderr).toContain("IGNORED");
	});

	test("a URL the operator passed IS a selection and survives untouched", () => {
		const chosen = "postgresql://u:p@127.0.0.1:54322/chosen_by_hand";
		const result = runPreload("DATABASE_URL=postgresql://u:p@127.0.0.1:54322/from_env_file\n", { ...UNSET, DATABASE_URL: chosen });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(`RESOLVED=${JSON.stringify(chosen)}`);
	});

	test("TEST_DATABASE_OK=1 lets a remote env file through the fence and still refuses to select it", () => {
		const result = runPreload("DATABASE_URL=postgresql://u:p@db.example.com:5432/x\n", { ...UNSET, TEST_DATABASE_OK: "1" });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe('RESOLVED=""');
	});
});
