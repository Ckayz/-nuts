/**
 * `turbo.json`'s build env list against the validated schemas.
 *
 * Turbo 2's default env mode is STRICT: a variable that is not named in
 * `tasks.build.env` is stripped from the build's environment. `packages/env`
 * validates at import time, so a variable missing from that list is invisible to
 * `next build` -- and because the two that were missing (`RFQ_KEY_MASTER_KEY`,
 * `AGENT_HEALTH_PROBE_TOKEN`) are `.optional()`, the build validated cleanly and
 * the failure only appeared at runtime. Nothing asserted the parity, which is
 * why it drifted (A-2).
 *
 * The list is a SUPERSET by design -- `SKIP_ENV_VALIDATION` is a build knob and
 * not a schema key -- so this is a subset assertion, not an equality.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { schemaKeys } from "../src/schema-keys";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function buildEnv(): string[] {
  const turbo = JSON.parse(read("../../../turbo.json")) as { tasks?: { build?: { env?: unknown } } };
  const env = turbo.tasks?.build?.env;
  if (!Array.isArray(env) || !env.every((entry) => typeof entry === "string")) {
    throw new Error("turbo.json tasks.build.env is not a list of names");
  }
  return env as string[];
}

test("every validated env key is visible to a turbo build", () => {
  const schema = [...schemaKeys(read("../src/server.ts")), ...schemaKeys(read("../src/web.ts"))];
  expect(schema.length).toBeGreaterThan(0);
  const declared = buildEnv();
  expect(schema.filter((key) => !declared.includes(key))).toEqual([]);
});

/** The two that drifted, named so a rename cannot quietly drop them. */
test("the RFQ master key and the health probe token are both declared", () => {
  const declared = buildEnv();
  expect(declared).toContain("RFQ_KEY_MASTER_KEY");
  expect(declared).toContain("AGENT_HEALTH_PROBE_TOKEN");
});

test("the build env list has no duplicates", () => {
  const declared = buildEnv();
  expect(new Set(declared).size).toBe(declared.length);
});

/**
 * The runbook an operator configures Vercel from has a row for every server key.
 * The table is `| NAME | ... |` rows; the header and separator are skipped.
 */
test("docs/DEPLOY.md documents every server env key", () => {
  const documented = new Set(
    read("../../../docs/DEPLOY.md")
      .split(/\r?\n/)
      .map((line) => /^\|\s*([A-Z][A-Z0-9_]*)\s*\|/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  const missing = schemaKeys(read("../src/server.ts")).filter((key) => !documented.has(key));
  expect(missing).toEqual([]);
});
