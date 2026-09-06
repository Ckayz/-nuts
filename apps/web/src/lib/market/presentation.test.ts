import { expect, test } from "bun:test";
import type { Market } from "@nuts/thetanuts";
import { collateralAmount, structureRow, ticketFrom, type LiveStructure } from "./live";

const structure: LiveStructure = {
	id: "row", asset: "BTC", expiry: 1800000000n, expiryAt: "2027-01-15T08:00:00Z",
	productType: "ranger", implementationName: "RANGER", implementationAddress: "0x0",
	isCall: true, riskKind: null, strikes: [10000000000n, 20000000000n], strikesUsd: ["100", "200"],
	collateralAddress: "0x0", collateralSymbol: "cbBTC", collateralDecimals: 8,
	// Only the two fields this presentation boundary reads; no SDK call is made.
	buy: { availableAmount: 100000000n, pricePerContract: 100000000n } as Market, sell: null,
};
test("unvalued cbBTC liquidity is token units and Ranger has no call suffix", () => {
	const row = structureRow(structure, structure.id);
	expect(row.liquidityLeftUsd.usd).toBe("1.0000 cbBTC");
	expect(row.premiumPerContractUsd.usd).toBe("—"); // contract-size decimals unproven
	expect(row.strikesLabel).toBe("100 / 200");
});
test("valued collateral retains USD; unvalued token premium and presets carry symbols", () => {
	expect(collateralAmount("1", "USDC").usd2).toBe("$1.00");
	const row = structureRow({ ...structure, collateralDecimals: 6, collateralSymbol: "UNKNOWN" }, "row");
	expect(row.premiumPerContractUsd.usd2).toBe("1.0000 UNKNOWN");
	expect(row.maxPayoutLabel).toBe("—");
	const ticket = ticketFrom(structure, { ok: false, code: "NOT_QUOTED", reason: "test" }, "");
	expect(ticket.presetsUsd.every(preset => preset.usd.endsWith(" cbBTC"))).toBe(true);
});
