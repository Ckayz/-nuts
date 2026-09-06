import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PageFrame } from "./page-frame";
import { columnOrder } from "./stacked-columns";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const marketCss = readFileSync(new URL("../../styles/market.css", import.meta.url), "utf8");

test("1180px stacks right panels and disables sticky rails; 900px still hides the left rail", () => {
 const small = css.split("@media (max-width:1180px){")[1]?.split("@media (max-width:900px){")[0];
 expect(small).toBeDefined();
 expect(small).toContain("grid-template-columns:minmax(0,1fr)");
 expect(small).toContain(".col-right{display:block;min-width:0}");
 expect(small).not.toMatch(/\.col-right\s*\{[^}]*display\s*:\s*none/);
 expect(small).toContain(".cols .sticky{position:static}");
 expect(css.split("@media (max-width:900px){")[1]).toContain(".col-left{display:none}");
});

test("market ordering keeps one ticket between header and structures, with other panels last", () => {
 const html = renderToStaticMarkup(<PageFrame ticketFirst right={<><section className="ticket">Unique ticket</section><aside>Trailing panel</aside></>}><header>Market header</header><section>Live structures</section></PageFrame>);
 expect(html.match(/Unique ticket/g)).toHaveLength(1);
 expect(html).toContain("ticket-first");
 expect(marketCss).toContain("@media (max-width:1180px)");
 expect(marketCss).toContain(".ticket-first > .col-main > :first-child { order: 1; }");
 expect(marketCss).toContain(".ticket-first > .col-right > .sticky > .ticket { order: 2; }");
 expect(marketCss).toContain(".ticket-first > .col-main > * { order: 3; min-width: 0; }");
 expect(marketCss).toContain(".ticket-first > .col-right > .sticky > * { order: 4; min-width: 0; }");
});

/* ---------- K-2 (pass-4 D4-M2): DOM order follows the visual order ---------- */

/**
 * `order` in `index.css` moves the left rail visually when the columns stack; it
 * does not move it in the tab sequence. MEASURED on /m/eth at the base commit,
 * the document Y of each Tab stop at 1000px: eight stops at Y 8048-8367 (the
 * rail) arrived 11th, before a jump back to Y 1415 — a 6,965px backward jump.
 * `StackedColumns` renders the three wrappers in the order the viewer reads
 * them, so this table and the `order` rules below must stay identical.
 */
test("columnOrder matches every .col-* order rule in index.css", () => {
	// wide: no `order` rule applies at all above 1180px.
	const wide = css.split("@media (max-width:1180px){")[0] ?? "";
	expect(wide).not.toMatch(/\.col-(left|right|main)\s*\{[^}]*order\s*:/);
	expect(columnOrder("wide", false)).toEqual(["left", "main", "right"]);
	expect(columnOrder("wide", true)).toEqual(["left", "main", "right"]);

	// 901-1180: `.col-left{order:9}` and nothing else -> main, right, left.
	const stacked = css.split("@media (max-width:1180px){")[1]?.split("@media (max-width:900px){")[0] ?? "";
	expect(stacked).toContain(".col-left{order:9}");
	expect(stacked).not.toMatch(/\.col-(right|main)\s*\{[^}]*order\s*:/);
	expect(columnOrder("stacked", false)).toEqual(["main", "right", "left"]);
	expect(columnOrder("stacked", true)).toEqual(["main", "right", "left"]);

	// <=900: the feed keeps its left column in the flow at order 1, its right at
	// 2, `.col-main` at 0 -> main, left, right. Every other page hides the rail,
	// which keeps `order:9` from the block above -> main, right, left.
	const phone = css.split("@media (max-width:900px){")[1] ?? "";
	expect(phone).toContain(".cols.feed>.col-left{display:block;order:1}");
	expect(phone).toContain(".cols.feed>.col-right{order:2}");
	expect(phone).toContain(".col-left{display:none}");
	expect(columnOrder("phone", true)).toEqual(["main", "left", "right"]);
	expect(columnOrder("phone", false)).toEqual(["main", "right", "left"]);
});

test("the frame renders one of each column and marks the feed as left-first", () => {
	const feed = renderToStaticMarkup(
		<PageFrame variant="feed" left={<b>RAIL</b>} right={<i>PANEL</i>}><p>POSTS</p></PageFrame>,
	);
	expect(feed.match(/col-left/g)).toHaveLength(1);
	expect(feed.match(/col-main/g)).toHaveLength(1);
	expect(feed.match(/col-right/g)).toHaveLength(1);
	// The SERVER renders the wide order, which is what `getServerSnapshot`
	// returns during hydration; a narrow viewport re-orders after it.
	expect(feed.indexOf("col-left")).toBeLessThan(feed.indexOf("col-main"));
	expect(feed.indexOf("col-main")).toBeLessThan(feed.indexOf("col-right"));
	// A missing rail still drops its track rather than rendering an empty column.
	const noRails = renderToStaticMarkup(<PageFrame><p>ONLY</p></PageFrame>);
	expect(noRails).toContain("no-left");
	expect(noRails).toContain("no-right");
	expect(noRails).not.toContain("col-left");
	expect(noRails).not.toContain("col-right");
});
