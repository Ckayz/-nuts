/**
 * The shared destination fence (`../src/test-fence.ts`) as this package's
 * preload uses it. `apps/web/test/database-fence.test.ts` covers the same
 * function from the other side; the child-process case at the bottom is the one
 * that is only reachable from here.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { testDatabaseUrlRefusal } from "./setup";

/**
 * A-C2. `options`, `port`, `dbname` and `database` used to pass this fence while
 * `drizzle.config.ts` refused them; names were also compared case-sensitively,
 * so `?HOST=` passed. One shared list now, compared lower-cased.
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
test("plain loopback and harmless sslmode remain allowed", () => {
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x", undefined)).toBeNull();
	expect(testDatabaseUrlRefusal("postgresql://u:p@127.0.0.1/x?sslmode=disable", undefined)).toBeNull();
});

/**
 * A-C1 / CL-1, the half that is only observable here: the fence must run AFTER
 * `@nuts/env/load`, not before it.
 *
 * `packages/db` is where that ordering is load-bearing. In `apps/web` bun loads
 * the working directory's `.env` into the process environment before any preload
 * module is evaluated, so the value is already present whichever order the
 * preload uses. Here — and in any working directory that has no env file of its
 * own — it is `@nuts/env/load`'s `dotenv.config`, called by the preload itself,
 * that supplies it. `--no-env-file` reproduces exactly that: bun loads nothing,
 * the loader loads the temporary file, and a preload that fenced
 * `process.env.DATABASE_URL` before calling the loader would see `undefined`,
 * call it offline, and let the deleting suites run against `db.example.com`.
 */
const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const scratch = mkdtempSync(resolve(packageRoot, "node_modules/.database-fence-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Runs the REAL preload in a child whose only env file is `scratch/.env`, and
 * reports what the fence left behind.
 */
function runPreload(envFileUrl: string, exported: string | undefined): { code: number; stderr: string; resolved: string } {
	writeFileSync(resolve(scratch, ".env"), `DATABASE_URL=${envFileUrl}\n`);
	const environment: Record<string, string | undefined> = {
		...process.env,
		DATABASE_URL: exported,
		DIRECT_DATABASE_URL: undefined,
		TEST_DATABASE_OK: undefined,
		PGOPTIONS: undefined,
	};
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--no-env-file",
			"--preload",
			resolve(packageRoot, "test/setup.ts"),
			"-e",
			"console.log('RESOLVED=' + process.env.DATABASE_URL)",
		],
		{ cwd: scratch, env: environment as Record<string, string>, stdout: "pipe", stderr: "pipe" },
	);
	return {
		code: result.exitCode,
		stderr: result.stderr.toString(),
		resolved: result.stdout.toString().replace(/^RESOLVED=/m, "").trim(),
	};
}

/**
 * A2-3 / CL-8 (one-shot review pass 2). "The operator selected this database" is
 * decided by the value DIFFERING from the env file's, and equality cannot tell an
 * export from an inheritance. That is the safe direction — the run skips rather
 * than deleting rows in a database nobody chose — but the operator who copied the
 * file's own URL into their shell used to be told "No DATABASE_URL was passed to
 * this run", which is not what happened. The skip stays; the sentence has to be
 * true, and has to say what to do instead.
 *
 * Measured while writing these tests: "exported the file's value" and "exported
 * nothing" reach that branch IDENTICALLY, because by then the env file has been
 * read into the environment either way (`Bun.spawnSync` with `DATABASE_URL:
 * undefined` really does unset it in the child — probed both ways — and the
 * loader puts the file's value back). So the message is asserted for BOTH, and it
 * may not claim which of the two happened.
 */
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

for (const [label, exported] of [
	["exporting the env file's own value", LOCAL_URL],
	["exporting nothing at all", undefined],
] as const) {
	test(`${label} skips the live suites AND says why`, () => {
		const { code, stderr, resolved } = runPreload(LOCAL_URL, exported);
		expect(code).toBe(0);
		// Fail-closed: the live suites' own `if (!databaseUrl) skip` gates see "".
		expect(resolved).toBe("");
		expect(stderr).toContain("DATABASE_URL is exactly the value this repository's env file supplies");
		expect(stderr).toContain("the live suites SKIP");
		expect(stderr).toContain("Export a DIFFERENT value");
		// The claim that used to be printed here was false for the first case.
		expect(stderr).not.toContain("No DATABASE_URL was passed");
	});
}

test("exporting a DIFFERENT loopback value runs the live suites, silently", () => {
	const throwaway = "postgresql://postgres:postgres@127.0.0.1:54322/fence_throwaway";
	const { code, stderr, resolved } = runPreload(LOCAL_URL, throwaway);
	expect(code).toBe(0);
	expect(resolved).toBe(throwaway);
	expect(stderr).not.toContain("env file supplies");
	expect(stderr).not.toContain("SKIP");
});

test("a remote URL the LOADER supplies refuses the run (the fence must run after the loader)", () => {
	writeFileSync(resolve(scratch, ".env"), "DATABASE_URL=postgresql://u:p@db.example.com:5432/x\n");
	const environment: Record<string, string | undefined> = {
		...process.env,
		DATABASE_URL: undefined,
		DIRECT_DATABASE_URL: undefined,
		TEST_DATABASE_OK: undefined,
		PGOPTIONS: undefined,
	};
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--no-env-file",
			"--preload",
			resolve(packageRoot, "test/setup.ts"),
			"-e",
			"console.log('RESOLVED=' + JSON.stringify(process.env.DATABASE_URL))",
		],
		{ cwd: scratch, env: environment as Record<string, string>, stdout: "pipe", stderr: "pipe" },
	);
	expect(result.exitCode).toBe(1);
	expect(result.stderr.toString()).toContain("db.example.com");
	expect(result.stdout.toString()).not.toContain("RESOLVED=");
});
