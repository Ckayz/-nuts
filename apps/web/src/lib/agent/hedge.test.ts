import { describe, expect, test } from "bun:test";

import {
	COOLING_OFF_MS,
	type HedgeRule,
	evaluateRule,
	evaluateRules,
	spentTodayScaled,
	spotToScaled,
	toScaled,
	utcDay,
} from "./hedge";

const NOW = new Date("2026-09-05T12:00:00.000Z");

function rule(overrides: Partial<HedgeRule> = {}): HedgeRule {
	return {
		id: "r1",
		walletAddress: "0xabc",
		accountAddress: "0xabc",
		asset: "ETH",
		floorUsd: "2400",
		budgetPerTrigger: "5",
		dailyCapUsd: "20",
		status: "armed",
		spentDay: null,
		spentToday: "0",
		lastFiredAt: null,
		...overrides,
	};
}

describe("toScaled", () => {
	test("scales whole and fractional decimals exactly", () => {
		expect(toScaled("1")).toBe(100_000_000n);
		expect(toScaled("0.00000001")).toBe(1n);
		expect(toScaled("2400.5")).toBe(240_050_000_000n);
	});

	test("refuses anything it cannot read exactly", () => {
		// A malformed stored value must skip its rule, never fire it.
		for (const bad of ["", "-1", "1.2.3", "abc", "1e5", " 1", "1 ", "0.000000001", "NaN"]) {
			expect(toScaled(bad)).toBeNull();
		}
	});
});

describe("spotToScaled", () => {
	test("accepts a live price", () => {
		expect(spotToScaled(2456.44)).toBe(245_644_000_000n);
	});

	test("refuses non-finite and non-positive prices", () => {
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
			expect(spotToScaled(bad)).toBeNull();
		}
	});
});

describe("utcDay and the daily counter", () => {
	test("day is the UTC calendar day", () => {
		expect(utcDay(new Date("2026-09-05T23:59:59.999Z"))).toBe("2026-09-05");
		expect(utcDay(new Date("2026-09-06T00:00:00.000Z"))).toBe("2026-09-06");
	});

	test("a counter from another day reads as zero, so the cap resets without a job", () => {
		expect(spentTodayScaled(rule({ spentDay: "2026-09-04", spentToday: "18" }), NOW)).toBe(0n);
	});

	test("a counter from today is read as stored", () => {
		expect(spentTodayScaled(rule({ spentDay: "2026-09-05", spentToday: "18" }), NOW)).toBe(
			1_800_000_000n,
		);
	});
});

