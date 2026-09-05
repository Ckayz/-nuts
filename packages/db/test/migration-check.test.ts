/**
 * A-C4. `scripts/verify.ts` fence 3 claims the selected database carries
 * EXACTLY this tree's migrations. It used to exit 1 only on a MISSING hash and
 * merely LOG extras, so a database migrated from a different tree passed. The
 * five cases the reviewer measured in memory are pinned here.
 */
import { describe, expect, test } from "bun:test";
import { migrationMismatches } from "../src/migration-check";

const A = { tag: "0000_a", hash: "aaaa" };
const B = { tag: "0001_b", hash: "bbbb" };
const EXPECTED = [A, B];

describe("migrationMismatches", () => {
	test("exact: no problems", () => {
		expect(migrationMismatches(EXPECTED, ["aaaa", "bbbb"])).toEqual([]);
	});

	test("missing: names the tag", () => {
		const problems = migrationMismatches(EXPECTED, ["aaaa"]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toBe("1 migration(s) not applied: 0001_b");
	});

	test("wrong: a changed hash is both missing and unknown", () => {
		const problems = migrationMismatches(EXPECTED, ["aaaa", "bbbX"]);
		expect(problems.join(" | ")).toContain("not applied: 0001_b");
		expect(problems.join(" | ")).toContain("unknown to this tree: bbbX");
	});

	test("extra: an unknown hash refuses instead of being logged", () => {
		const problems = migrationMismatches(EXPECTED, ["aaaa", "bbbb", "cccc"]);
		expect(problems).toEqual(["1 applied migration(s) unknown to this tree: cccc"]);
	});

	test("duplicate: a hash recorded twice refuses", () => {
		const problems = migrationMismatches(EXPECTED, ["aaaa", "bbbb", "bbbb"]);
		expect(problems).toEqual(["1 migration hash(es) recorded more than once: bbbb"]);
	});

	test("an empty database is every migration missing, not silence", () => {
		expect(migrationMismatches(EXPECTED, [])).toEqual(["2 migration(s) not applied: 0000_a, 0001_b"]);
	});

	test("order is not compared: drizzle's own id column carries it", () => {
		expect(migrationMismatches(EXPECTED, ["bbbb", "aaaa"])).toEqual([]);
	});
});

/**
 * The real journal against a synthetic "one migration too many" database: the
 * parked `agent_hedge_rules` branch's `0009` is exactly the shape this fence has
 * to refuse.
 */
test("this tree's own journal: exact passes, one extra hash refuses", async () => {
	const { createHash } = await import("node:crypto");
	const { readFileSync } = await import("node:fs");
	const { resolve } = await import("node:path");
	const dir = resolve(new URL("..", import.meta.url).pathname, "src/migrations");
	const journal = JSON.parse(readFileSync(resolve(dir, "meta/_journal.json"), "utf8")) as {
		entries: { tag: string }[];
	};
	const expected = journal.entries.map((entry) => ({
		tag: entry.tag,
		hash: createHash("sha256").update(readFileSync(resolve(dir, `${entry.tag}.sql`))).digest("hex"),
	}));
	expect(expected.length).toBeGreaterThan(0);
	expect(migrationMismatches(expected, expected.map((entry) => entry.hash))).toEqual([]);
	const withExtra = [...expected.map((entry) => entry.hash), "0".repeat(64)];
	expect(migrationMismatches(expected, withExtra)).toEqual([
		`1 applied migration(s) unknown to this tree: ${"0".repeat(64)}`,
	]);
});
