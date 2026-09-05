import { expect, test } from "bun:test";
import { generateDefaultIdentity, DEFAULT_HANDLE_RE, DEFAULT_DISPLAY_NAME_RE } from "./default-identity";
import { validateProfile } from "./validation";

test("default identity has matching digits and zero padding", () => {
	const identity = generateDefaultIdentity(max => { expect(max).toBe(10000); return 7; });
	expect(identity).toEqual({ handle: "thesis_0007", displayName: "thesis-0007" });
	expect(identity.handle).toMatch(DEFAULT_HANDLE_RE);
	expect(identity.displayName).toMatch(DEFAULT_DISPLAY_NAME_RE);
	expect(identity.handle.slice(-4)).toBe(identity.displayName.slice(-4));
});
test("generated handles pass the actual profile validator at both boundaries", () => {
	for (const number of [0, 9999]) {
		const identity = generateDefaultIdentity(() => number);
		expect(validateProfile(identity)).toEqual({ fields: identity });
	}
});
test("1000 default Web Crypto draws stay in the four-digit range", () => {
	for (let i = 0; i < 1000; i++) {
		const identity = generateDefaultIdentity();
		expect(identity.handle).toMatch(DEFAULT_HANDLE_RE);
		expect(identity.displayName).toMatch(DEFAULT_DISPLAY_NAME_RE);
		const number = Number(identity.handle.slice(-4));
		expect(number).toBeGreaterThanOrEqual(0);
		expect(number).toBeLessThan(10000);
	}
});
test("invalid injected random values are rejected", () => {
	for (const number of [-1, 10000, 0.5, NaN]) expect(() => generateDefaultIdentity(() => number)).toThrow(RangeError);
});
