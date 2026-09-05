import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Thesis } from "@/lib/display-types";
import { theses } from "@/lib/view-data";
import { FeedRail } from "./feed-rail";

/**
 * One person must read as one person across the page. The mockup's rail row
 * prints the bare display name (`#tpl-rail`, e.g. line 436 "merkle_mike"), while
 * every handle in that file carries a leading "@" (e.g. line 539
 * "@merkle_mike"). The rail printed `handleLabel`, so the feed said
 * "Sofia Lange" and the rail beside it said "sofia_l" (demo-seed report D4).
 */
const base = theses[0];
if (base === undefined) throw new Error("mock feed is empty");
const post: Thesis = {
	...base,
	creator: { ...base.creator, displayName: "Sofia Lange", handleLabel: "sofia_l" },
};

test("the latest-theses rail prints the display name, never the handle", () => {
	const html = renderToStaticMarkup(<FeedRail posts={[post]} />);
	expect(html).toContain("Sofia Lange");
	expect(html).not.toContain("sofia_l");
});

test("the rail keeps the mockup's bare time and never prints an '@' handle", () => {
	const html = renderToStaticMarkup(<FeedRail posts={[post]} />);
	// The byline's leading "· " belongs to the feed, not the rail.
	expect(post.postedLabel.startsWith("·")).toBe(true);
	expect(html).toContain(`<span>${post.postedLabel.replace(/^·\s*/, "")}</span>`);
	const nameBlock = html.split('<div class="n">')[1]?.split("</div>")[0];
	expect(nameBlock).toBeDefined();
	expect(nameBlock).toContain("Sofia Lange");
	expect(nameBlock).not.toContain("@");
});
