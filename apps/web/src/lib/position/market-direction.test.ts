import { expect, test } from "bun:test";
import { marketDirection } from "./instrument";

/**
 * Standard options semantics. These four rows ARE the specification: if any one
 * of them flips, a real money position is being described backwards to its
 * owner.
 */
test("the four option positions map to the direction they actually bet on", () => {
	expect(marketDirection({ isCall: true, takerSide: "buy" })).toBe("bull");
	expect(marketDirection({ isCall: false, takerSide: "sell" })).toBe("bull");
	expect(marketDirection({ isCall: false, takerSide: "buy" })).toBe("bear");
	expect(marketDirection({ isCall: true, takerSide: "sell" })).toBe("bear");
});

test("direction is a property of the option, never of whose side of a thesis it is", () => {
	// The defect this replaces: `side === "back" ? "Bull" : "Bear"`. Backing a
	// BEAR thesis is a bear position, so no "back"/"counter" value may appear
	// anywhere in this derivation. Selling a call is bearish whoever posted it.
	expect(marketDirection({ isCall: true, takerSide: "sell" })).toBe("bear");
	expect(marketDirection({ isCall: false, takerSide: "buy" })).toBe("bear");
});
