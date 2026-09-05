/**
 * C#5. The approval decoder: what an approval transaction will actually do,
 * read from the bytes that will be sent.
 */
import { describe, expect, test } from "bun:test";
import { APPROVE_SELECTOR, approvalMatches, decodeApproval, fillIsStale, MAX_FILL_AGE_MS } from "./approval";

const SPENDER = "0x1bdff855d6811728acadc00989e79143a2bdfded";
const word = (hex: string) => hex.padStart(64, "0");
const approveData = (spender: string, amount: bigint) =>
	`${APPROVE_SELECTOR}${word(spender.slice(2).toLowerCase())}${word(amount.toString(16))}`;

describe("decodeApproval", () => {
	test("reads the spender and the amount out of real approve calldata", () => {
		expect(decodeApproval(approveData(SPENDER, 5_000_000n))).toEqual({ spender: SPENDER, amount: "5000000" });
	});

	test("an unlimited approval is read as the number it is (PRD 10.1 forbids asking for one)", () => {
		const max = (1n << 256n) - 1n;
		expect(decodeApproval(approveData(SPENDER, max))?.amount).toBe(max.toString());
	});

	test("checksum-cased calldata decodes to a lowercase spender", () => {
		expect(decodeApproval(approveData("0x1bDff855d6811728acaDC00989e79143a2bdfDed", 1n))?.spender).toBe(SPENDER);
	});

	test("anything that is not a plain approve fails CLOSED", () => {
		// `transfer(address,uint256)`.
		expect(decodeApproval(`0xa9059cbb${word(SPENDER.slice(2))}${word("1")}`)).toBeNull();
		// Truncated, over-long, empty, non-hex.
		expect(decodeApproval(approveData(SPENDER, 1n).slice(0, -2))).toBeNull();
		expect(decodeApproval(`${approveData(SPENDER, 1n)}00`)).toBeNull();
		expect(decodeApproval("0x")).toBeNull();
		expect(decodeApproval("not calldata")).toBeNull();
		// A spender word with dirty high-order bytes is NOT an address.
		expect(decodeApproval(`${APPROVE_SELECTOR}${"f".repeat(24)}${SPENDER.slice(2)}${word("1")}`)).toBeNull();
	});
});

describe("approvalMatches (PRD 10.2: allowances must be exact)", () => {
	const ok = { data: approveData(SPENDER, 5_000_000n), expectedSpender: SPENDER, expectedAmount: "5000000" };

	test("the exact allowance to the exact spender passes", () => {
		expect(approvalMatches(ok)).toEqual({ ok: true });
		// The expected spender may arrive checksum-cased.
		expect(approvalMatches({ ...ok, expectedSpender: "0x1bDff855d6811728acaDC00989e79143a2bdfDed" })).toEqual({ ok: true });
	});

	test("ONE base unit more is refused — there is no tolerance", () => {
		const more = approvalMatches({ ...ok, data: approveData(SPENDER, 5_000_001n) });
		expect(more.ok).toBe(false);
		if (more.ok) throw new Error("unreachable");
		expect(more.reason).toContain("exactly");
	});

	test("one base unit LESS is refused too", () => {
		expect(approvalMatches({ ...ok, data: approveData(SPENDER, 4_999_999n) }).ok).toBe(false);
	});

	test("an allowance to another contract is refused", () => {
		const other = approvalMatches({ ...ok, data: approveData(`0x${"9".repeat(40)}`, 5_000_000n) });
		expect(other.ok).toBe(false);
		if (other.ok) throw new Error("unreachable");
		expect(other.reason).toContain("not the contract this fill calls");
	});

	test("unreadable calldata is refused, never assumed harmless", () => {
		expect(approvalMatches({ ...ok, data: "0xdead" }).ok).toBe(false);
	});
});

describe("fillIsStale (C#8, PRD 14: 30 seconds fetch-to-broadcast)", () => {
	const now = Date.parse("2026-09-05T12:00:00.000Z");
	const ago = (ms: number) => new Date(now - ms).toISOString();

	test("inside the window is fresh, the boundary included", () => {
		expect(fillIsStale(ago(0), now)).toBe(false);
		expect(fillIsStale(ago(29_999), now)).toBe(false);
		expect(fillIsStale(ago(MAX_FILL_AGE_MS), now)).toBe(false);
	});

	test("one millisecond past the window is stale", () => {
		expect(fillIsStale(ago(MAX_FILL_AGE_MS + 1), now)).toBe(true);
		// The reviewer's probe.
		expect(fillIsStale(ago(31_000), now)).toBe(true);
	});

	test("an unknown, unparseable or future timestamp fails CLOSED", () => {
		expect(fillIsStale(undefined, now)).toBe(true);
		expect(fillIsStale("not a date", now)).toBe(true);
		expect(fillIsStale("", now)).toBe(true);
		expect(fillIsStale(new Date(now + 1_000).toISOString(), now)).toBe(true);
	});
});
