/**
 * C12-r2 (lane C confirming pass, finding 12). PRD 8.4: "The app must not
 * silently substitute another asset, expiry, or direction."
 *
 * The attachment check only compared the underlying asset, so a fill on an ETH
 * December call could be recorded as a participant of a post about an ETH
 * October put. These pin every part of the instrument that decides that.
 */
import { describe, expect, test } from "bun:test";
import { instrumentMismatch, postStrikesUsd8, type PostStructure } from "./attachment";

/** 2026-12-25T08:00:00Z, the shape `theses.expiry_at` stores. */
const EXPIRY_SECONDS = 1_798_617_600n;

const structure = {
	expiry: EXPIRY_SECONDS,
	isCall: false,
	// 8-decimal USD, ascending, as `lib/market/live.ts` builds them.
	strikes: [7_400_000_000_000n, 7_800_000_000_000n] as readonly bigint[],
};

const post: PostStructure = {
	expiryAt: new Date(Number(EXPIRY_SECONDS) * 1000),
	isCall: false,
	strikes: ["7400000000000", "7800000000000"],
	strikeDecimals: 8,
};

describe("instrumentMismatch", () => {
	test("the post's own instrument matches", () => {
		expect(instrumentMismatch(post, structure)).toBeNull();
	});

	test("a different expiry is refused", () => {
		const later = new Date(Number(EXPIRY_SECONDS + 86_400n) * 1000);
		expect(instrumentMismatch({ ...post, expiryAt: later }, structure)).toBe("expiry");
		// One second is still a different option.
		expect(instrumentMismatch({ ...post, expiryAt: new Date(Number(EXPIRY_SECONDS) * 1000 + 1000) }, structure)).toBe(
			"expiry",
		);
	});

	test("a call is not a put", () => {
		expect(instrumentMismatch({ ...post, isCall: true }, structure)).toBe("direction");
		expect(instrumentMismatch(post, { ...structure, isCall: true })).toBe("direction");
	});

	test("different strikes are refused, including a subset and an extra leg", () => {
		expect(instrumentMismatch({ ...post, strikes: ["7400000000000", "7900000000000"] }, structure)).toBe("strikes");
		expect(instrumentMismatch({ ...post, strikes: ["7400000000000"] }, structure)).toBe("strikes");
		expect(
			instrumentMismatch({ ...post, strikes: ["7400000000000", "7800000000000", "8000000000000"] }, structure),
		).toBe("strikes");
	});

	test("strike order is not part of the identity: the same legs match either way", () => {
		expect(instrumentMismatch({ ...post, strikes: ["7800000000000", "7400000000000"] }, structure)).toBeNull();
	});

	test("a post stored at another strike scale is rescaled, not rejected", () => {
		// The same two strikes at 6 decimals.
		expect(
			instrumentMismatch({ ...post, strikes: ["74000000000", "78000000000"], strikeDecimals: 6 }, structure),
		).toBeNull();
	});

	test("anything unreadable fails closed", () => {
		expect(instrumentMismatch({ ...post, expiryAt: null }, structure)).toBe("expiry");
		expect(instrumentMismatch({ ...post, isCall: null }, structure)).toBe("direction");
		expect(instrumentMismatch({ ...post, strikes: null }, structure)).toBe("strikes");
		expect(instrumentMismatch({ ...post, strikeDecimals: null }, structure)).toBe("strikes");
		expect(instrumentMismatch({ ...post, strikes: [] }, structure)).toBe("strikes");
		expect(instrumentMismatch({ ...post, strikes: ["not-a-number"] }, structure)).toBe("strikes");
		expect(instrumentMismatch({ ...post, strikes: ["-1"] }, structure)).toBe("strikes");
	});
});

describe("postStrikesUsd8", () => {
	test("rescales up and down, exactly", () => {
		expect(postStrikesUsd8(["1"], 0)).toEqual([100_000_000n]);
		expect(postStrikesUsd8(["100000000"], 8)).toEqual([100_000_000n]);
		expect(postStrikesUsd8(["1000000000"], 9)).toEqual([100_000_000n]);
	});

	test("a value that a finer scale cannot express at 8 decimals is refused, never rounded", () => {
		expect(postStrikesUsd8(["1000000001"], 9)).toBeNull();
	});

	test("returns ascending values whatever order they were stored in", () => {
		expect(postStrikesUsd8(["3", "1", "2"], 8)).toEqual([1n, 2n, 3n]);
	});

	test("nonsense scales are refused", () => {
		for (const decimals of [-1, 1.5, 31]) expect(postStrikesUsd8(["1"], decimals)).toBeNull();
	});
});
