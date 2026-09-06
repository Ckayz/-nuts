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

/**
 * K-2 round 2. The ticket used to be moved by CSS: `display:contents` on
 * `.col-main`/`.col-right` plus four `order` rules, which left the money-path
 * input last in the DOM at <=1180px. It is a FRAME SLOT now, so there is
 * nothing to order below 1181px and the wide band is grid PLACEMENT.
 */
test("market ordering gives the ticket its own slot, once, and places the columns when wide", () => {
 const html = renderToStaticMarkup(<PageFrame ticketFirst ticket={<section className="ticket">Unique ticket</section>} mainLead={<header>Market header</header>} right={<aside>Trailing panel</aside>}><section>Live structures</section></PageFrame>);
 expect(html.match(/Unique ticket/g)).toHaveLength(1);
 expect(html.match(/Market header/g)).toHaveLength(1);
 expect(html).toContain("ticket-first");
 expect(html).toContain('class="col-ticket stack"');
 // The SERVER renders the wide band: the header is inside `.col-main`, and the
 // ticket is its own column-3 slot after it.
 expect(html.indexOf("Market header")).toBeLessThan(html.indexOf("Live structures"));
 expect(html.indexOf("Live structures")).toBeLessThan(html.indexOf("Unique ticket"));
 expect(html.indexOf("Unique ticket")).toBeLessThan(html.indexOf("Trailing panel"));
 // The old CSS mechanism is gone, in both directions.
 expect(marketCss).not.toContain("display: contents");
 for (const gone of [
  ".ticket-first > .col-main > :first-child { order: 1; }",
  ".ticket-first > .col-right > .sticky > .ticket { order: 2; }",
  ".ticket-first > .col-main > * { order: 3; min-width: 0; }",
  ".ticket-first > .col-right > .sticky > * { order: 4; min-width: 0; }",
 ]) expect(marketCss).not.toContain(gone);
 // Wide placement: one centre item spanning both rows, so a header shorter than
 // the ticket leaves no gap above the chart.
 expect(marketCss).toContain("@media (min-width:1181px)");
 expect(marketCss).toContain(".ticket-first > .col-main { grid-column: 2; grid-row: 1 / span 2; }");
 expect(marketCss).toContain(".ticket-first > .col-ticket { grid-column: 3; grid-row: 1; }");
 expect(marketCss).toContain(".ticket-first > .col-right { grid-column: 3; grid-row: 2; }");
 expect(marketCss).toContain(".ticket-first > .col-left { grid-column: 1; grid-row: 1 / span 2; }");
 // The ticket/panel gap is the `.stack` gap the single sticky stack used, not
 // the 12px column gap.
 // `min-content 1fr` is load-bearing: with two `auto` rows the spanning centre
 // column inflates row 1 and pushes the trailing panels 2,783px down (measured).
 expect(marketCss).toContain(".cols.page.ticket-first { grid-template-rows: min-content 1fr; row-gap: 14px; }");
 expect(css).toContain(".stack{display:flex;flex-direction:column;gap:14px}");
});

test("the ticket and the trailing panels are separate slots, so the ticket is reached first", () => {
 // Stacked, the DOM order is mainLead - ticket - main - right - left, which is
 // the visual order, so no `order` rule is needed for anything but the rail.
 expect(columnOrder("stacked", false)).toEqual(["mainLead", "ticket", "main", "right", "left"]);
 expect(columnOrder("phone", false)).toEqual(["mainLead", "ticket", "main", "right", "left"]);
 expect(columnOrder("phone", true)).toEqual(["mainLead", "ticket", "main", "left", "right"]);
 // Wide, `mainLead` is absent from the order because it renders INSIDE `.col-main`.
 expect(columnOrder("wide", false)).not.toContain("mainLead");
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
	expect(wide).not.toMatch(/\.col-(left|right|main|ticket|mainlead)\s*\{[^}]*order\s*:/);
	expect(columnOrder("wide", false)).toEqual(["left", "main", "ticket", "right"]);
	expect(columnOrder("wide", true)).toEqual(["left", "main", "ticket", "right"]);

	// 901-1180: `.col-left{order:9}` and nothing else. Every other slot is in the
	// DOM in the order it is read, so it needs no rule.
	const stacked = css.split("@media (max-width:1180px){")[1]?.split("@media (max-width:900px){")[0] ?? "";
	expect(stacked).toContain(".col-left{order:9}");
	expect(stacked).not.toMatch(/\.col-(right|main|ticket|mainlead)\s*\{[^}]*order\s*:/);
	expect(columnOrder("stacked", false)).toEqual(["mainLead", "ticket", "main", "right", "left"]);
	expect(columnOrder("stacked", true)).toEqual(["mainLead", "ticket", "main", "right", "left"]);

	// <=900: the feed keeps its left column in the flow at order 1, its right at
	// 2, `.col-main` at 0 -> main, left, right. Every other page hides the rail,
	// which keeps `order:9` from the block above -> main, right, left.
	const phone = css.split("@media (max-width:900px){")[1] ?? "";
	expect(phone).toContain(".cols.feed>.col-left{display:block;order:1}");
	expect(phone).toContain(".cols.feed>.col-right{order:2}");
	expect(phone).toContain(".col-left{display:none}");
	expect(columnOrder("phone", true)).toEqual(["mainLead", "ticket", "main", "left", "right"]);
	expect(columnOrder("phone", false)).toEqual(["mainLead", "ticket", "main", "right", "left"]);
});

test("the frame renders one of each column and marks the feed as left-first", () => {
	const feed = renderToStaticMarkup(
		<PageFrame variant="feed" left={<b>RAIL</b>} right={<i>PANEL</i>}><p>POSTS</p></PageFrame>,
	);
	// A page with no ticket and no lead card renders neither wrapper.
	expect(feed).not.toContain("col-ticket");
	expect(feed).not.toContain("col-mainlead");
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
