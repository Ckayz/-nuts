import { describe, expect, test } from "bun:test";
import {
	decimalFromBaseUnits,
	decimalFromNullableBaseUnits,
	sumDecimals,
	usdDecimalOrNull,
} from "./decimal";
import { creatorHandle, creatorInitials } from "./identity";

describe("decimalFromBaseUnits", () => {
	const cases: [string, number, string][] = [
		["0", 0, "0"],
		["123", 0, "123"],
		["0", 6, "0"],
		["1", 6, "0.000001"],
		["1000000", 6, "1"],
		["1234567", 6, "1.234567"],
		["1200000", 6, "1.2"],
		["100", 8, "0.000001"],
		// A USDC premium far past 2^53 base units: no float can hold this.
		["123456789012345678901234567890", 18, "123456789012.34567890123456789"],
		["-1500000", 6, "-1.5"],
		["-1", 18, "-0.000000000000000001"],
	];
	for (const [value, decimals, expected] of cases) {
		test(`${value} @ ${decimals} -> ${expected}`, () => {
			expect(decimalFromBaseUnits(value, decimals)).toBe(expected);
		});
	}

	test("rejects a fractional base-unit value", () => {
		expect(() => decimalFromBaseUnits("1.5", 6)).toThrow("integer string");
	});
	test("rejects negative decimals", () => {
		expect(() => decimalFromBaseUnits("1", -1)).toThrow("non-negative integer");
	});
	test("rejects fractional decimals", () => {
		expect(() => decimalFromBaseUnits("1", 1.5)).toThrow("non-negative integer");
	});
	test("survives a round trip through the display decimal pattern", () => {
		// lib/display.ts rejects anything that does not match this exact shape.
		for (const [value, decimals] of cases.map(([v, d]) => [v, d] as const)) {
			expect(decimalFromBaseUnits(value, decimals)).toMatch(/^-?\d+(?:\.\d+)?$/);
		}
	});
});

describe("decimalFromNullableBaseUnits", () => {
	test("null value stays null", () => {
		expect(decimalFromNullableBaseUnits(null, 6)).toBeNull();
	});
	test("null decimals stays null rather than guessing a scale", () => {
		expect(decimalFromNullableBaseUnits("1000000", null)).toBeNull();
	});
	test("converts when both halves are present", () => {
		expect(decimalFromNullableBaseUnits("2500000", 6)).toBe("2.5");
	});
});

describe("usdDecimalOrNull", () => {
	test("passes a plain decimal through unchanged", () => {
		expect(usdDecimalOrNull("1234.56")).toBe("1234.56");
		expect(usdDecimalOrNull("-0.01")).toBe("-0.01");
	});
	test("trims the whitespace a numeric column can carry", () => {
		expect(usdDecimalOrNull(" 12 ")).toBe("12");
	});
	test("rejects NaN, exponent form and a leading plus", () => {
		expect(usdDecimalOrNull("NaN")).toBeNull();
		expect(usdDecimalOrNull("1e6")).toBeNull();
		expect(usdDecimalOrNull("+1")).toBeNull();
	});
	test("null stays null", () => {
		expect(usdDecimalOrNull(null)).toBeNull();
	});
});

describe("sumDecimals", () => {
	test("adds mixed scales exactly", () => {
		expect(sumDecimals(["1.5", "2.25", "3"])).toBe("6.75");
	});
	test("adds past double precision without loss", () => {
		expect(sumDecimals(["9007199254740993", "1"])).toBe("9007199254740994");
	});
	test("handles negatives and cancels to zero", () => {
		expect(sumDecimals(["-1.5", "1.5"])).toBe("0");
	});
	test("empty sum is zero", () => {
		expect(sumDecimals([])).toBe("0");
	});
});

describe("route identity derived from today's schema", () => {
	test("creator fallback is the lowercase address", () => {
		expect(creatorHandle("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(
			"0xabcdef0123456789abcdef0123456789abcdef01",
		);
	});
	test("initials come from a display name when the user set one", () => {
		expect(creatorInitials("Merkle Mike", "0xabcdef0123456789abcdef0123456789abcdef01")).toBe("MM");
		expect(creatorInitials("nutsauce", "0xabcdef0123456789abcdef0123456789abcdef01")).toBe("NU");
	});
	test("initials fall back to the address when there is no display name", () => {
		expect(creatorInitials(null, "0xabcdef0123456789abcdef0123456789abcdef01")).toBe("AB");
	});
});
