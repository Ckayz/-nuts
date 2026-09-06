import { describe, expect, test } from "bun:test";

import {
	MAX_SUGGESTION_LENGTH,
	MAX_SUGGESTIONS,
	SUGGEST_MARKER,
	type ToolPart,
	chipsForTurn,
	isLinkChip,
	postFillSuggestions,
	postRfqSuggestions,
	splitSuggestionTrailer,
	starterSuggestions,
	suggestionsFor,
} from "./suggestions";

const done = (type: string, output: unknown): ToolPart => ({
	type,
	state: "output-available",
	output,
});

describe("suggestionsFor", () => {
	test("offers risk and commitment after a trade is priced", () => {
		const chips = suggestionsFor([
			done("tool-previewOptionBookTrade", {
				executable: true,
				instrument: { asset: "ETH" },
			}),
		]);
		const labels = chips.map((c) => c.label);
		expect(labels).toContain("What's my max loss?");
		expect(labels).toContain("Prepare this trade");
	});

	test("does not offer to prepare a trade that was not executable", () => {
		// The tool says it cannot be filled; a chip offering to prepare it would
		// send the user into a refusal.
		const chips = suggestionsFor([
			done("tool-previewOptionBookTrade", { executable: false, reason: "contract units unverified" }),
		]);
		expect(chips.map((c) => c.label)).not.toContain("Prepare this trade");
	});

	test("names the asset only when the search proved exactly one is quoted", () => {
		const chips = suggestionsFor([
			done("tool-searchOptionBookOrders", {
				totalMatched: 12,
				orders: [{ asset: "ETH" }, { asset: "ETH" }],
			}),
		]);
		expect(chips.map((c) => c.label)).toContain("I think it goes up (ETH)");
		expect(chips.find((c) => c.label.includes("(ETH)"))?.send).toContain("ETH:");
	});

	test("stays generic when a search spanned several assets", () => {
		const chips = suggestionsFor([
			done("tool-searchOptionBookOrders", {
				totalMatched: 30,
				orders: [{ asset: "ETH" }, { asset: "BTC" }],
			}),
		]);
		expect(chips.map((c) => c.label).some((l) => l.includes("("))).toBe(false);
	});

	test("offers to widen an empty search rather than a dead end", () => {
		const chips = suggestionsFor([
			done("tool-searchOptionBookOrders", { totalMatched: 0, orders: [] }),
		]);
		expect(chips.map((c) => c.label)).toEqual(["Show me anything tradeable"]);
	});

	test("offers a direction after the market listing", () => {
		const chips = suggestionsFor([
			done("tool-getMarketData", { assets: [{ asset: "ETH", spotUsd: "2458" }] }),
		]);
		const labels = chips.map((c) => c.label);
		expect(labels).toContain("I think it goes up");
		expect(labels).toContain("What's cheapest?");
	});

	test("says nothing when no tool result is usable", () => {
		// A chip that leads nowhere is worse than no chip.
		expect(suggestionsFor([])).toEqual([]);
		expect(suggestionsFor([{ type: "tool-getMarketData", state: "input-available" }])).toEqual([]);
		expect(suggestionsFor([done("tool-getMarketData", null)])).toEqual([]);
		expect(suggestionsFor([done("tool-getThesisContext", { found: false })])).toEqual([]);
	});

	test("the newest result leads", () => {
		// The conversation moved on to a priced trade; the earlier listing must
		// not push its own chips to the front.
		const chips = suggestionsFor([
			done("tool-getMarketData", { assets: [] }),
			done("tool-previewOptionBookTrade", { executable: true, instrument: { asset: "ETH" } }),
		]);
		expect(chips[0]?.label).toBe("What's my max loss?");
	});

	test("never offers more than the cap, and never repeats a chip", () => {
		const chips = suggestionsFor([
			done("tool-getMarketData", { assets: [] }),
			done("tool-searchOptionBookOrders", { totalMatched: 5, orders: [{ asset: "BTC" }] }),
			done("tool-previewOptionBookTrade", { executable: true, instrument: { asset: "BTC" } }),
		]);
		expect(chips.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
		expect(new Set(chips.map((c) => c.label)).size).toBe(chips.length);
	});

	test("every chip sends something", () => {
		const chips = suggestionsFor([
			done("tool-searchOptionBookOrders", { totalMatched: 3, orders: [{ asset: "SOL" }] }),
		]);
		expect(chips.length).toBeGreaterThan(0);
		for (const chip of chips) {
			expect(chip.label.length).toBeGreaterThan(0);
			expect(chip.send.length).toBeGreaterThan(0);
		}
	});
});

/* ------------------------------------------------------------------ *
 * The model-written trailer (owner 2026-09-06 05:4x)
 * ------------------------------------------------------------------ */

describe("splitSuggestionTrailer", () => {
	test("parses the trailer and cuts it out of the body", () => {
		const text = `A put pays when the price settles below the strike.\n\nSUGGEST: ["What is the maximum loss?","What happens at expiry?"]`;
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(body).toBe("A put pays when the price settles below the strike.");
		expect(chips.map((c) => c.label)).toEqual(["What is the maximum loss?", "What happens at expiry?"]);
		// Pressing a chip sends exactly what it says.
		expect(chips.every((c) => c.send === c.label)).toBe(true);
		expect(body).not.toContain(SUGGEST_MARKER);
	});

	test("survives the decoration a model puts around the marker", () => {
		// Measured shapes: bolded, fenced, bulleted. None of them changes the
		// meaning, and all of them must leave the body clean.
		for (const trailer of [
			'**SUGGEST:** ["One","Two"]',
			'SUGGEST: ["One","Two"]',
			'- SUGGEST: ["One","Two"]',
			'```\nSUGGEST: ["One","Two"]\n```',
			'```json\nSUGGEST: ["One","Two"]\n```',
			'> SUGGEST: ["One","Two"]',
		]) {
			const { body, chips } = splitSuggestionTrailer(`Answer.\n\n${trailer}`, false);
			expect(chips.map((c) => c.label), trailer).toEqual(["One", "Two"]);
			expect(body, trailer).toBe("Answer.");
		}
	});

	test("a marker inside a sentence is not a trailer", () => {
		const text = "The word SUGGEST: is not a trailer when it sits mid-sentence.";
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(body).toBe(text);
		expect(chips).toEqual([]);
	});

	test("the LAST marker wins", () => {
		const text = 'One.\nSUGGEST: ["Old"]\nTwo.\nSUGGEST: ["New"]';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(chips.map((c) => c.label)).toEqual(["New"]);
		expect(body).toBe('One.\nSUGGEST: ["Old"]\nTwo.');
	});

	test("a malformed trailer still gets cut, and offers nothing", () => {
		// Raw JSON must never render, and half an array is not a proposal.
		for (const bad of ["SUGGEST: [", 'SUGGEST: ["unclosed', "SUGGEST: not json at all", "SUGGEST:"]) {
			const { body, chips } = splitSuggestionTrailer(`Answer.\n\n${bad}`, false);
			expect(body, bad).toBe("Answer.");
			expect(chips, bad).toEqual([]);
			expect(body, bad).not.toContain("SUGGEST");
		}
	});

	test("a non-array or empty trailer offers nothing", () => {
		expect(splitSuggestionTrailer('A.\nSUGGEST: {"a":1}', false).chips).toEqual([]);
		expect(splitSuggestionTrailer("A.\nSUGGEST: []", false).chips).toEqual([]);
		expect(splitSuggestionTrailer('A.\nSUGGEST: [1,2,null,""]', false).chips).toEqual([]);
	});

	test("no raw JSON while streaming, and no half-written marker either", () => {
		// The stream emits the trailer character by character; none of it may
		// flash on the screen.
		const full = 'Answer so far.\n\nSUGGEST: ["One","Two"]';
		for (let cut = full.indexOf("SUGGEST") - 2; cut <= full.length; cut++) {
			const partial = full.slice(0, cut);
			const { body, chips } = splitSuggestionTrailer(partial, true);
			expect(chips, partial).toEqual([]);
			// trimEnd: before the marker appears the text is just the answer plus
			// the newline the model has already emitted, which is not a leak.
			expect(body.trimEnd(), partial).toBe("Answer so far.");
			for (const marker of ["SUGG", "[", '"One"']) expect(body, marker).not.toContain(marker);
		}
	});

	test("a sentence that merely ends in S is left alone while streaming", () => {
		const text = "The collateral token is USDC. It settles in USDS";
		expect(splitSuggestionTrailer(text, true).body).toBe(text);
	});

	test("caps, trims, and dedupes case-insensitively", () => {
		const long = "x".repeat(MAX_SUGGESTION_LENGTH + 1);
		const { chips } = splitSuggestionTrailer(
			`A.\nSUGGEST: ["  one  ","ONE","two","three","four","five","${long}"]`,
			false,
		);
		expect(chips.map((c) => c.label)).toEqual(["one", "two", "three", "four"]);
		expect(chips.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
		expect(chips.every((c) => c.label.length <= MAX_SUGGESTION_LENGTH)).toBe(true);
	});

	test("recovers the trailer a real model left unclosed", () => {
		// Captured verbatim from a local run against `minimax/minimax-m3:free`
		// (2026-09-06, `finishReason: "stop"`, 888 characters): three complete
		// strings, no closing bracket. Every item is well-formed JSON; only the
		// array is not, so the items are read out rather than guessed at.
		const text =
			'That is what a put is.\n\nSUGGEST: ["Show me a put on ETH for under $10","Show me a put on BTC for under $10","What is the maximum loss on a put?"';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(chips.map((c) => c.label)).toEqual([
			"Show me a put on ETH for under $10",
			"Show me a put on BTC for under $10",
			"What is the maximum loss on a put?",
		]);
		expect(body).toBe("That is what a put is.");
	});

	test("half a string is still dropped", () => {
		// The recovery reads COMPLETE literals only: an unterminated one is not a
		// suggestion, it is a stream that stopped mid-word.
		const { chips } = splitSuggestionTrailer('A.\nSUGGEST: ["Show me a put on ETH","What is the max', false);
		expect(chips.map((c) => c.label)).toEqual(["Show me a put on ETH"]);
	});

	test("a reply with no trailer is returned untouched", () => {
		const text = "Plain answer with **markdown** and a [link](/m/eth).";
		expect(splitSuggestionTrailer(text, false)).toEqual({ body: text, chips: [] });
	});
});

describe("starterSuggestions", () => {
	test("names the asset when the panel is about one market", () => {
		const labels = starterSuggestions({ asset: "ETH" }).map((c) => c.label);
		expect(labels).toContain("I think ETH goes up this week. I have $10.");
		// The hedge entry (level 1) is only offered where an asset is in context.
		expect(labels).toContain("Protect my ETH from a drop");
		expect(labels.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
	});

	test("stays generic with no asset, and refuses a junk one", () => {
		for (const asset of [null, undefined, "", "  ", "not an asset", "<script>"]) {
			const labels = starterSuggestions({ asset }).map((c) => c.label);
			expect(labels, JSON.stringify(asset)).toContain("What can I trade right now?");
			expect(labels.some((l) => l.includes("Protect")), JSON.stringify(asset)).toBe(false);
		}
		expect(starterSuggestions().length).toBe(4);
	});

	test("every starter sends something", () => {
		for (const chip of [...starterSuggestions(), ...starterSuggestions({ asset: "btc" })]) {
			expect(chip.send.length).toBeGreaterThan(0);
			expect(chip.label.length).toBeLessThanOrEqual(MAX_SUGGESTION_LENGTH);
		}
		// A lowercase route parameter still reads as a ticker.
		expect(starterSuggestions({ asset: "btc" }).map((c) => c.label)).toContain("Protect my BTC from a drop");
	});
});

describe("chipsForTurn", () => {
	const text = (value: string) => ({ type: "text", text: value });

	test("the model's trailer wins over the tool-derived chips", () => {
		const chips = chipsForTurn({
			parts: [
				done("tool-previewOptionBookTrade", { executable: true, instrument: { asset: "ETH" } }),
				text('Priced.\nSUGGEST: ["What is the maximum loss?"]'),
			],
		});
		expect(chips.map((c) => c.label)).toEqual(["What is the maximum loss?"]);
	});

	test("falls back to the tool results when the model wrote no trailer", () => {
		const chips = chipsForTurn({
			parts: [
				done("tool-previewOptionBookTrade", { executable: true, instrument: { asset: "ETH" } }),
				text("Priced, and I forgot the trailer."),
			],
		});
		expect(chips.map((c) => c.label)).toContain("What's my max loss?");
	});

	test("NEVER empty for a turn that exists — the owner's rule", () => {
		// The three shapes that used to offer nothing at all: a plain
		// explanation, the out-of-scope redirect, and a tool result nothing is
		// built from.
		for (const parts of [
			[text("A put is the right to sell at a fixed price.")],
			// The canned redirect `lib/agent/scope.ts` returns without a model call,
			// quoted rather than imported: importing `scope.ts` pulls in
			// `lib/agent/model.ts`, whose boot check reads this machine's env.
			[text("I only handle options and theses on Thetanuts here.")],
			[done("tool-getThesisContext", { found: false }), text("No thesis there.")],
			[text("")],
		]) {
			const chips = chipsForTurn({ parts });
			expect(chips.length, JSON.stringify(parts).slice(0, 60)).toBeGreaterThan(0);
			expect(chips.every((c) => c.send.length > 0)).toBe(true);
		}
	});

	test("the fallback names the asset the panel is about", () => {
		const chips = chipsForTurn({ parts: [{ type: "text", text: "Plain answer." }], asset: "SOL" });
		expect(chips.map((c) => c.label)).toContain("What can I trade on SOL?");
	});

	test("offers nothing while the turn is still streaming, or when there is no turn", () => {
		expect(chipsForTurn({ parts: [text("Half an ans")], streaming: true })).toEqual([]);
		expect(chipsForTurn({ parts: null })).toEqual([]);
		expect(chipsForTurn({ parts: undefined })).toEqual([]);
		expect(chipsForTurn({ parts: [] })).toEqual([]);
	});
});

describe("postFillSuggestions", () => {
	test("links the composer with the same path the ticket's dialog builds", () => {
		const chips = postFillSuggestions("11111111-2222-3333-4444-555555555555");
		const link = chips.find(isLinkChip);
		// `lib/trade/record.ts`: composePath: `/new?link=/p/${row.id}`.
		expect(link?.href).toBe("/new?link=/p/11111111-2222-3333-4444-555555555555");
		expect(link?.label).toBe("Write a post about it");
		const send = chips.find((c) => !isLinkChip(c));
		expect(send && !isLinkChip(send) ? send.send : "").toContain("positions");
	});
});

describe("postRfqSuggestions", () => {
	test("both chips SEND text and name the row the card recorded", () => {
		const chips = postRfqSuggestions("row-1");
		// No link: there is no RFQ route in this app, and a chip that navigates
		// nowhere is worse than one that asks the agent.
		expect(chips.some(isLinkChip)).toBe(false);
		const labels = chips.map((c) => c.label);
		console.log("RFQ_CHIPS", JSON.stringify(chips));
		expect(labels).toEqual(["Check my request", "Cancel it"]);
		for (const chip of chips) {
			expect(isLinkChip(chip) ? "" : chip.send).toContain("row-1");
			expect(chip.label.length).toBeLessThanOrEqual(MAX_SUGGESTION_LENGTH);
		}
	});
});

describe("the RFQ starter", () => {
	test("is offered on the two underlyings the factory prices, and only there", () => {
		for (const asset of ["ETH", "BTC", "eth", "btc"]) {
			const labels = starterSuggestions({ asset }).map((c) => c.label);
			expect(labels, asset).toContain(`Ask for a custom ${asset.toUpperCase()} option`);
			// Still exactly MAX_SUGGESTIONS: the RFQ chip REPLACES the generic
			// discovery chip on a page that is already about one market.
			expect(labels.length, asset).toBe(MAX_SUGGESTIONS);
			expect(labels, asset).not.toContain("What can I trade right now?");
		}
		for (const asset of ["SOL", "DOGE", "AVAX", null, undefined]) {
			const labels = starterSuggestions({ asset }).map((c) => c.label);
			expect(labels.some((l) => l.includes("custom")), JSON.stringify(asset)).toBe(false);
		}
	});

	test("what it sends asks for the thing an RFQ is FOR, not for the mechanism", () => {
		const chip = starterSuggestions({ asset: "ETH" }).find((c) => c.label.includes("custom"));
		console.log("RFQ_STARTER", JSON.stringify(chip));
		expect(chip?.send).toContain("ETH");
		expect(chip?.send).toContain("order book does not have");
	});
});
