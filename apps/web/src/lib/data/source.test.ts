import { expect, test } from "bun:test";

// Each process imports the real env schema afresh; no global module mocks.
for (const mode of ["development", "production"] as const) {
	for (const source of ["", "mock", "db"]) {
		test(`${mode} DATA_SOURCE=${source || "unset"}`, () => {
			const result = Bun.spawnSync([process.execPath, "--eval", 'const { dataSource } = await import("./src/lib/data/source.ts"); console.log(dataSource());'], {
				cwd: new URL("../../..", import.meta.url).pathname,
				env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1", NODE_ENV: mode, DATA_SOURCE: source },
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
