import { expect, test } from "bun:test";
import { following, followingRows, top } from "./feeds";
import { btcNfp, solLoses100, ethPrints2500 } from "@/mock/data";
import type { Thesis } from "@/types";
function row(id: string, creatorUserId: string, createdAt: string): Thesis {
 return { ...btcNfp, id, creatorUserId, thesis: { ...btcNfp.thesis, id, createdAt } };
}
test("following filters creators and non-open posts, orders newest first and breaks ties by ID", () => {
 const rows = [row("b", "followed", "2026-09-01T00:00:00Z"), row("z", "other", "2026-09-05T00:00:00Z"),
 row("c", "followed", "2026-09-03T00:00:00Z"), row("a", "followed", "2026-09-01T00:00:00Z"), { ...ethPrints2500, creatorUserId: "followed" }];
 expect(followingRows(rows, ["followed"]).map(row => row.id)).toEqual(["c", "a", "b"]);
 expect(followingRows(rows, [])).toEqual([]);
 expect(rows[0]?.id).toBe("b");
});
test("anonymous and malformed viewers have no following feed", async () => {
 expect(await following()).toEqual([]);
 expect(await following({ viewerUserId: "invalid" })).toEqual([]);
});
test("Top preserves the engagement reader's order and viewer options within the feed scope", async () => {
 const options = { viewerUserId: "viewer" };
 expect((await top(options, async received => {
  expect(received).toEqual({ ...options, statuses: ["open"] });
  return [solLoses100, ethPrints2500, btcNfp];
 })).map(row => row.id)).toEqual([solLoses100.id, btcNfp.id]);
});

// Seven fixtures deliberately exceed the existing ranked-read default cap.
test("Following and Top apply eligibility before the ranked reader cap", async () => {
 const { RANKED_THESIS_LIMIT } = await import("../data/constants");
 const viewerUserId = "b1110000-0000-4000-8000-000000000001";
 const rows = Array.from({ length: 7 }, (_, i) => row(String(i), i === 6 ? "followed" : "other", "2026-09-01T00:00:00Z"));
 const database = { select: () => ({ from: () => ({ where: async () => [{ id: "followed" }] }) }) } as unknown as import("../data/reads").Database;
 const read: typeof import("../data/reads").trending = async (options = {}) => rows
  .filter(r => options.creatorIds === undefined || options.creatorIds.includes(r.creatorUserId))
  .filter(r => options.statuses === undefined || options.statuses.includes(r.thesis.status))
  .slice(0, options.limit ?? RANKED_THESIS_LIMIT);
 expect((await following({ database, viewerUserId }, read)).map(r => r.id)).toEqual(["6"]);
 for (const r of rows.slice(0, 6)) r.thesis.status = "settled";
 expect((await top({}, read)).map(r => r.id)).toEqual(["6"]);
 expect(await read()).toHaveLength(RANKED_THESIS_LIMIT);
});

test("ranked SQL includes eligibility predicates before its limit and keeps public scope", async () => {
 const { trending } = await import("../data/reads");
 const { PgDialect } = await import("drizzle-orm/pg-core");
 let queries = 0;
 let predicate: import("drizzle-orm").SQL | undefined;
 const query = {
  from: () => query, innerJoin: () => query, leftJoin: () => query,
  where: (value: import("drizzle-orm").SQL) => { predicate = value; return query; },
  orderBy: () => query, limit: async () => [],
 };
 const database = { select: () => { queries++; return query; } } as unknown as import("../data/reads").Database;
 await trending({ database, creatorIds: [] });
 await trending({ database, statuses: [] });
 expect(queries).toBe(0);
 const creator = "b1110000-0000-4000-8000-000000000002";
 await trending({ database, creatorIds: [creator], statuses: ["open"] });
 const compiled = new PgDialect().sqlToQuery(predicate!);
 expect(compiled.sql).toContain('"theses"."creator_user_id" in');
 expect(compiled.params).toEqual([...(await import("../data/constants")).PUBLIC_THESIS_STATUSES, creator, "open"]);
 expect(queries).toBe(1);
});
