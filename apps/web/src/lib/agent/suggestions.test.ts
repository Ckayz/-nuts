import { describe, expect, test } from "bun:test";

import {
	fallbackSuggestions,
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

/* ------------------------------------------------------------------ *
 * W4 (owner 2026-09-06 12:4x): the row must MOVE, and must know the session
 * ------------------------------------------------------------------ */

describe("the deterministic row rotates", () => {
	test("two consecutive turns never show the identical fallback row", () => {
		const rows = [0, 1, 2, 3].map((turn) => fallbackSuggestions({ turn }).map((c) => c.label));
		console.log("FALLBACK_ROTATION", JSON.stringify(rows));
		for (let i = 1; i < rows.length; i++) {
			expect(JSON.stringify(rows[i]), `turn ${i}`).not.toBe(JSON.stringify(rows[i - 1]));
		}
		// The anchor is the same every turn on purpose: it is the one chip that
		// names the market on screen.
		for (const row of rows) expect(row[0]).toBe("What can I trade right now?");
	});

	test("the same holds for a tool-derived row", () => {
		const priced = [done("tool-previewOptionBookTrade", { executable: true, instrument: { asset: "ETH" } })];
		const rows = [0, 1, 2].map((turn) => suggestionsFor(priced, { turn }).map((c) => c.label));
		console.log("PRICED_ROTATION", JSON.stringify(rows));
		expect(JSON.stringify(rows[0])).not.toBe(JSON.stringify(rows[1]));
		expect(JSON.stringify(rows[1])).not.toBe(JSON.stringify(rows[2]));
	});

	test("a priced trade ALWAYS offers to move it forward, whatever the rotation", () => {
		const priced = [done("tool-previewOptionBookTrade", { executable: true, instrument: { asset: "ETH" } })];
		for (let turn = 0; turn < 9; turn++) {
			const labels = suggestionsFor(priced, { turn }).map((c) => c.label);
			expect(labels, `turn ${turn}`).toContain("Prepare this trade");
			expect(labels.length, `turn ${turn}`).toBeLessThanOrEqual(MAX_SUGGESTIONS);
		}
	});

	test("a turn that is not a number, or negative, still produces a row", () => {
		for (const turn of [-1, -7, Number.NaN, Number.POSITIVE_INFINITY]) {
			const chips = fallbackSuggestions({ turn });
			expect(chips.length, String(turn)).toBeGreaterThan(0);
			expect(new Set(chips.map((c) => c.label)).size).toBe(chips.length);
		}
	});
});

describe("the row knows whether anyone is signed in", () => {
	test("signed out, nothing wallet-only is ever offered", () => {
		const offered = new Set<string>();
		for (let turn = 0; turn < 12; turn++) {
			for (const chip of fallbackSuggestions({ turn, asset: "ETH" })) offered.add(chip.label);
			for (const chip of suggestionsFor(
				[done("tool-getMarketData", { assets: [{ asset: "ETH" }] })],
				{ turn },
			)) {
				offered.add(chip.label);
			}
		}
		console.log("SIGNED_OUT", JSON.stringify([...offered]));
		expect([...offered]).not.toContain("Show my positions");
		expect([...offered]).not.toContain("What am I risking right now?");
	});

	test("signed in, the positions chips join the pool", () => {
		const offered = new Set<string>();
		for (let turn = 0; turn < 12; turn++) {
			for (const chip of fallbackSuggestions({ turn, signedIn: true })) offered.add(chip.label);
		}
		console.log("SIGNED_IN", JSON.stringify([...offered]));
		expect([...offered]).toContain("Show my positions");
		expect([...offered]).toContain("What am I risking right now?");
	});

	test("after a positions list, one chip is per position and one is protection", () => {
		const chips = suggestionsFor(
			[
				done("tool-getUserPositions", {
					signedIn: true,
					positions: [{ asset: "ETH" }, { asset: "BTC" }],
				}),
			],
			{ signedIn: true },
		);
		const labels = chips.map((c) => c.label);
		console.log("POSITIONS_CHIPS", JSON.stringify(labels));
		expect(labels).toContain("Show my positions");
		expect(labels.some((l) => l.includes("Protect my ETH"))).toBe(true);
	});

	test("a signed-out positions result offers nothing wallet-only", () => {
		const chips = suggestionsFor([done("tool-getUserPositions", { signedIn: false })]);
		expect(chips.map((c) => c.label)).not.toContain("Show my positions");
	});

	test("the RFQ chip is offered where the factory prices one, and only there", () => {
		const eth = new Set<string>();
		const sol = new Set<string>();
		for (let turn = 0; turn < 12; turn++) {
			for (const chip of fallbackSuggestions({ turn, asset: "ETH" })) eth.add(chip.label);
			for (const chip of fallbackSuggestions({ turn, asset: "SOL" })) sol.add(chip.label);
		}
		expect([...eth]).toContain("Ask for a custom ETH option");
		expect([...sol].some((l) => l.includes("custom"))).toBe(false);
	});

	test("a preview the tool refused never offers to prepare it, at any turn", () => {
		const refused = [done("tool-previewOptionBookTrade", { executable: false, reason: "unproven units" })];
		for (let turn = 0; turn < 9; turn++) {
			const chips = suggestionsFor(refused, { turn });
			expect(chips.length, `turn ${turn}`).toBeGreaterThan(0);
			expect(chips.map((c) => c.label), `turn ${turn}`).not.toContain("Prepare this trade");
		}
	});

	test("chipsForTurn carries the turn and the session down to the fallback", () => {
		const first = chipsForTurn({ parts: [{ type: "text", text: "Plain." }], turn: 0, signedIn: true });
		const second = chipsForTurn({ parts: [{ type: "text", text: "Plain." }], turn: 1, signedIn: true });
		console.log("TURN_CARRIED", JSON.stringify([first.map((c) => c.label), second.map((c) => c.label)]));
		expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
	});
});

/* ------------------------------------------------------------------ *
 * B-4 (one-shot review of the RFQ build): a marker inside a code block
 * ------------------------------------------------------------------ */

describe("B-4: an example inside a fenced block is not a trailer", () => {
	/**
	 * The reviewer's case. A reply that SHOWS the trailer format — reachable when
	 * a user asks the agent about its own follow-ups, and through injected thesis
	 * text that asks the model to print one mid-answer:
	 *
	 *   marker in a fenced block   body="Example:"   chips=["x"]
	 *
	 * "Done." was gone from the screen and an illustrative array became live
	 * chips the user could press.
	 */
	test("a fenced example with an answer after it keeps the whole answer", () => {
		const text = 'Example:\n```\nSUGGEST: ["x"]\n```\nDone.';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(body).toBe(text);
		expect(chips).toEqual([]);
	});

	test("the same, with a language tag and several lines of code", () => {
		const text = 'The format is:\n\n```json\nSUGGEST: ["One","Two"]\n{"note":"illustration"}\n```\n\nThat is all it is.';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(body).toBe(text);
		expect(chips).toEqual([]);
	});

	test("a tilde fence counts too", () => {
		const text = 'Example:\n~~~\nSUGGEST: ["x"]\n~~~\nDone.';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(body).toBe(text);
		expect(chips).toEqual([]);
	});

	test("an UNCLOSED fence swallowing the trailer is not a trailer either", () => {
		// Everything after the opening fence is code the model never closed; the
		// reader should see it rather than lose the end of the answer to a cut.
		const text = 'Here is some code:\n```\nconst a = 1;\nSUGGEST: ["x"]';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(body).toBe(text);
		expect(chips).toEqual([]);
	});

	/**
	 * The decoration the model really does emit still works: a fence opened for
	 * the trailer ALONE, at the very end of the reply, is the trailer. That case
	 * is measured in "survives the decoration a model puts around the marker"
	 * above; here it is stated against the new rule so the two cannot drift.
	 */
	test("a fence around the trailer alone, ending the reply, is still the trailer", () => {
		for (const tail of ['```\nSUGGEST: ["One","Two"]\n```', '```json\nSUGGEST: ["One","Two"]\n```', '```\nSUGGEST: ["One","Two"]\n```\n\n']) {
			const { body, chips } = splitSuggestionTrailer(`Answer.\n\n${tail}`, false);
			expect(chips.map((c) => c.label), tail).toEqual(["One", "Two"]);
			expect(body, tail).toBe("Answer.");
		}
	});

	test("mid-stream, a fence opened for the trailer alone is still cut", () => {
		// The closing fence has not arrived yet. Cutting keeps raw `SUGGEST: [`
		// off the screen, which is the whole point of the streaming branch; when
		// the stream ends the real shape is known and the rules above apply.
		const { body, chips } = splitSuggestionTrailer('Answer.\n\n```\nSUGGEST: ["On', true);
		expect(body).toBe("Answer.");
		expect(chips).toEqual([]);
	});

	test("mid-stream, a fence carrying real code is NOT cut", () => {
		const text = 'Here:\n```\nconst a = 1;\nSUGGEST: ["x"';
		expect(splitSuggestionTrailer(text, true).body).toBe(text);
	});

	test("the fence scan is linear, not quadratic", () => {
		// 20,000 opening fences and a 100,000-character body: the scan jumps past
		// each block it has already read, so no input is examined twice.
		const many = "```\n".repeat(20_000);
		const long = `${"x".repeat(100_000)}\n\nSUGGEST: ["One"]`;
		for (const [name, input] of [["fences", many], ["body", long]] as const) {
			const started = Bun.nanoseconds();
			splitSuggestionTrailer(input, false);
			const ms = (Bun.nanoseconds() - started) / 1e6;
			expect({ name, fast: ms < 500 }).toEqual({ name, fast: true });
		}
	});

	test("the LAST marker outside a fence still wins when an earlier one is fenced", () => {
		const text = 'Example:\n```\nSUGGEST: ["fenced"]\n```\nHere it is.\n\nSUGGEST: ["real"]';
		const { body, chips } = splitSuggestionTrailer(text, false);
		expect(chips.map((c) => c.label)).toEqual(["real"]);
		expect(body).toBe('Example:\n```\nSUGGEST: ["fenced"]\n```\nHere it is.');
	});
});
