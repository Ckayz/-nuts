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
