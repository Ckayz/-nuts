import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { endingSoon, getFollowStates, leaderboard, listActivity, settled, trending, type Database } from "./reads";
import { ACTIVITY_PAGE_SIZE } from "./constants";

const id = "00000000-0000-4000-8000-000000000001";
function capture() {
	const queries: { text: string; values: unknown[] }[] = [];
	const database = drizzle({ query: async (query: { text: string }, values: unknown[]) => {
		queries.push({ text: query.text, values });
		return { rows: [] };
	} } as never) as Database;
	return { database, queries };
}
for (const [name, read] of [["trending", trending], ["ending", endingSoon], ["settled", settled]] as const) {
	test(`${name} emits SQL LIMIT after ORDER BY`, async () => {
		const { database, queries } = capture();
		await read({ database, limit: 2 });
		expect(queries[0]!.text).toMatch(/order by[\s\S]+limit \$\d+/i);
		expect(queries[0]!.values.at(-1)).toBe(2);
	});
}
test("leaderboard emits SQL LIMIT after aggregation and ranking", async () => {
	const { database, queries } = capture();
	await leaderboard({ database, window: "1W", limit: 2 });
	expect(queries[0]!.text).toMatch(/group by[\s\S]+order by[\s\S]+nulls last[\s\S]+limit \$\d+/i);
	expect(queries[0]!.values.at(-1)).toBe(2);
});
test("follow states use one SQL query for the complete deduplicated set", async () => {
	const { database, queries } = capture();
	await getFollowStates(id, [id, id, "00000000-0000-4000-8000-000000000002"], { database });
	expect(queries).toHaveLength(1);
	expect(queries[0]!.text).toContain("exists(select 1");
	expect(queries[0]!.values).toEqual([id, id, "00000000-0000-4000-8000-000000000002"]);
});
test("listActivity emits SQL LIMIT after ORDER BY, defaulting to the page size", async () => {
	const { database, queries } = capture();
	await listActivity(id, { database, limit: 2 });
	expect(queries[0]!.text).toMatch(/order by[\s\S]+limit \$\d+/i);
	expect(queries[0]!.values.at(-1)).toBe(2);

	const fallback = capture();
	await listActivity(id, { database: fallback.database });
	expect(fallback.queries[0]!.text).toMatch(/order by[\s\S]+limit \$\d+/i);
	expect(fallback.queries[0]!.values.at(-1)).toBe(ACTIVITY_PAGE_SIZE);
});
