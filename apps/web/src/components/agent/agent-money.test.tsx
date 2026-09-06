/**
 * Owner 2026-09-06 12:4x, verbatim: "can you like make the font some bold some
 * diff colour etc? so it easier and nicer to see".
 *
 * The reading rule is the whole feature, so it is tested on the sentences the
 * agent ACTUALLY writes — the ones recorded in `.research/rfq/followups.md`
 * from the 11:3x browser walk ("premium 9.999995 USDC", "break-even 2567.22",
 * "escrow 0.4 USDC = max loss") and the ones a free-model turn produced during
 * this build — rather than on invented prose.
 *
 * Both halves are asserted: `moneyParts` as a pure function, and the RENDERED
 * MARKUP, because the second bug this could have is a span that never reaches
 * the DOM.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentMarkdown } from "./agent-markdown";
import { moneyKind, moneyParts } from "./agent-money";

const render = (text: string) => renderToStaticMarkup(<AgentMarkdown text={text} />);

/** Every money run in the markup, as `[class, text]`. */
function money(html: string): [string, string][] {
	return [...html.matchAll(/<span class="(agent-money[^"]*)">([^<]*)<\/span>/g)].map((m) => [
		m[1] ?? "",
		m[2] ?? "",
	]);
}

test("a bare number is not money, and neither is a percent", () => {
	// Strikes, contract counts, dates and percentages all look like numbers.
	for (const text of ["The strike is 2540.", "12.5% of the premium.", "Expiry 2026-09-30.", "4.06504 contracts."]) {
		expect(moneyParts(text).every((p) => p.kind === "text"), text).toBe(true);
	}
	// And a percent right beside a figure leaves the percent alone.
	const parts = moneyParts("You pay 9.99 USDC, which is 12.5% of it.");
	expect(parts.filter((p) => p.kind !== "text").map((p) => p.text)).toEqual(["9.99 USDC"]);
});

test("the label decides the colour, nearest wins", () => {
	expect(moneyKind("Your maximum loss is")).toBe("loss");
	expect(moneyKind("The maximum payout is")).toBe("gain");
	expect(moneyKind("Market makers have 60 minutes")).toBe(null);
	// Nearest, not first: a sentence that names both ends on the one that counts.
	expect(moneyKind("You could lose the premium; the payout above the strike is")).toBe("gain");
	expect(moneyKind("The payout is uncapped, but the most you can lose is")).toBe("loss");
});

test("the walk's own sentences colour the way a reader would read them", () => {
	// `.research/rfq/followups.md`, the 11:3x preview turn.
	const html = render(
		"You pay a premium of 9.999995 USDC. That is the most you can lose. Break-even is 2567.22 and the maximum payout is uncapped.",
	);
	console.log("PREVIEW", JSON.stringify(money(html)));
	expect(money(html)).toEqual([["agent-money agent-money--loss", "9.999995 USDC"]]);
	// The break-even level is a price, not an amount, so it stays prose.
	expect(html).toContain("2567.22");
	expect(html).not.toContain('>2567.22<');
});

test("the RFQ escrow sentence reads as a loss", () => {
	// `.research/rfq/followups.md`, the RFQ preview turn.
	const html = render("The escrow is 0.4 USDC, and that is your maximum loss.");
	console.log("ESCROW", JSON.stringify(money(html)));
	expect(money(html)).toEqual([["agent-money agent-money--loss", "0.4 USDC"]]);
});

test("a gain sentence uses the gain token", () => {
	const html = render("If ETH settles at 2300 your payout is $184.50.");
	console.log("GAIN", JSON.stringify(money(html)));
	expect(money(html)).toEqual([["agent-money agent-money--gain", "$184.50"]]);
});

test("money with no label at all is emphasised but not coloured", () => {
	const html = render("ETH is trading at $2,458.10 right now.");
	console.log("NEUTRAL", JSON.stringify(money(html)));
	expect(money(html)).toEqual([["agent-money", "$2,458.10"]]);
});

test("a label in an earlier sibling still governs the figure", () => {
	// The shape the model writes constantly: a bold label, then the number.
	const html = render("- **Max loss:** 9.99 USDC\n- **Max payout:** 41.02 USDC\n");
	console.log("LIST", JSON.stringify(money(html)));
	expect(money(html)).toEqual([
		["agent-money agent-money--loss", "9.99 USDC"],
		["agent-money agent-money--gain", "41.02 USDC"],
	]);
});

test("a table cell is coloured by its COLUMN HEADER", () => {
	const html = render(
		"| Structure | Cost | Max payout |\n| --- | --- | --- |\n| ETH 2540 call | 9.99 USDC | 41.02 USDC |\n",
	);
	console.log("TABLE", JSON.stringify(money(html)));
	expect(money(html)).toEqual([
		["agent-money agent-money--loss", "9.99 USDC"],
		["agent-money agent-money--gain", "41.02 USDC"],
	]);
	// The header row itself is not painted.
	expect(html).toContain("<th>Cost</th>");
});

test("a figure inside `code` is quoted text and is never touched", () => {
	const html = render("The tool returned `premium: 9.99 USDC` for that order.");
	console.log("CODE", html);
	expect(html).toContain("<code>premium: 9.99 USDC</code>");
	expect(money(html)).toEqual([]);
});

test("the link rule is untouched by the money pass", () => {
	// A market path beside money: the path is still the only destination, and the
	// money beside it is still coloured.
	// The label PRECEDES the figure, which is the rule: a label written after a
	// number does not reach back and colour it (measured, and left that way —
	// "nearest preceding" is the only reading that stays right in a list).
	const html = render("Maximum loss 9.99 USDC. Trade it at /m/eth.");
	expect(html).toContain('<a class="agent-md-link" href="/m/eth">/m/eth</a>');
	expect(money(html)).toEqual([["agent-money agent-money--loss", "9.99 USDC"]]);
	// And a money figure never becomes an anchor.
	expect(html.match(/<a /g)).toHaveLength(1);
});

test("every collateral token the book quotes is recognised", () => {
	for (const amount of ["12 USDC", "0.5 cbBTC", "3 WETH", "250 aBasUSDC", "$10", "1.5 ETH", "0.02 BTC"]) {
		const parts = moneyParts(`Costs ${amount} today.`);
		expect(parts.some((p) => p.kind !== "text"), amount).toBe(true);
	}
});
