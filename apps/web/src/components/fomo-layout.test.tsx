/**
 * The three fomo layout changes, pinned where they actually live: two of them
 * are CSS, so the stylesheet is read the way `page-frame.test.tsx` and
 * `status-chip.test.tsx` already read it, and the markup is asserted from a
 * real render rather than from the source.
 *
 * Source: docs/design/FOMO-DIGEST.md — "Token page layout" (bordered stat
 * tiles, no fill) and "Feed" (posts as hairline-separated rows; a type pill on
 * each post).
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PostTypeBadge } from "./primitives";
import { CalloutPost } from "./feed/callout-post";
import { CalloutTabs } from "./feed/callout-tabs";
import { thesis as toView } from "@/lib/display";
import { withCards } from "@/lib/position/view";
import { theses as domainPosts } from "@/mock/data";
import type { Thesis } from "@/lib/display-types";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const profileCss = readFileSync(new URL("../styles/profile.css", import.meta.url), "utf8");
const marketCss = readFileSync(new URL("../styles/market.css", import.meta.url), "utf8");

const posts: Thesis[] = domainPosts.map((row) => withCards(toView(row), row));
const directional = posts.find((post) => post.direction !== null)!;
const plain = posts.find((post) => post.direction === null)!;
const backed = posts.find((post) => post.backingCard != null)!;

/* ---------- 1. stat tiles ---------- */

test("the market header's tiles are bordered and unfilled, and the strip is not", () => {
	const rule = css.match(/\.stats \.tile\{[^}]*\}/)?.[0] ?? "";
	expect(rule).toContain("border:1px solid var(--line)");
	expect(rule).toContain("background:none");
	// Radius by role: a tile is the row step. Never a raw pixel value.
	expect(rule).toContain("border-radius:var(--r-row)");
	// The old divider strip drew ONE line above the row; the tiles carry their
	// own hairline now, so the strip must not draw a second one over them.
	const strip = css.match(/\.stats\{[^}]*\}/)?.[0] ?? "";
	expect(strip).not.toContain("border-top");
	expect(strip).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
});

test("the tile row goes two-across below 900px and keeps all four tiles", () => {
	const small = css.split("@media (max-width:900px){")[1] ?? "";
	expect(small).toContain(".stats{grid-template-columns:repeat(2,minmax(0,1fr))");
	// The nth-child divider rules belonged to the strip treatment. If they came
	// back they would draw a line through a bordered tile.
	expect(small).not.toContain(".stats .tile:nth-child(3)");
});

test("the share card's own tiles keep the divider treatment they were ported with", () => {
	// `.tile` is shared with `components/position/pnl-card.tsx`. Every override
	// above is scoped under `.stats`; a bare `.tile{...border...}` would restyle
	// the share card, which is not this change's to touch.
	const base = css.match(/\n\.tile\{[^}]*\}/)?.[0] ?? "";
	expect(base).not.toContain("border");
	expect(css).toContain(".tile+.tile{padding-left:14px;border-left:1px solid var(--line)}");
});

/* ---------- 2. posts as hairline rows ---------- */

test("a feed post row has no border of its own; one hairline sits between siblings", () => {
	const item = css.match(/\.post-rows > \.post\{[^}]*\}/)?.[0] ?? "";
	expect(item).toContain("border:0");
	expect(item).toContain("background:none");
	expect(item).toContain("border-radius:0");
	expect(css).toContain(".post-rows > .post + .post{border-top:1px solid var(--line-soft)}");
	// `+` means no line above the first row and none below the last.
	expect(css).not.toMatch(/\.post-rows > \.post\{[^}]*border-top:/);
	expect(css).not.toMatch(/\.post-rows > \.post:(first|last)-child/);
});

test("the three other post surfaces separate the same way, and only between siblings", () => {
	// Market page, profile page. The thread page's hero is ONE post and is the
	// page's object, so it stays a card — asserted by its absence here.
	expect(marketCss).toContain(".tagged .post + .post {\n\tborder-top: 1px solid var(--line-soft);\n}");
	expect(profileCss).toContain(".profile-posts .post+.post{border-top:1px solid var(--line-soft)}");
	expect(css).toContain(".post{background:var(--surface);border:1px solid var(--line-soft)");
});

test("the feed's list is the hairline container, not a gapped stack of cards", () => {
	// The CSS above only bites if the feed actually asks for it. `.stack` is the
	// 14px-gap column every card list uses; a post list must not be one.
	const html = renderToStaticMarkup(
		<CalloutTabs
			ranked={{ trending: posts, ending: [], settled: [] }}
			following={[]}
			top={[]}
			signedIn={false}
			databaseMode={false}
		/>,
	);
	expect(html).toContain('class="post-rows"');
	expect(html).not.toContain('class="stack"');
	// And it really is holding the posts.
	expect([...html.matchAll(/class="post"/g)].length).toBe(posts.length);
});

test("hovering a row does not turn its separator into a border", () => {
	// `.post:hover{border-color:var(--line)}` would brighten the separator of
	// every row but the first, which reads as a card appearing under the cursor.
	expect(css).toContain(".post-rows > .post:hover{border-color:var(--line-soft)}");
});

/* ---------- 3. type badges ---------- */

test("a directionless post is badged Thesis, a directional one by its direction", () => {
	expect(renderToStaticMarkup(<PostTypeBadge thesis={plain} />)).toContain('class="ptype"');
	const html = renderToStaticMarkup(<PostTypeBadge thesis={directional} />);
	expect(html).toContain(`class="ptype ${directional.direction}"`);
	expect(html).toContain(directional.direction === "bull" ? "Bull" : "Bear");
});

test("every badge class the component can emit is one the stylesheet defines", () => {
	for (const post of [plain, directional]) {
		const emitted = renderToStaticMarkup(<PostTypeBadge thesis={post} />).match(/class="(ptype[^"]*)"/)?.[1] ?? "";
		expect(emitted.startsWith("ptype")).toBe(true);
		for (const token of emitted.split(" ").slice(1)) {
			expect(css, `.ptype.${token} is not defined`).toContain(`.ptype.${token}`);
		}
	}
	expect(css).toContain(".ptype{");
	expect(css).toContain(".ptype.bull .dot{background:var(--gain)}");
	expect(css).toContain(".ptype.bear .dot{background:var(--loss)}");
});

test("CLAUDE.md's colour rule: the money colour is on the dot, never on the pill", () => {
	const pill = css.match(/\n\.ptype\{[^}]*\}/)?.[0] ?? "";
	expect(pill).not.toContain("--gain");
	expect(pill).not.toContain("--loss");
	// And the tone classes may only change the INK to a neutral token.
	const tones = css.match(/\.ptype\.bull,\.ptype\.bear\{[^}]*\}/)?.[0] ?? "";
	expect(tones).toBe(".ptype.bull,.ptype.bear{color:var(--text)}");
});

test("the badge sits beside the Backed chip; they state different facts", () => {
	// The pill says WHAT the post is; 'Backed' says the author put money behind
	// it. Removing either would drop a fact the market page's compact post has
	// nowhere else to show — it draws no position card.
	const html = renderToStaticMarkup(<CalloutPost thesis={backed} compact />);
	expect(html).toContain('class="ptype');
	expect(html).toContain(">Backed<");
});

test("a post carries exactly one type badge", () => {
	for (const post of posts) {
		const html = renderToStaticMarkup(<CalloutPost thesis={post} />);
		expect([...html.matchAll(/class="ptype[^"]*"/g)]).toHaveLength(1);
	}
});
