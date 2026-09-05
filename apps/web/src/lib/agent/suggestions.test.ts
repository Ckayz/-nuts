import { describe, expect, test } from "bun:test";

import { MAX_SUGGESTIONS, type ToolPart, suggestionsFor } from "./suggestions";

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
