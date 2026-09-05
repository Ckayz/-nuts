import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PageFrame } from "./page-frame";

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
