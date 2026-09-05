/**
 * I-1 (owner 2026-09-06, decision 1). Bull means the ASSET goes up, on the
 * market ticket too.
 *
 * The table below is the whole rule: for every structure kind the live book
 * carries, which taker side each button fills, and the proof that the position
 * the fill produces carries the SAME word the button did — read out of
 * `positionDirection()`, the function every position surface uses, not a copy
 * of it.
 *
 * The mutation that must go RED is named in the last test.
 */
import { describe, expect, test } from "bun:test";
import type { Market, RiskKind } from "@nuts/thetanuts";
import { positionDirection } from "@/lib/position/lifecycle";
import { directionOfSide, takerForSide } from "@/lib/trade/view";
import type { TakerSide, TicketSide } from "@/lib/trade/types";
import {
	CLASSIFIABLE,
	directionForTaker,
	directionNameable,
	sideWord,
	takerForDirection,
	type DirectionalStructure,
} from "./direction";
import { riskKindFor } from "./structures";
import { sideNoteFor, type LiveStructure } from "./live";

/** One row per structure kind the book carries, built from the SDK's own implementation names. */
const KINDS: ReadonlyArray<{
	readonly name: string;
	/** The SDK implementation name, as `getOptionImplementationInfo` returns it. */
	readonly implementation: string | null;
	readonly strikeCount: number;
	readonly isCall: boolean;
	/** null = no direction may be printed. */
	readonly bullTaker: TakerSide | null;
}> = [
	{ name: "call", implementation: "LINEAR_CALL", strikeCount: 1, isCall: true, bullTaker: "buy" },
	{ name: "put", implementation: "PUT", strikeCount: 1, isCall: false, bullTaker: "sell" },
	{ name: "physical put", implementation: "PHYSICAL_PUT", strikeCount: 1, isCall: false, bullTaker: "sell" },
	{ name: "call spread", implementation: "CALL_SPREAD", strikeCount: 2, isCall: true, bullTaker: "buy" },
	{ name: "put spread", implementation: "PUT_SPREAD", strikeCount: 2, isCall: false, bullTaker: "sell" },
	// Not monotone in spot: a ranger pays inside a band, a fly and a condor pay
	// at a pin. No direction word may be printed for either side.
	{ name: "ranger", implementation: "RANGER", strikeCount: 4, isCall: false, bullTaker: null },
	{ name: "call fly", implementation: "CALL_FLY", strikeCount: 3, isCall: true, bullTaker: null },
	{ name: "iron condor", implementation: "IRON_CONDOR", strikeCount: 4, isCall: false, bullTaker: null },
	// The book carries binaries ("ETH 2460 Up 1D", teammate-measured 2026-09-05)
	// and inverse/physical calls. None of them is one of the four modelled
	// payoffs, so none of them is given a direction.
	{ name: "inverse call", implementation: "INVERSE_CALL", strikeCount: 1, isCall: true, bullTaker: null },
	{ name: "binary / unnamed implementation", implementation: null, strikeCount: 1, isCall: true, bullTaker: null },
];

function structureOf(row: (typeof KINDS)[number]): DirectionalStructure {
	return { isCall: row.isCall, riskKind: riskKindFor(row.implementation, row.strikeCount) };
}

