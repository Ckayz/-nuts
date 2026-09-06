/**
 * The approval gate for an RFQ, as the reader sees it.
 *
 * Rendered with `renderToStaticMarkup`, the harness `agent-heading.test.tsx` and
 * `agent-suggest.test.tsx` use: this card holds no wallet state, so the markup
 * IS the behaviour.
 *
 * The load-bearing assertion is the one about what is NOT there. This card shows
 * the MODEL'S ARGUMENTS, and the escrow is a server number decoded from
 * calldata; a figure invented here would be the one the reader believes.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RFQ_APPROVAL_TOOLS, RfqApproval } from "./rfq-approval";

const render = (tool: string, input: Record<string, unknown> | undefined): string =>
	renderToStaticMarkup(<RfqApproval tool={tool} input={input} pending={false} onRespond={() => {}} />);

const CREATE_INPUT = {
	underlying: "ETH",
	// The user's own order; the card sorts a copy for the reader.
	strikesUsd: ["2200", "2100"],
	numContracts: "1",
	expiryAt: "2026-09-30T08:00:00Z",
	reservePricePerContract: "5",
	offerDeadlineMinutes: 60,
};

test("it names the three write tools and nothing else", () => {
	expect([...RFQ_APPROVAL_TOOLS].sort()).toEqual([
		"tool-requestRfqCancellation",
		"tool-requestRfqCreation",
		"tool-requestRfqSettlement",
	]);
	expect(RFQ_APPROVAL_TOOLS.has("tool-requestOptionBookExecution")).toBe(false);
});

test("a creation prints the arguments, strikes read ascending", () => {
	const html = render("tool-requestRfqCreation", CREATE_INPUT);
	console.log("RFQ_APPROVAL", html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
	expect(html).toContain("Ask market makers for this option?");
	expect(html).toContain("2100 / 2200");
	expect(html).not.toContain("2200 / 2100");
	expect(html).toContain("ETH");
	expect(html).toContain("5 USDC");
	// T-5: the expiry as a person reads it, in UTC, not the raw ISO instant the
	// tool's argument carries.
	expect(html).toContain("30 Sep 2026, 08:00 UTC");
	expect(html).not.toContain("2026-09-30T08:00:00Z");
});

test("it invents no escrow: the total is a server number, decoded from calldata", () => {
	const html = render("tool-requestRfqCreation", CREATE_INPUT);
	// 5 USDC per contract x 1 contract would be "5", which the card already
	// prints as the PER-CONTRACT maximum. Nothing here claims a total.
	expect(html).toContain("Most per contract");
	expect(html).not.toContain("You escrow");
	expect(html).not.toContain("Most you can lose");
	// And it says where the exact figure comes from instead.
	expect(html).toContain("read out of the calldata");
});

test("a cancellation and a settlement each get their own heading", () => {
	const cancel = render("tool-requestRfqCancellation", { rfqRequestId: "row-1" });
	expect(cancel).toContain("Cancel this request and take the escrow back?");
	expect(cancel).toContain("row-1");
	expect(render("tool-requestRfqSettlement", { rfqRequestId: "row-1" })).toContain("Settle this request?");
});

test("a junk or absent input renders a card, never a crash or a stray value", () => {
	for (const input of [
		undefined,
		{},
		{ strikesUsd: "2100" },
		{ strikesUsd: [] },
		{ strikesUsd: [null, 2100] },
		{ underlying: "", numContracts: 5 },
	]) {
		const html = render("tool-requestRfqCreation", input as Record<string, unknown> | undefined);
		expect(html, JSON.stringify(input)).toContain("Ask market makers for this option?");
		expect(html, JSON.stringify(input)).not.toContain("undefined");
		expect(html, JSON.stringify(input)).not.toContain("null");
	}
});

test("the two sentences the card writes carry a RENDERED owner marker", () => {
	// The `dl` labels are tagged in the source, exactly as `trade-approval.tsx`
	// tags its own; the two SENTENCES print the marker beside them. `copy.test.ts`
	// fences the source count.
	const html = render("tool-requestRfqCreation", CREATE_INPUT);
	console.log("MARKERS", (html.match(/TODO-OWNER/g) ?? []).length);
	expect((html.match(/TODO-OWNER/g) ?? []).length).toBe(2);
});
