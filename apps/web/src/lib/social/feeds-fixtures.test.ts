import { expect, test } from "bun:test";
import { following, top, theses, thesisDetailBySlug } from "../view-data";
import { discoverData } from "../page-data";

test("every example feed slug resolves to its own detail", () => {
	for (const list of [following, top, theses]) {
		expect(list.length).toBeGreaterThan(0);
		for (const item of list) expect(thesisDetailBySlug(item.slug)?.thesis.slug).toBe(item.slug);
	}
	expect(thesisDetailBySlug("missing-fixture")).toBeUndefined();
});

// Round-1 fold item 4: the ranking pills filter the POST feed, so every ranked
// entry must be a post the product can actually open. Before the fold three of
// the six trending slugs had no post at all.
test("every ranked post is a real post with its own detail page", async () => {
	const { ranked } = await discoverData();
	expect(ranked.trending.length).toBe(theses.length);
	for (const list of [ranked.trending, ranked.ending, ranked.settled]) {
		for (const post of list) {
			expect(theses.some((row) => row.slug === post.slug)).toBe(true);
			expect(thesisDetailBySlug(post.slug)?.thesis.slug).toBe(post.slug);
		}
	}
	// Ending is open posts with an expiry; Settled is settled posts. Both are
	// subsets of Trending, which is every public post.
	expect(ranked.ending.length).toBeLessThanOrEqual(ranked.trending.length);
	expect(ranked.settled.every((post) => post.status === "settled")).toBe(true);
});
