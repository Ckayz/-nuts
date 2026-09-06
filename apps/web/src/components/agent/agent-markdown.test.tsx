/**
 * D-N1 and D-n1 (lane D confirming pass).
 *
 * These assert the RENDERED MARKUP, not the source, because both bugs were
 * invisible in the source: `LinkedText` looked correct and `SafeAnchor`'s test
 * looked like the grammar. Every fixture below is a string the reviewer's own
 * `renderToStaticMarkup` probe ran, plus the table cell and list item the
 * finding asked for.
 *
 * Measured BEFORE the fix (the whole reason this file exists):
 *
 *   "Trade /m/btc"             -> <p>Trade <a href="/m/btc">/m/btc</a></p>
 *   "Trade **BTC** at /m/btc"  -> <p>Trade <strong>BTC</strong> at /m/btc</p>
 *   "[Trade](/m/../portfolio)" -> <a href="/m/../portfolio">Trade</a>
 *   "[Trade](/m/btc?thesis=not-a-uuid)" -> an anchor as well
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMarkdown } from "./agent-markdown";
import { isMarketPath } from "./market-link";

const render = (text: string) => renderToStaticMarkup(<AgentMarkdown text={text} />);

const LINK = '<a class="agent-md-link" href="/m/btc">/m/btc</a>';

test("D-N1: a plain paragraph links its market path", () => {
	expect(render("Trade /m/btc")).toContain(LINK);
});

test("D-N1: FORMATTING beside the path does not swallow the link", () => {
	// The reviewer's exact reproduction. One bold word made the children an
	// array, and the whole paragraph fell through untouched.
	const html = render("Trade **BTC** at /m/btc");
	expect(html).toContain("<strong>BTC</strong>");
	expect(html).toContain(LINK);
});

test("D-N1: list items link with and without formatting", () => {
	const html = render("- /m/eth is live\n- **ETH** at /m/eth\n");
	expect(html.match(/href="\/m\/eth"/g)).toHaveLength(2);
	expect(html).toContain("<strong>ETH</strong>");
});

test("D-N1: table cells and headers link too", () => {
	const html = render("| where | what |\n| --- | --- |\n| /m/sol | **SOL** at /m/sol |\n");
	expect(html.match(/href="\/m\/sol"/g)).toHaveLength(2);
	expect(html).toContain("<strong>SOL</strong>");
});

test("D-N1: a blockquote links too", () => {
	expect(render("> **BTC** at /m/btc")).toContain(LINK);
});

test("D-N1: the thesis-carrying shape survives formatting as well", () => {
	const uuid = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01";
	expect(render(`**ETH** at /m/eth?thesis=${uuid} now`)).toContain(`href="/m/eth?thesis=${uuid}"`);
});

test("D-N1: text that is not a market path still becomes no destination", () => {
	for (const text of ["Visit **now** at https://example.com", "**Read** /portfolio", "call /m/ nothing"]) {
		expect(render(text)).not.toContain("<a ");
	}
});

test("B2: a position page links, in text and as an authored destination", () => {
	const uuid = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01";
	// `getUserPositions` hands the model this exact shape as each row's `path`.
	expect(render(`Open /p/${uuid} to see it`)).toContain(
		`<a class="agent-md-link" href="/p/${uuid}">/p/${uuid}</a>`,
	);
	expect(render(`[Open](/p/${uuid})`)).toContain(`<a class="agent-md-link" href="/p/${uuid}">Open</a>`);
	// One bold word beside it must not swallow the link (the D-N1 shape).
	expect(render(`**Your** put at /p/${uuid}`)).toContain(`href="/p/${uuid}"`);
});

test("B2: anything else under /p/ or a bare app route stays text", () => {
	for (const href of ["/p/x", "/p/../portfolio", "/portfolio", "/p/not-a-uuid", "/p/"]) {
		const html = render(`[Open](${href})`);
		expect(html, href).not.toContain("<a ");
		expect(html, href).toContain("Open");
	}
	expect(render("Open /p/x and /portfolio")).not.toContain("<a ");
});

test("D-n1: a markdown destination must match the market grammar, not merely start with /m/", () => {
	for (const href of ["/m/../portfolio", "/m/btc?thesis=not-a-uuid", "/m/btc/../../x", "/m/btc#frag"]) {
		const html = render(`[Trade](${href})`);
		expect(html, href).not.toContain("<a ");
		// The label is still shown; only the destination is refused.
		expect(html, href).toContain("Trade");
	}
});

test("D-n1: a destination that DOES match stays a link", () => {
	const uuid = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01";
	expect(render("[Trade](/m/btc)")).toContain('<a class="agent-md-link" href="/m/btc">Trade</a>');
	expect(render(`[Trade](/m/eth?thesis=${uuid})`)).toContain(`href="/m/eth?thesis=${uuid}"`);
});

test("D-n1: the anchored matcher is the same grammar the text scanner uses", () => {
	expect(isMarketPath("/m/btc")).toBe(true);
	expect(isMarketPath("/m/BTC")).toBe(true);
	expect(isMarketPath("/m/btc?thesis=9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01")).toBe(true);
	expect(isMarketPath(" /m/btc")).toBe(false);
	expect(isMarketPath("/m/btc ")).toBe(false);
	expect(isMarketPath("/m/../portfolio")).toBe(false);
	expect(isMarketPath("https://evil.example/m/btc")).toBe(false);
	// B2: and the position shape, on the same anchored expression.
	expect(isMarketPath("/p/9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01")).toBe(true);
	expect(isMarketPath("/p/9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01 ")).toBe(false);
	expect(isMarketPath("/p/x")).toBe(false);
	expect(isMarketPath("https://evil.example/p/9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01")).toBe(false);
});

test("no raw HTML is ever rendered, whatever the model writes", () => {
	const html = render('<img src=x onerror="alert(1)"> and <script>alert(2)</script>');
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<script");
});

/**
 * D-minor (lane D pass 2). A model reply owns no heading.
 *
 * `/m/<asset>` renders the page's only `<h1>` and the agent panel beside it
 * renders an `<h2>` (`agent-heading.test.tsx`). A reply beginning "# BTC" put a
 * SECOND `<h1>` on that page — measured by the reviewer as `page {"h1":2}` —
 * undoing that fold from inside the conversation. Measured here before the fix:
 *
 *   "# BTC\n\nA market reply." -> <div class="agent-md"><h1>BTC</h1>...
 */
test("D-minor: no heading level a model writes reaches the document outline", () => {
	for (const [hashes, text] of [["#", "BTC"], ["##", "Sub"], ["###", "Three"], ["####", "Four"]] as const) {
		const html = render(`${hashes} ${text}\n\nA market reply.`);
		expect(html, hashes).not.toMatch(/<h[1-6][\s>]/);
		// The words are still shown, emphasised, as their own block.
		expect(html, hashes).toContain(`<p class="agent-md-heading"><strong>${text}</strong></p>`);
	}
});

test("D-minor: a market path inside a heading is still linked", () => {
	expect(render("## Sub /m/btc")).toContain('<a class="agent-md-link" href="/m/btc">/m/btc</a>');
});