describe("evaluateRule", () => {
	test("fires when spot is below the floor", () => {
		const d = evaluateRule(rule(), 2399.99, NOW);
		expect(d.fire).toBe(true);
		expect(d.reason).toBe("floor_broken");
		expect(d.budget).toBe("5");
		expect(d.explanation).toContain("2400");
	});

	test("fires when spot is exactly at the floor", () => {
		// "at or below" is the promise made to the user; equality must fire.
		expect(evaluateRule(rule(), 2400, NOW).fire).toBe(true);
	});

	test("does not fire one ten-millionth above the floor", () => {
		const d = evaluateRule(rule({ floorUsd: "2400" }), 2400.00000001, NOW);
		expect(d.fire).toBe(false);
		expect(d.reason).toBe("above_floor");
	});

	test("fires one ten-millionth below the floor", () => {
		const d = evaluateRule(rule({ floorUsd: "2400" }), 2399.99999999, NOW);
		expect(d.fire).toBe(true);
	});

	test("does not fire above the floor", () => {
		const d = evaluateRule(rule(), 2456.44, NOW);
		expect(d.fire).toBe(false);
		expect(d.reason).toBe("above_floor");
	});

	for (const status of ["paused", "exhausted", "revoked"] as const) {
		test(`never fires when ${status}`, () => {
			const d = evaluateRule(rule({ status }), 1, NOW);
			expect(d.fire).toBe(false);
			expect(d.reason).toBe("not_armed");
		});
	}

	test("does not guess when there is no spot price", () => {
		for (const spot of [null, undefined]) {
			const d = evaluateRule(rule(), spot, NOW);
			expect(d.fire).toBe(false);
			expect(d.reason).toBe("no_spot_price");
		}
	});

	test("refuses an unusable spot price rather than treating it as zero", () => {
		// A zero would look like the deepest possible crash and fire every rule.
		const d = evaluateRule(rule(), 0, NOW);
		expect(d.fire).toBe(false);
		expect(d.reason).toBe("no_spot_price");
	});

	test("stops at the daily cap, and says so distinctly from not triggering", () => {
		const d = evaluateRule(
			rule({ spentDay: "2026-09-05", spentToday: "16", dailyCapUsd: "20" }),
			2399,
			NOW,
		);
		expect(d.fire).toBe(false);
		expect(d.reason).toBe("daily_cap_reached");
	});

	test("allows a trigger that exactly exhausts the cap", () => {
		const d = evaluateRule(
			rule({ spentDay: "2026-09-05", spentToday: "15", dailyCapUsd: "20" }),
			2399,
			NOW,
		);
		expect(d.fire).toBe(true);
	});

	test("the cap resets on a new UTC day", () => {
		const d = evaluateRule(
			rule({ spentDay: "2026-09-04", spentToday: "20", dailyCapUsd: "20" }),
			2399,
			NOW,
		);
		expect(d.fire).toBe(true);
	});

	test("cools off after a recent fire", () => {
		const d = evaluateRule(
			rule({ lastFiredAt: new Date(NOW.getTime() - 60_000) }),
			2399,
			NOW,
		);
		expect(d.fire).toBe(false);
		expect(d.reason).toBe("cooling_off");
	});

	test("fires again once the cooling-off window has passed", () => {
		const d = evaluateRule(
			rule({ lastFiredAt: new Date(NOW.getTime() - COOLING_OFF_MS - 1) }),
			2399,
			NOW,
		);
		expect(d.fire).toBe(true);
	});

	test("skips a rule whose stored numbers are malformed", () => {
		for (const bad of [
			{ floorUsd: "not-a-number" },
			{ budgetPerTrigger: "-5" },
			{ dailyCapUsd: "" },
			{ spentDay: "2026-09-05", spentToday: "oops" },
			{ budgetPerTrigger: "0" },
		]) {
			const d = evaluateRule(rule(bad), 1, NOW);
			expect(d.fire).toBe(false);
			expect(d.reason).toBe("malformed_rule");
		}
	});

	test("every decision carries an explanation", () => {
		const cases = [
			evaluateRule(rule(), 2399, NOW),
			evaluateRule(rule(), 9999, NOW),
			evaluateRule(rule({ status: "paused" }), 1, NOW),
			evaluateRule(rule(), null, NOW),
		];
		for (const d of cases) expect(d.explanation.length).toBeGreaterThan(0);
	});
});

describe("evaluateRules", () => {
	test("matches each rule to its own asset's price", () => {
		const decisions = evaluateRules(
			[
				rule({ id: "eth", asset: "ETH", floorUsd: "2400" }),
				rule({ id: "btc", asset: "BTC", floorUsd: "70000" }),
				rule({ id: "sol", asset: "SOL", floorUsd: "100" }),
			],
			{ ETH: 2399, BTC: 79000 },
			NOW,
		);

		expect(decisions.map((d) => `${d.rule.id}:${d.fire}`)).toEqual([
			"eth:true",
			"btc:false",
			"sol:false",
		]);
		// SOL has no price in the snapshot; it must skip, not fire on a missing key.
		expect(decisions[2]?.reason).toBe("no_spot_price");
	});

	test("returns one decision per rule, including the ones that do nothing", () => {
		const rules = [rule({ id: "a" }), rule({ id: "b", status: "revoked" })];
		expect(evaluateRules(rules, { ETH: 9999 }, NOW)).toHaveLength(2);
	});
});
