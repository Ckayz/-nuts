/**
 * The post type badge (docs/design/FOMO-DIGEST.md, "Feed": fomo pills each post
 * with its type). These run over the SAME fixtures the feed renders, converted
 * by the same pair the pages use — `display.thesis` then `withCards` — so a
 * change to either shows up here rather than only in a browser.
 *
 * The load-bearing case is the last two: the badge must read the post's own
 * `direction` column and NOT the two fields that look like a direction and are
 * constants.
 */
import { expect, test } from "bun:test";
import { DIRECTION_LABEL, postTypeBadge, THESIS_BADGE } from "./post-type";
import { thesis as toView } from "./display";
import { withCards } from "./position/view";
import { theses as domainPosts } from "@/mock/data";
import type { Thesis } from "./display-types";

const posts: Thesis[] = domainPosts.map((row) => withCards(toView(row), row));
const bySlug = (slug: string): Thesis => {
	const found = posts.find((post) => post.slug === slug);
	if (found === undefined) throw new Error(`fixture ${slug} is gone`);
	return found;
};

test("a post that names no structure is a Thesis", () => {
	const post = bySlug("btc-85k-by-october");
	expect(post.direction).toBeNull();
	expect(postTypeBadge(post)).toEqual(THESIS_BADGE);
	expect(postTypeBadge(post)).toEqual({ label: "Thesis", tone: "neutral" });
});

test("a post that names a direction is badged with it, in the product's own words", () => {
	for (const direction of ["bull", "bear"] as const) {
		expect(postTypeBadge({ direction })).toEqual({
			label: DIRECTION_LABEL[direction],
			tone: direction,
		});
	}
	// The same two words `components/feed/thesis-list.tsx` prints on a position
	// row and the ticket puts on its segmented control.
	expect(DIRECTION_LABEL).toEqual({ bull: "Bull", bear: "Bear" });
});

test("the tone always agrees with the label it is drawn beside", () => {
	for (const post of [...posts, { direction: "bull" as const }, { direction: "bear" as const }]) {
		const badge = postTypeBadge(post);
		if (badge.tone === "neutral") expect(badge.label).toBe("Thesis");
		else expect(badge.label).toBe(DIRECTION_LABEL[badge.tone]);
	}
});

test("a BEAR post whose two look-alike fields both say bull is still badged Bear", () => {
	// The whole reason `postTypeBadge` takes `direction` and nothing else.
	//   `lib/display.ts` `structure()` returns `side: "bull"` for EVERY post
	//   (display.ts:110), and `lib/position/view.ts` `backingCard()` passes
	//   `side: "back"` for every backed post, which display.ts:337 prints as
	//   "Bull". Both were measured on 2026-09-06; both are constants, not facts.
	// This fixture is bear and backed. `structure.side` STILL says bull for every
	// post — `lib/display.ts` `structure()` returns it as a literal — so the badge
	// must not read it. `backingCard.side` was the same constant until the card
	// builder was fixed to take a real market direction; it now agrees with the
	// thesis, and the badge still does not read it, because a post without a
	// backing has no card at all.
	const post = bySlug("btc-nfp-4a2c");
	expect(post.direction).toBe("bear");
	expect(post.structure?.side).toBe("bull");
	expect(post.backingCard?.side).toBe("bear");
	expect(postTypeBadge(post)).toEqual({ label: "Bear", tone: "bear" });
});

test("structure.side is a constant and can never be the answer", () => {
	// `lib/display.ts` structure() returns `side: "bull"` as a literal, so this
	// field says bull for every post in the set. If the badge read it, no post
	// could ever be Bear — and three of them are.
	for (const post of posts) {
		if (post.structure !== null) expect(post.structure.side).toBe("bull");
	}
	const bears = posts.filter((post) => postTypeBadge(post).tone === "bear");
	expect(bears.length).toBeGreaterThan(0);
});

test("the position card now states the direction the post states", () => {
	// Before the card builder was fixed, `backingCard.side` was derived from
	// "back"/"counter" and printed Bull for every position, bear ones included.
	// The badge and the card underneath it are now the same claim.
	for (const post of posts) {
		if (post.backingCard == null || post.direction === null) continue;
		expect(post.backingCard.side).toBe(post.direction);
	}
});

test("every fixture post gets exactly one badge, and its tone is one of three", () => {
	expect(posts.length).toBeGreaterThan(0);
	for (const post of posts) {
		const badge = postTypeBadge(post);
		expect(badge.label.length).toBeGreaterThan(0);
		expect(["neutral", "bull", "bear"]).toContain(badge.tone);
		// A neutral tone means "this post states no direction", and nothing else.
		expect(badge.tone === "neutral").toBe(post.direction === null);
	}
});
