import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { follows, likes, comments, theses, users } from "@nuts/db/schema/index";
import { following, top } from "./feeds";
import { trending } from "../data/reads";
if (!process.env.DATABASE_URL) {
 console.log("feeds integration skipped: DATABASE_URL is not set");
 test.skip("following/top integration requires DATABASE_URL", () => {});
} else {
 const { db } = await import("@nuts/db");
 test("following fences creators and drafts; Top ranks real engagement and preserves viewer likes", async () => {
  const rollback = new Error("rollback feeds probe");
  const viewer = "b1110000-0000-4000-8000-000000000001", creator = "b1110000-0000-4000-8000-000000000002";
  const old = "b2220000-0000-4000-8000-000000000001", recent = "b2220000-0000-4000-8000-000000000002";
  const draft = "b2220000-0000-4000-8000-000000000003", other = "b2220000-0000-4000-8000-000000000004";
  try { await db.transaction(async tx => {
   await tx.insert(users).values([
    { id: viewer, walletAddress: "0x00000000000000000000000000000000feed9101" },
    { id: creator, walletAddress: "0x00000000000000000000000000000000feed9102" },
   ]);
   await tx.insert(theses).values([
    { id: old, slug: "feeds-old-example", headline: "Old", creatorUserId: creator, status: "open", createdAt: new Date(1000) },
    { id: recent, slug: "feeds-recent-example", headline: "Recent", creatorUserId: creator, status: "open", createdAt: new Date(2000) },
    { id: draft, slug: "feeds-draft-example", headline: "Draft", creatorUserId: creator, status: "draft" },
    { id: other, slug: "feeds-other-example", headline: "Other", creatorUserId: viewer, status: "open", createdAt: new Date(3000) },
   ]);
   await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
   const options = { database: tx, viewerUserId: viewer };
   expect(await following(options)).toEqual([]);
   await tx.insert(follows).values({ followerUserId: viewer, followedUserId: creator });
   expect((await following(options)).map(row => row.id)).toEqual([recent, old]);
   expect(await following({ database: tx })).toEqual([]);
   await tx.insert(likes).values({ userId: viewer, thesisId: recent });
   await tx.insert(comments).values([{ userId: viewer, thesisId: old, body: "One" }, { userId: creator, thesisId: old, body: "Two" }]);
   const ids = (rows: { id: string }[]) => rows.filter(row => [old, recent, draft, other].includes(row.id)).map(row => row.id);
   const ranked = await top(options);
   expect(ids(ranked)).toEqual([old, recent, other]);
   expect(ids(ranked)).toEqual(ids(await trending(options)));
   expect(ranked.find(row => row.id === recent)?.likedByViewer).toBe(true);
   expect((await following(options)).find(row => row.id === recent)?.likedByViewer).toBe(true);
   throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
 });
 test("rank-seven eligible posts survive Following and Top SQL caps", async () => {
  const rollback = new Error("rollback rank-seven probe");
  try { await db.transaction(async tx => {
   const viewer = "b3330000-0000-4000-8000-000000000001";
   const creator = "b3330000-0000-4000-8000-000000000002";
   await tx.insert(users).values([
    { id: viewer, walletAddress: "0x00000000000000000000000000000000feed9301" },
    { id: creator, walletAddress: "0x00000000000000000000000000000000feed9302" },
   ]);
   const ids = Array.from({ length: 7 }, (_, i) => `b4440000-0000-4000-8000-00000000000${i + 1}`);
   await tx.insert(theses).values(ids.map((id, i) => ({
    id, slug: `rank-seven-${i}`, headline: `Rank ${i}`, creatorUserId: i === 6 ? creator : viewer,
    status: "open" as const,
   })));
   await tx.insert(comments).values(ids.slice(0, 6).map(thesisId => ({ thesisId, userId: viewer, body: "Higher engagement" })));
   await tx.insert(follows).values({ followerUserId: viewer, followedUserId: creator });
   const options = { database: tx, viewerUserId: viewer };
   // Other integration files may leave committed open posts behind, so assert
   // membership, not exact lists: the seventh-ranked eligible post must survive.
   const trendingIds = (await trending(options)).map(r => r.id);
   expect(trendingIds).toHaveLength(6);
   expect(trendingIds).not.toContain(ids[6]!);
   expect((await following(options)).map(r => r.id)).toEqual([ids[6]!]);
   await tx.execute(sql`update theses set status = 'settled' where creator_user_id = ${viewer}`);
   expect((await top(options)).map(r => r.id)).toContain(ids[6]!);
   throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
 });

}
