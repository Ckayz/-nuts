/**
 * Which row the market page opens on.
 *
 * The screenshot pass (2026-09-05) caught the ticket landing on a BTC row that
 * read "Max payout 0×" — the worst thing in the book presented as the default
 * trade — because the old rule took the first row that could be QUOTED and
 * looked no further. These fixtures pin the new rule and its fallbacks, and
 * they read the same table row the user sees (`structureRow`) so the choice and
 * the pixels cannot drift apart.
 */
import { expect, test } from "bun:test";
import type { Market } from "@nuts/thetanuts";
import { pickDefaultStructure, structureRow, structureWorthOpening, type LiveStructure } from "./live";

const ONE = 100_000_000n; // 1e8, the book's price/strike scale

/** A USDC put whose payout multiple is (strike - price) / price. */
function put(id: string, priceE8: bigint, strikeE8: bigint, availableAmount = 1_000_000n): LiveStructure {
	return {
		id, asset: "BTC", expiry: 1800000000n, expiryAt: "2027-01-15T08:00:00Z",
		productType: "put", implementationName: "PUT", implementationAddress: "0x0",
		isCall: false, riskKind: "put", strikes: [strikeE8], strikesUsd: [String(strikeE8 / ONE)],
		collateralAddress: "0x0", collateralSymbol: "USDC", collateralDecimals: 6,
		buy: { availableAmount, pricePerContract: priceE8 } as Market, sell: null,
	};
}

const always = () => true;

// price 1.00, strike 1.02 -> (0.02 / 1.00) rounds to one decimal as "0" -> "0×"
const worthless = put("worthless", ONE, ONE + 2_000_000n);
// price 1.00, strike 5.00 -> 4.0x
const good = put("good", ONE, 5n * ONE);

test("the fixture reproduces the screenshot: row 1 really does print Max payout 0×", () => {
	expect(structureRow(worthless, "").maxPayoutLabel).toBe("0×");
	expect(structureRow(good, "").maxPayoutLabel).toBe("4×");
	expect(structureWorthOpening(worthless)).toBe(false);
	expect(structureWorthOpening(good)).toBe(true);
});

test("a 0x row is skipped for the next row that has a payout", () => {
	expect(pickDefaultStructure([worthless, good], always).id).toBe("good");
	// Order is the book's: the FIRST qualifying row wins, not the best one.
	const better = put("better", ONE, 9n * ONE);
	expect(pickDefaultStructure([worthless, good, better], always).id).toBe("good");
});

test("a row with no liquidity left is skipped even when its payout is good", () => {
	const empty = put("empty", ONE, 5n * ONE, 0n);
	expect(structureRow(empty, "").liquidityLeftUsd.usd).toBe("$0");
	expect(structureWorthOpening(empty)).toBe(false);
	expect(pickDefaultStructure([empty, good], always).id).toBe("good");
});

test("a row whose payout multiple is UNKNOWN is not chosen as the landing row", () => {
	// Unproven contract units (8-decimal collateral) print an em dash, not a number.
	const unknown: LiveStructure = { ...good, id: "unknown", collateralDecimals: 8, collateralSymbol: "cbBTC" };
	expect(structureRow(unknown, "").maxPayoutLabel).toBe("—");
	expect(structureWorthOpening(unknown)).toBe(false);
	expect(pickDefaultStructure([unknown, good], always).id).toBe("good");
});

test("when nothing qualifies the first QUOTABLE row is kept, exactly as before", () => {
	const alsoWorthless = put("worthless2", ONE, ONE + 2_000_000n);
	expect(pickDefaultStructure([worthless, alsoWorthless], always).id).toBe("worthless");
	// Unquotable rows are still skipped for a quotable one, the old behaviour.
	const quotable = (structure: LiveStructure) => structure.id !== "worthless";
	expect(pickDefaultStructure([worthless, alsoWorthless], quotable).id).toBe("worthless2");
});

test("with no quotable row at all it falls back to the first row", () => {
	expect(pickDefaultStructure([worthless, good], () => false).id).toBe("worthless");
	expect(() => pickDefaultStructure([], always)).toThrow("No structures to choose from");
});

test("a qualifying row is only chosen when it can be quoted", () => {
	// `good` qualifies on paper but cannot be quoted: the old fallback wins.
	const quotable = (structure: LiveStructure) => structure.id !== "good";
	expect(pickDefaultStructure([worthless, good], quotable).id).toBe("worthless");
});
