import { expect, test } from "bun:test";

function validate(nodeEnv, secret, source, skip = "") {
  return Bun.spawnSync([process.execPath, "-e", 'const { env } = await import("./src/server.ts"); console.log(env.DATA_SOURCE)'], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: nodeEnv, SESSION_SECRET: secret, DATA_SOURCE: source, SKIP_ENV_VALIDATION: skip, DATABASE_URL: "postgresql://localhost/test", OPENROUTER_API_KEY: "test-placeholder" },
    stdout: "pipe", stderr: "pipe",
  });
}
for (const nodeEnv of ["development", "test"]) test(`${nodeEnv} accepts absent session secret and defaults to mock`, () => {
  const result = validate(nodeEnv, "", "");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("mock");
});
test("production requires session secret", () => {
  const result = validate("production", "", "db");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("SESSION_SECRET is required in production");
});
test("present secret must have at least 32 characters", () => {
  expect(validate("test", "short", "mock").exitCode).not.toBe(0);
  expect(validate("production", "x".repeat(31), "db").exitCode).not.toBe(0);
});
test("production accepts 32 characters and db mode", () => {
  const result = validate("production", "x".repeat(32), "db");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("db");
});
test("invalid data source fails", () => {
  expect(validate("test", "", "invalid").exitCode).not.toBe(0);
});
test("explicit build validation bypass remains available", () => {
  expect(validate("production", "", "mock", "1").exitCode).toBe(0);
});
