import { expect, test } from "bun:test";

/**
 * A fully VALID production environment, so each case isolates the one rule it is
 * about — `dataSource()` — instead of tripping over env validation.
 *
 * The explicit values also stop a developer's `.env` (or bun's own loading of
 * it) from supplying either key. They were `DATABASE_URL: ""` with
 * `SKIP_ENV_VALIDATION: "1"` until A-C5 made that bypass inert in production;
 * the URL is a fixture that is never connected to, since `dataSource()` reads
 * only `DATA_SOURCE` and `NODE_ENV`.
 */
const VALID_ENV = {
	DATABASE_URL: "postgresql://user:pw@127.0.0.1:5432/fixture",
	SESSION_SECRET: "x".repeat(32),
	SKIP_ENV_VALIDATION: "1",
};

// Each process imports the real env schema afresh; no global module mocks.
for (const mode of ["development", "production"] as const) {
	for (const source of ["", "mock", "db"]) {
		test(`${mode} DATA_SOURCE=${source || "unset"}`, () => {
			const result = Bun.spawnSync([process.execPath, "--eval", 'const { dataSource } = await import("./src/lib/data/source.ts"); console.log(dataSource());'], {
				cwd: new URL("../../..", import.meta.url).pathname,
				env: { ...process.env, ...VALID_ENV, NODE_ENV: mode, DATA_SOURCE: source },
				stdout: "pipe", stderr: "pipe",
			});
			if (mode === "production" && source !== "db") {
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr.toString()).toContain("Production requires DATA_SOURCE=db");
			} else {
				expect(result.exitCode).toBe(0);
				expect(result.stdout.toString().trim()).toBe(source === "db" ? "db" : "mock");
			}
		});
	}
}

test("the production build phase is NOT exempt: fixtures must never be prerendered into a production build", () => {
	const run = (extra: Record<string, string>) =>
		Bun.spawnSync([process.execPath, "--eval", 'const { dataSource } = await import("./src/lib/data/source.ts"); console.log(dataSource());'], {
			cwd: new URL("../../..", import.meta.url).pathname,
			env: { ...process.env, ...VALID_ENV, NODE_ENV: "production", DATA_SOURCE: "mock", ...extra },
			stdout: "pipe", stderr: "pipe",
		});
	for (const phase of ["phase-production-build", "phase-production-server"]) {
		const result = run({ NEXT_PHASE: phase });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Production requires DATA_SOURCE=db");
	}
	const db = run({ NEXT_PHASE: "phase-production-build", DATA_SOURCE: "db" });
	expect(db.exitCode).toBe(0);
	expect(db.stdout.toString().trim()).toBe("db");
});
