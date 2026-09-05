import { describe, expect, test } from "bun:test";
import { formatBaseUnits, formatUsd8, parseTokenAmount, ratioToOneDecimal } from "./units";
import { ascendingStrikes, orderLabel, productLabel, riskKindFor, structureIdOf } from "./structures";

describe("formatBaseUnits", () => {
	test("reproduces the decoded production fills", () => {
		// .research/thetanuts/finding-fill-debits.md, tx 0x9c4bb1…: premium
		// 999998 base units of 6-decimal USDC = 0.999998 USDC.
		expect(formatBaseUnits(999998n, 6)).toBe("0.999998");
		// tx 0xdf3323…: seller collateral 22000000 aBasUSDC base units.
		expect(formatBaseUnits(22000000n, 6)).toBe("22");
		// Strikes are 8-decimal: 220000000000 = 2200.
		expect(formatBaseUnits(220000000000n, 8)).toBe("2200");
		expect(formatBaseUnits(0n, 6)).toBe("0");
		expect(formatBaseUnits(1n, 18)).toBe("0.000000000000000001");
		expect(formatBaseUnits(-1500000n, 6)).toBe("-1.5");
		expect(formatBaseUnits(42n, 0)).toBe("42");
	});
	test("agrees with the adapter's own decimalString", async () => {
		const { decimalString } = await import("@/lib/thetanuts/orders");
		for (const [value, decimals] of [
			[999998n, 6],
			[22000000n, 6],
			[220000000000n, 8],
			[123n, 8],
			[10n ** 21n + 7n, 18],
		] as const) {
			expect(formatBaseUnits(value, decimals)).toBe(decimalString(value, 10n ** BigInt(decimals)));
		}
	});
});

describe("parseTokenAmount", () => {
	test("scales by the token's decimals", () => {
		expect(parseTokenAmount("250", 6)).toBe(250_000_000n);
		expect(parseTokenAmount("0.999998", 6)).toBe(999998n);
		expect(parseTokenAmount("1,000", 6)).toBe(1_000_000_000n);
	});
	test("refuses more precision than the token carries, instead of truncating", () => {
		expect(() => parseTokenAmount("0.1234567", 6)).toThrow(/decimal places/);
	});
	test("refuses anything that is not a positive decimal", () => {
		for (const bad of ["-1", "", "abc", "1e6", "0x10", " 1.2.3 "]) {
			expect(() => parseTokenAmount(bad, 6)).toThrow();
		}
	});
	test("round-trips against formatBaseUnits", () => {
		for (const value of ["0", "1", "250", "0.000001", "12345.678901"]) {
			expect(formatBaseUnits(parseTokenAmount(value, 6), 6)).toBe(value === "0" ? "0" : String(Number(value)));
		}
	});
});

describe("formatUsd8 and ratioToOneDecimal", () => {
	test("USD 8dp", () => {
		expect(formatUsd8(2_200_000_000n)).toBe("22");
		expect(formatUsd8(185_420_000_000n)).toBe("1854.2");
	});
	test("payout multiple rounds half-up on one digit", () => {
		// A 73,000 put at 39.35238910 per contract, measured on the live book
		// 2026-09-05: (7300000000000 − 3935238910) / 3935238910 = 1854.03…
		expect(ratioToOneDecimal(7_300_000_000_000n - 3_935_238_910n, 3_935_238_910n)).toBe("1854");
		expect(ratioToOneDecimal(15n, 10n)).toBe("1.5");
		expect(ratioToOneDecimal(114n, 100n)).toBe("1.1");
		expect(ratioToOneDecimal(115n, 100n)).toBe("1.2");
		expect(ratioToOneDecimal(1n, 0n)).toBeNull();
	});
});

describe("structure identity", () => {
	const identity = {
		priceFeed: "0x64C911996D3c6aC71f9b455B1E8E7266BcbD848F",
		implementationAddress: "0x6aD53DD058bea004829cCf58a282C21a7Df02DcA",
		collateralAddress: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
		isCall: false,
		strikes: [7_300_000_000_000n],
		expiry: 1_789_113_600n,
	};
	test("is case-insensitive in addresses and stable", () => {
		const lower = {
			...identity,
			priceFeed: identity.priceFeed.toLowerCase(),
			implementationAddress: identity.implementationAddress.toLowerCase(),
			collateralAddress: identity.collateralAddress.toLowerCase(),
		};
		expect(structureIdOf(lower)).toBe(structureIdOf(identity));
		expect(structureIdOf(identity)).toMatch(/^[0-9a-f]{16}$/);
	});
	test("changes with every field it covers", () => {
		const base = structureIdOf(identity);
		expect(structureIdOf({ ...identity, isCall: true })).not.toBe(base);
		expect(structureIdOf({ ...identity, strikes: [7_300_000_000_001n] })).not.toBe(base);
		expect(structureIdOf({ ...identity, expiry: identity.expiry + 1n })).not.toBe(base);
		expect(structureIdOf({ ...identity, collateralAddress: "0x0000000000000000000000000000000000000001" })).not.toBe(base);
		expect(structureIdOf({ ...identity, implementationAddress: "0x0000000000000000000000000000000000000001" })).not.toBe(base);
		expect(structureIdOf({ ...identity, priceFeed: "0x0000000000000000000000000000000000000001" })).not.toBe(base);
	});
});

describe("risk classification", () => {
	test("only the four shapes the package models are claimed", () => {
		expect(riskKindFor("PHYSICAL_PUT", 1)).toBe("put");
		expect(riskKindFor("PUT", 1)).toBe("put");
		expect(riskKindFor("LINEAR_CALL", 1)).toBe("call");
		expect(riskKindFor("PUT_SPREAD", 2)).toBe("put-spread");
		expect(riskKindFor("CALL_SPREAD", 2)).toBe("call-spread");
		// Every shape with no payoff model in packages/thetanuts/src/risk.ts.
		for (const name of ["RANGER", "PUT_FLY", "CALL_FLY", "IRON_CONDOR", "PHYSICAL_CALL", null]) {
			expect(riskKindFor(name, 4)).toBeNull();
		}
		// A strike count that disagrees with the name is not classified.
		expect(riskKindFor("PUT", 2)).toBeNull();
		expect(riskKindFor("PUT_SPREAD", 1)).toBeNull();
	});
	test("ascendingStrikes sorts numerically, not lexically", () => {
		expect(ascendingStrikes([7_400_000_000_000n, 780_000_000_000n])).toEqual([
			780_000_000_000n,
			7_400_000_000_000n,
		]);
	});
});

describe("labels", () => {
	test("product wording comes from the SDK implementation name", () => {
		expect(productLabel("PUT_SPREAD", "0xabc")).toBe("put spread");
		expect(productLabel("PHYSICAL_PUT", "0xabc")).toBe("physical put");
		expect(productLabel(null, "0xabc")).toBe("0xabc");
	});
	test("order label matches the mockup's shape", () => {
		expect(orderLabel(["78000", "74000"], "PUT_SPREAD", false)).toBe("78000/74000-PS");
		expect(orderLabel(["76000"], "PHYSICAL_PUT", false)).toBe("76000-PP");
		expect(orderLabel(["85000"], null, true)).toBe("85000-C");
	});
});
