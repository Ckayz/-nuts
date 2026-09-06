/**
 * The RFQ escrow ceiling. Offline: the gate reads only its argument and the
 * app's own collateral/USD table, so nothing here needs a chain or a database.
 */
import { describe, expect, test } from "bun:test";
import { withinRfqDepositLimit, MAX_RFQ_DEPOSIT_USD } from "./limits";

const usdc = (depositBaseUnits: string) => ({
	depositBaseUnits,
	collateralSymbol: "USDC",
	collateralDecimals: 6,
});

describe("the RFQ escrow gate", () => {
	test("the ceiling is the PRD's 10 USD, not this file's number", () => {
		expect(MAX_RFQ_DEPOSIT_USD).toBe(10);
	});

	test("passes an escrow inside the ceiling and reports what it valued", () => {
		const gate = withinRfqDepositLimit(usdc("2500000"));
		expect(gate).toEqual({ ok: true, depositUsd: "2.5" });
	});

	test("EXACTLY the ceiling passes; one base unit more does not", () => {
		expect(withinRfqDepositLimit(usdc("10000000")).ok).toBe(true);
		const over = withinRfqDepositLimit(usdc("10000001"));
		expect(over.ok).toBe(false);
		if (over.ok) throw new Error("unreachable");
		expect(over.code).toBe("RFQ_OVER_LIMIT");
		// The sentence states the amount it measured, so the refusal is checkable.
		expect(over.reason).toContain("10.000001 USD");
		expect(over.reason).toContain("10 USD agent limit");
		expect(over.reason).toContain("Nothing was prepared");
	});

	test("a non-USDC collateral is refused rather than valued", () => {
		const gate = withinRfqDepositLimit({
			depositBaseUnits: "1",
			collateralSymbol: "aBasUSDC",
			collateralDecimals: 6,
		});
		expect(gate.ok).toBe(false);
		if (gate.ok) throw new Error("unreachable");
		expect(gate.code).toBe("RFQ_COLLATERAL_NOT_ALLOWED");
		expect(gate.reason).toContain("aBasUSDC");
	});

	test("an unreadable escrow is refused, never waved through", () => {
		for (const bad of ["", "1.5", "-1", "0x10", "1e6", "  10  "]) {
			const gate = withinRfqDepositLimit(usdc(bad));
			expect(gate.ok).toBe(false);
			if (gate.ok) throw new Error("unreachable");
			expect(gate.code).toBe("RFQ_DEPOSIT_UNREADABLE");
		}
	});

	test("a zero escrow is inside the ceiling — refusing it is `packages/thetanuts`'s job, not this one's", () => {
		// RFQ_ZERO_DEPOSIT is raised by `buildRfqCreate` before this gate ever
		// runs; a spend control that also refused zero would be asserting a
		// product rule it does not own.
		expect(withinRfqDepositLimit(usdc("0")).ok).toBe(true);
	});

	test("the ceiling is on the ESCROW, so more contracts at the same reserve can cross it", () => {
		// 0.5 USDC per contract: 20 contracts is exactly the ceiling, 21 is over.
		const escrow = (contracts: number) => String(500_000 * contracts);
		expect(withinRfqDepositLimit(usdc(escrow(20))).ok).toBe(true);
		expect(withinRfqDepositLimit(usdc(escrow(21))).ok).toBe(false);
	});
});
