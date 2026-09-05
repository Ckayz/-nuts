import { expect, test } from "bun:test";
import { EMPTY_FEED, following, followingRows, top, type RankedReaders } from "./feeds";
import { btcNfp, solLoses100, ethPrints2500 } from "@/mock/data";
import type { Thesis } from "@/types";
import type { RankedReadOptions } from "../data/reads";

function row(id: string, creatorUserId: string, createdAt: string): Thesis {
 return { ...btcNfp, id, creatorUserId, thesis: { ...btcNfp.thesis, id, createdAt } };
}

/**
 * A stand-in for the three ranked reads. It applies exactly the two predicates
 * `rankedTheses` applies in SQL — the creator restriction and the ranking's own
 * eligible statuses — and only THEN the cap, which is the ordering the whole
 * B-P3-1 finding is about.
 */
function readers(rows: Thesis[], limit: number): RankedReaders {
 const read = (statuses: readonly string[]) => async (options: RankedReadOptions = {}) =>
  rows
   .filter(r => options.creatorIds === undefined || options.creatorIds.includes(r.creatorUserId))
   .filter(r => statuses.includes(r.thesis.status))
   .filter(r => options.statuses === undefined || options.statuses.includes(r.thesis.status))
   .slice(0, options.limit ?? limit);
 return { trending: read(["open", "settled"]), ending: read(["open"]), settled: read(["settled"]) };
}

const VIEWER = "b1110000-0000-4000-8000-000000000001";
const followsOne = { select: () => ({ from: () => ({ where: async () => [{ id: "followed" }] }) }) } as unknown as import("../data/reads").Database;

test("followingRows keeps membership and never re-orders the ranking's list", () => {
 const rows = [row("b", "followed", "2026-09-01T00:00:00Z"), row("z", "other", "2026-09-05T00:00:00Z"),
 row("c", "followed", "2026-09-03T00:00:00Z"), row("a", "followed", "2026-09-01T00:00:00Z")];
 // The reader's order is the ranking's order, and this preserves it: the feed
 // has always rendered the ranking's order, never the cohort's.
 expect(followingRows(rows, ["followed"]).map(row => row.id)).toEqual(["b", "c", "a"]);
 expect(followingRows(rows, [])).toEqual([]);
 expect(rows[0]?.id).toBe("b");
});

test("anonymous and malformed viewers have no following feed", async () => {
 expect(await following()).toEqual(EMPTY_FEED);
 expect(await following({ viewerUserId: "invalid" })).toEqual(EMPTY_FEED);
});

test("Top preserves each reader's order and passes the viewer options through", async () => {
 const options = { viewerUserId: "viewer" };
 const seen: RankedReadOptions[] = [];
 const feed = await top(options, {
  trending: async received => { seen.push(received ?? {}); return [solLoses100, ethPrints2500, btcNfp]; },
  ending: async received => { seen.push(received ?? {}); return [btcNfp]; },
  settled: async received => { seen.push(received ?? {}); return [solLoses100]; },
 });
 expect(feed.trending.map(r => r.id)).toEqual([solLoses100.id, ethPrints2500.id, btcNfp.id]);
 expect(feed.ending.map(r => r.id)).toEqual([btcNfp.id]);
 expect(feed.settled.map(r => r.id)).toEqual([solLoses100.id]);
 // The scope each ranking is read with, pinned: the Trending pill keeps the
 // audience's existing open-only scope (TODO-OWNER, carried unchanged), while
 // Ending and Settled carry NO override — forcing "open" on the settled read is
 // what made Following/Top + Settled empty by construction.
 expect(seen).toEqual([{ ...options, statuses: ["open"] }, options, options]);
});

/**
 * B-P3-1, the reviewer's own probe. Seven eligible posts, a cap of six, and the
 * ONE followed author's post ranked seventh globally. Measured before the fix:
 *   READER {"global":["post-0",…,"post-5"],"following":["post-6"]}
 *   ALL_RENDERED 6      FOLLOWING_RENDERED 0
 */
test("a followed author's post outside the GLOBAL top six is still in Following", async () => {
 const rows = Array.from({ length: 7 }, (_, i) => row(String(i), i === 6 ? "followed" : "other", "2026-09-01T00:00:00Z"));
 const read = readers(rows, 6);
 expect((await read.trending()).map(r => r.id)).toEqual(["0", "1", "2", "3", "4", "5"]);
 const feed = await following({ database: followsOne, viewerUserId: VIEWER }, read);
 expect(feed.trending.map(r => r.id)).toEqual(["6"]);
 expect((await top({}, read)).trending.map(r => r.id)).toEqual(["0", "1", "2", "3", "4", "5"]);
});

test("Following and Top can show SETTLED posts; they used to be always empty", async () => {
 const rows = [
  { ...row("s1", "followed", "2026-09-01T00:00:00Z"), thesis: { ...btcNfp.thesis, id: "s1", status: "settled" as const } },
  { ...row("o1", "followed", "2026-09-02T00:00:00Z"), thesis: { ...btcNfp.thesis, id: "o1", status: "open" as const } },
 ];
 const read = readers(rows, 6);
 const feed = await following({ database: followsOne, viewerUserId: VIEWER }, read);
 expect(feed.settled.map(r => r.id)).toEqual(["s1"]);
 expect(feed.ending.map(r => r.id)).toEqual(["o1"]);
 expect((await top({}, read)).settled.map(r => r.id)).toEqual(["s1"]);
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

/**
 * The other half of B-P3-1: the SETTLED read must accept a creator restriction
 * at all. `endingSoon` and `settled` used to take only `{ limit }`, so the
 * Following audience could not be read for them.
 */
test("the settled and ending reads restrict by creator inside the same query as the limit", async () => {
 const { settled: settledRead, endingSoon } = await import("../data/reads");
 const { PgDialect } = await import("drizzle-orm/pg-core");
 const creator = "b1110000-0000-4000-8000-000000000002";
 for (const read of [settledRead, endingSoon]) {
  let predicate: import("drizzle-orm").SQL | undefined;
  let limited: number | undefined;
  const query = {
   from: () => query, innerJoin: () => query, leftJoin: () => query,
   where: (value: import("drizzle-orm").SQL) => { predicate = value; return query; },
   orderBy: () => query, limit: async (value: number) => { limited = value; return []; },
  };
  const database = { select: () => query } as unknown as import("../data/reads").Database;
  await read({ database, creatorIds: [creator] });
  expect(new PgDialect().sqlToQuery(predicate!).params).toContain(creator);
  expect(limited).toBe((await import("../data/constants")).RANKED_THESIS_LIMIT);
 }
});