describe("the ticket's Bull/Bear buttons name the ASSET's direction", () => {
	for (const row of KINDS) {
		test(`${row.name}: Bull fills the ${row.bullTaker ?? "(no direction)"} side`, () => {
			const structure = structureOf(row);
			expect(takerForDirection(structure, "bull")).toBe(row.bullTaker);
			expect(takerForDirection(structure, "bear")).toBe(
				row.bullTaker === null ? null : row.bullTaker === "buy" ? "sell" : "buy",
			);
			expect(directionNameable(structure)).toBe(row.bullTaker !== null);
		});
	}

	test("the two buttons never fill the same side of the book", () => {
		for (const row of KINDS) {
			const structure = structureOf(row);
			const bull = takerForSide(structure, "bull");
			const bear = takerForSide(structure, "bear");
			expect(bull).not.toBe(bear);
		}
	});

	/**
	 * THE PROOF. The label on the button and the word the position later prints
	 * come from two different functions; this asserts they are the same word for
	 * every classifiable structure and both sides.
	 */
	test("the position a button produces carries the button's own word", () => {
		const seen: string[] = [];
		for (const row of KINDS) {
			if (row.bullTaker === null) continue;
			const structure = structureOf(row);
			for (const side of ["bull", "bear"] as const) {
				const taker = takerForDirection(structure, side);
				expect(taker).not.toBeNull();
				// `positionDirection` is what `/p/<id>`, the share card, the OG
				// image, the portfolio row and the market rail all print.
				expect(positionDirection({ isCall: row.isCall, takerSide: taker as TakerSide })).toBe(side);
				seen.push(`${row.name} ${side} -> ${taker}`);
			}
		}
		expect(seen).toEqual([
			"call bull -> buy",
			"call bear -> sell",
			"put bull -> sell",
			"put bear -> buy",
			"physical put bull -> sell",
			"physical put bear -> buy",
			"call spread bull -> buy",
			"call spread bear -> sell",
			"put spread bull -> sell",
			"put spread bear -> buy",
		]);
	});

	test("every structure round-trips side -> taker -> side, directionless ones included", () => {
		for (const row of KINDS) {
			const structure = structureOf(row);
			for (const taker of ["buy", "sell"] as const) {
				expect(takerForSide(structure, directionOfSide(structure, taker))).toBe(taker);
			}
			for (const side of ["bull", "bear"] as const satisfies readonly TicketSide[]) {
				expect(directionOfSide(structure, takerForSide(structure, side))).toBe(side);
			}
		}
	});

	test("a directionless structure is labelled with the raw taker verb, never a guess", () => {
		const ranger = structureOf(KINDS.find((row) => row.name === "ranger")!);
		expect(directionForTaker(ranger, "buy")).toBeNull();
		expect(sideWord(ranger, "buy")).toBe("Buy");
		expect(sideWord(ranger, "sell")).toBe("Sell");
		const put = structureOf(KINDS.find((row) => row.name === "put")!);
		expect(sideWord(put, "buy")).toBe("Bear");
		expect(sideWord(put, "sell")).toBe("Bull");
	});

	test("CLASSIFIABLE is exactly the set riskKindFor can return", () => {
		const produced = new Set<RiskKind>();
		for (const [name, count] of [
			["PUT", 1],
			["PHYSICAL_PUT", 1],
			["LINEAR_CALL", 1],
			["PUT_SPREAD", 2],
			["CALL_SPREAD", 2],
		] as const) {
			const kind = riskKindFor(name, count);
			if (kind !== null) produced.add(kind);
		}
		expect([...produced].sort()).toEqual(["call", "call-spread", "put", "put-spread"]);
		expect([...CLASSIFIABLE].sort()).toEqual(["call", "call-spread", "put", "put-spread"]);
	});

	/**
	 * MUTATION FENCE. Swapping the put branch — i.e. going back to "Bull always
	 * buys" — must break this test. Written as the mutant itself so the
	 * assertion cannot pass vacuously.
	 */
	test("MUTANT: the pre-fold mapping (Bull always buys) is REJECTED", () => {
		const preFold = (side: TicketSide): TakerSide => (side === "bull" ? "buy" : "sell");
		const put = structureOf(KINDS.find((row) => row.name === "put")!);
		expect(preFold("bull")).toBe("buy");
		expect(takerForDirection(put, "bull")).toBe("sell");
		expect(takerForDirection(put, "bull")).not.toBe(preFold("bull"));
		// And the pre-fold mapping would have produced a BEAR position under a
		// button labelled Bull — the defect this fold removes.
		expect(positionDirection({ isCall: false, takerSide: preFold("bull") })).toBe("bear");
	});
});

// ------------------------------------------------------- the ticket sentence

const ORDER = { availableAmount: 1_000_000n, pricePerContract: 100_000_000n } as Market;

function liveStructure(over: Partial<LiveStructure>): LiveStructure {
	return {
		id: "s",
		asset: "ETH",
		expiry: 1800000000n,
		expiryAt: "2027-01-15T08:00:00Z",
		productType: "put",
		implementationName: "PUT",
		implementationAddress: "0x0",
		isCall: false,
		riskKind: "put",
		strikes: [234000000000n],
		strikesUsd: ["2340"],
		collateralAddress: "0x0",
		collateralSymbol: "USDC",
		collateralDecimals: 6,
		buy: ORDER,
		sell: ORDER,
		...over,
	};
}

const REFUSED = { ok: false as const, code: "NOT_QUOTED", reason: "test" };

describe("the sentence under the buttons names the same direction as the button", () => {
	test("a PUT: buying is Bear, selling is Bull", () => {
		const put = liveStructure({});
		expect(sideNoteFor(put, "buy", REFUSED)).toBe(
			"Bear buys the ETH put 2,340 P and pays premium. The premium is the most you can lose.",
		);
		expect(sideNoteFor(put, "sell", REFUSED)).toBe(
			"Bull sells the ETH put 2,340 P and posts collateral. Your loss can reach the collateral you post.",
		);
	});

	test("a CALL keeps the mockup's own reading", () => {
		const call = liveStructure({ isCall: true, riskKind: "call", productType: "call", implementationName: "LINEAR_CALL" });
		expect(sideNoteFor(call, "buy", REFUSED)).toBe(
			"Bull buys the ETH call 2,340 C and pays premium. The premium is the most you can lose.",
		);
		expect(sideNoteFor(call, "sell", REFUSED)).toBe(
			"Bear sells the ETH call 2,340 C and posts collateral. Your loss can reach the collateral you post.",
		);
	});

	test("a RANGER carries no direction word at all", () => {
		const ranger = liveStructure({
			productType: "ranger",
			implementationName: "RANGER",
			riskKind: null,
			strikes: [720000000000n, 880000000000n],
			strikesUsd: ["72000", "88000"],
		});
		const buy = sideNoteFor(ranger, "buy", REFUSED);
		expect(buy).toBe("Buying the ETH ranger 72,000 / 88,000 pays premium. The premium is the most you can lose.");
		expect(buy).not.toContain("Bull");
		expect(buy).not.toContain("Bear");
		const sell = sideNoteFor(ranger, "sell", REFUSED);
		expect(sell).toBe(
			"Selling the ETH ranger 72,000 / 88,000 posts collateral. Your loss can reach the collateral you post.",
		);
		expect(sell).not.toContain("Bull");
		expect(sell).not.toContain("Bear");
	});
});
