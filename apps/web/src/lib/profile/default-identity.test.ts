import { expect, test } from "bun:test";
import { cryptoRandomInt, generateDefaultIdentity, DEFAULT_HANDLE_RE, DEFAULT_DISPLAY_NAME_RE } from "./default-identity";
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

/**
 * B-C5. The rejection sampling that keeps the four digits UNBIASED.
 *
 * 2^32 = 4,294,967,296 is not a multiple of 10,000: the last 7,296 values of
 * the range would map onto 0000-7295 twice, so they are drawn again. Real
 * randomness reaches that branch about once in 588,000 draws, which is why the
 * reviewer could delete the loop (`while (value >= limit)` -> `while (false)`)
 * and still measure 4 pass / 0 fail. These draws are hand-picked to land on
 * either side of the boundary.
 */
test("B-C5: a draw past the uniform limit is REDRAWN, not taken modulo", () => {
	const limit = 2 ** 32 - (2 ** 32) % 10000;
	expect(limit).toBe(4_294_960_000);
	const draws = [4_294_967_295, 7];
	let taken = 0;
	const value = cryptoRandomInt(10000, (buffer) => {
		buffer[0] = draws[taken] ?? 0;
		taken += 1;
	});
	// Both draws were consumed: the first was rejected.
	expect(taken).toBe(2);
	expect(value).toBe(7);
	// Without the loop the first draw would have been taken modulo 10,000:
	expect(4_294_967_295 % 10000).toBe(7295);
});

test("B-C5: the last accepted value and the first rejected one sit either side of the limit", () => {
	const at = (draw: number) => {
		let taken = 0;
		const value = cryptoRandomInt(10000, (buffer) => {
			buffer[0] = taken === 0 ? draw : 42;
			taken += 1;
		});
		return { taken, value };
	};
	// 4,294,959,999 is the last accepted draw.
	expect(at(4_294_959_999)).toEqual({ taken: 1, value: 9999 });
	// 4,294,960,000 is the first rejected one.
	expect(at(4_294_960_000)).toEqual({ taken: 2, value: 42 });
});

test("B-C5: generateDefaultIdentity uses that generator by default", () => {
	// A real draw, through the real default path, still produces a valid handle.
	expect(generateDefaultIdentity().handle).toMatch(DEFAULT_HANDLE_RE);
});
