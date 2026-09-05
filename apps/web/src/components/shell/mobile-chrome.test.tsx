/**
 * Owner decisions 5 and 7 (2026-09-06), pinned where they actually live: the
 * Create control's place in the markup, and the two CSS rules that decide
 * whether a phone sees the leaderboard at all.
 *
 * The BROWSER measurements (Create's right edge inside the viewport at
 * 320/360/390/430/768/1440; exactly one visible Top traders card at 390 and
 * 1440; the anchor in view after a click) are in
 * `.research/thetanuts/review-confirm/fold-final-I2-report.md`. These cases are
 * the regression guard for the same two facts.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("./nav.tsx", import.meta.url), "utf8");
const feedPage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");

/**
 * `Nav` and `TopBar` are asserted at the SOURCE, not from a render: `Nav` calls
 * `usePathname()`, which is null outside a router, and `TopBar` reads the
 * data-source env at render time. Both files are small and the facts here are
 * about which markup exists, which the source states exactly. The rendered
 * result is measured in the browser instead (report).
 */

/* ---------- decision 5: Create lives in the top bar ---------- */

test("the nav no longer carries Create, and has no trailing spacer to hold it", () => {
	// Comments still discuss the move, so only the JSX below the component's
	// doc block is searched.
	const body = nav.slice(nav.indexOf("export function Nav"));
	expect(body).not.toContain('href="/new"');
	expect(body).not.toMatch(/>\s*Create\s*</);
	expect(body).not.toContain("spacer");
	// Guard: the nav still has its items, so the absence above is real.
	expect(body).toMatch(/>\s*Feed\s*</);
	expect(body).toMatch(/>\s*Portfolio\s*</);
	expect(body).toContain("`/m/${marketSlug}`");
});

test("the top bar carries the one route to the composer, beside the wallet chip", () => {
	const create = topBar.indexOf('href="/new"');
	const wallet = topBar.indexOf("<WalletBar />");
	expect(create).toBeGreaterThan(0);
	expect(wallet).toBeGreaterThan(create);
	expect(topBar).toContain('className="btn acc top-create"');
});

test("Create never shrinks or wraps: it left the overflow-x nav to stop being clipped", () => {
	const rule = css.match(/\.top-create\{[^}]*\}/)?.[0] ?? "";
	expect(rule).toContain("flex:none");
	expect(rule).toContain("white-space:nowrap");
	// The nav is still a scrolling row; that is exactly why Create is not in it.
	expect(css.match(/\.nav\{[^}]*\}/)?.[0] ?? "").toContain("overflow-x:auto");
});

test("below 400px the top bar is tightened so Create fits without scrolling the page", () => {
	// MEASURED: with Create in the bar and no tightening, `/` at 320px signed
	// out gave documentElement.scrollWidth 337 against clientWidth 320. These
	// four rules are what removes it; the re-measurement is in the report.
	const narrow = css.split("@media (max-width:400px){")[1]?.split("\n}")[0] ?? "";
	expect(narrow).toContain(".top{gap:8px;padding:0 10px}");
	expect(narrow).toContain(".brand{font-size:18px}");
	expect(narrow).toContain(".top-create{padding:0 10px}");
});

/* ---------- decision 7: the leaderboard on phones ---------- */

const phone = css.split("@media (max-width:900px){")[1] ?? "";

test("at <=900px the FEED's left column stays in the flow, under the posts", () => {
	expect(phone).toContain(".col-left{display:none}");
	// The exception, and it must be able to beat the blanket rule: `.cols.feed >
	// .col-left` is (0,2,1) against (0,1,0).
	expect(phone).toContain(".cols.feed>.col-left{display:block;order:1}");
	// Under the posts and AHEAD of the right-hand panels: `.col-main` has no
	// order (0), so 1 then 2 is main -> traders -> panels.
	expect(phone).toContain(".cols.feed>.col-right{order:2}");
	// Every other page's left rail stays hidden, as CLAUDE.md has it.
	expect(phone).not.toContain(".cols.page>.col-left{display:block");
});

test("the leaderboard anchor clears both sticky rows", () => {
	// `.top` is 60px at top:0 and `.nav` 46px at top:60px, so 106px of the
	// viewport is covered; the margin must be at least that.
	const margin = Number(css.match(/#top-traders\{scroll-margin-top:(\d+)px\}/)?.[1] ?? "0");
	expect(margin).toBeGreaterThanOrEqual(106);
	expect(css.match(/\.top\{[^}]*\}/)?.[0]).toContain("height:60px");
	expect(css.match(/\.nav\{[^}]*\}/)?.[0]).toContain("height:46px");
});

test("the feed renders ONE Top traders card, so the anchor id stays unique", () => {
	expect(feedPage.match(/id="top-traders"/g)).toHaveLength(1);
	// The Farcaster rail rode on the hidden column and stays desktop-only.
	expect(feedPage).toContain('className="rail-desktop-only"');
	expect(phone).toContain(".rail-desktop-only{display:none}");
});
