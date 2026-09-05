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
/**
 * A-C5. The bypass is a build-time convenience for a checkout without
 * credentials. It must NOT reach production: turbo forwards the variable into
 * builds and a Vercel build runs with NODE_ENV=production, so one stray value
 * would have shipped a deployment whose env was never validated. Measured
 * before the fix: production + SKIP_ENV_VALIDATION=1 + a 5-character secret
 * exited 0.
 */
test("the build validation bypass still works outside production", () => {
  for (const nodeEnv of ["development", "test"]) {
    const result = validate(nodeEnv, "short", "mock", "1");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("mock");
  }
});
test("production IGNORES the build validation bypass", () => {
  const result = validate("production", "", "mock", "1");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("SESSION_SECRET is required in production");
});
test("production ignores the bypass for every other invalid value too", () => {
  // A too-short secret is a schema failure, not the explicit throw above.
  const short = validate("production", "x".repeat(31), "db", "1");
  expect(short.exitCode).not.toBe(0);
  expect(short.stderr.toString()).toContain("Invalid environment variables");
});
test("a fully valid production env still passes with the bypass set", () => {
  const result = validate("production", "x".repeat(32), "db", "1");
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("db");
});
