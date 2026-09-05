import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { schemaKeys } from "../src/schema-keys";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function entries(source: string): [string, string][] {
  return source.split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return [];
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) throw new Error("Invalid env example assignment");
    return [[match[1]!, match[2]!]];
  });
}
function secretLike(value: string): boolean {
  if (/sk-|[a-f0-9]{64}/i.test(value)) return true;
  const urls = value.match(/postgres(?:ql)?:\/\/[^\s"']+/gi) ?? [];
  return urls.some((raw) => {
    try {
      const url = new URL(raw);
      return !!url.password && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    } catch { return true; }
  });
}
test("example keys exactly match server and web schemas without duplicates", () => {
  const expected = [...schemaKeys(read("../src/server.ts")), ...schemaKeys(read("../src/web.ts"))].sort();
  expect(expected.length).toBeGreaterThan(0);
  const actual = entries(read("../../../apps/web/.env.example")).map(([key]) => key).sort();
  expect(actual).toEqual(expected);
  expect(new Set(actual).size).toBe(actual.length);
});
test("example assignments contain no secret-shaped values", () => {
  for (const [key, value] of entries(read("../../../apps/web/.env.example"))) {
    expect(secretLike(value), key).toBe(false);
  }
});
test("secret guard rejects API keys, private keys and remote database credentials", () => {
  expect(secretLike("sk-" + "fixture")).toBe(true);
  expect(secretLike("a".repeat(64))).toBe(true);
  expect(secretLike("postgres://user:password@remote.invalid/db")).toBe(true);
  expect(secretLike("postgresql://user:password@remote.invalid/db")).toBe(true);
  expect(secretLike("postgres://user:password@localhost/db")).toBe(false);
  expect(secretLike("")).toBe(false);
});
