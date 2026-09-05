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
  expect(received).toBe(options);
  return [solLoses100, ethPrints2500, btcNfp];
 })).map(row => row.id)).toEqual([solLoses100.id, btcNfp.id]);
});
