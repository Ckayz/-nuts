/**
 * F18 / F24. Machine codes never reach a reader, and a wallet rejection is told
 * apart from a real failure.
 */
import { describe, expect, test } from "bun:test";
import { MESSAGE_CODES, readableError } from "./messages";
import { isWalletRejection } from "@/components/auth/wallet-bar";

describe("F18: codes become sentences in ONE place", () => {
	test("every code a server path can return is mapped", () => {
		// Gathered from the union types and guards that produce them, so adding a
		// code without a sentence fails here.
		for (const code of [
			// lib/auth/sign-in.ts CompleteSignInFailure
			"challenge_invalid",
			"domain_mismatch",
			"signature_invalid",
			// lib/profile/validation.ts + writes.ts
			"invalid_handle",
			"invalid_profile",
			"handle_taken",
			"save_failed",
			// lib/social/guards.ts SocialError
			"sign_in_required",
			"invalid_id",
			"self_follow",
			"blank_comment",
			"not_found",
			"mock_mode",
			"invalid_state",
		]) {
			expect(MESSAGE_CODES).toContain(code);
			const message = readableError(code);
			expect(message).not.toBeNull();
			// The raw token itself never appears in what the reader sees.
			expect(message).not.toContain(code);
			expect(message).not.toContain("_");
		}
	});

	test("an unknown code never leaks as-is", () => {
		const message = readableError("some_new_internal_code");
		expect(message).not.toBeNull();
		expect(message).not.toContain("some_new_internal_code");
		expect(message).not.toContain("_");
	});

	test("prose from the trade path passes through unchanged", () => {
		const sentence = "This fill does not match the trade that was prepared.";
		expect(readableError(sentence)).toBe(sentence);
	});

	test("nothing to say stays nothing", () => {
		expect(readableError(null)).toBeNull();
		expect(readableError(undefined)).toBeNull();
		expect(readableError("")).toBeNull();
	});

	test("every mapped sentence is human: no snake_case, and it ends in a stop", () => {
		for (const code of MESSAGE_CODES) {
			const message = readableError(code) ?? "";
			expect(message).not.toMatch(/[a-z]_[a-z]/);
			expect(message.endsWith(".")).toBe(true);
			expect(message[0]).toBe(message[0]?.toUpperCase());
		}
	});
});

describe("F24: a wallet rejection is not an outage", () => {
	test("EIP-1193 code 4001 is a rejection, at any nesting depth", () => {
		expect(isWalletRejection({ code: 4001 })).toBe(true);
		expect(isWalletRejection({ cause: { code: 4001 } })).toBe(true);
		expect(isWalletRejection({ cause: { cause: { code: 4001 } } })).toBe(true);
		expect(isWalletRejection({ code: "ACTION_REJECTED" })).toBe(true);
	});

	test("viem's named error is a rejection", () => {
		expect(isWalletRejection({ name: "UserRejectedRequestError" })).toBe(true);
		expect(isWalletRejection({ cause: { name: "UserRejectedRequestError" } })).toBe(true);
	});

	test("wallets that only say it in words are still understood", () => {
		for (const message of [
			"User rejected the request.",
			"user denied transaction signature",
			"MetaMask Tx Signature: User denied transaction signature.",
			"The request was rejected by the user",
		]) {
			expect(isWalletRejection(new Error(message))).toBe(true);
		}
	});

	test("a REAL failure is not swallowed as a cancellation", () => {
		for (const error of [
			new Error("fetch failed"),
			new Error("NetworkError when attempting to fetch resource."),
			new Error("500 Internal Server Error"),
			{ code: -32603, message: "Internal JSON-RPC error." },
			{ code: 4900, message: "Disconnected from chain." },
			new TypeError("undefined is not an object"),
			null,
			undefined,
			"a string",
		]) {
			expect(isWalletRejection(error)).toBe(false);
		}
	});

	test("a cyclic error object terminates instead of hanging", () => {
		const cyclic: { cause?: unknown; message: string } = { message: "boom" };
		cyclic.cause = cyclic;
		expect(isWalletRejection(cyclic)).toBe(false);
	});
});
