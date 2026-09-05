import { describe, expect, test } from "bun:test";
import { decodeSessionToken, encodeSessionToken, type SessionPayload } from "./token";
import { truncateAddress } from "./address";
import { buildSignInMessage, originForDomain } from "./message";
import { SIGN_IN_STATEMENT } from "./constants";

const secret = "a".repeat(32);
const other = "b".repeat(32);
const address = "0xabcdef0123456789abcdef0123456789abcdef01";

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
	const now = Math.floor(Date.now() / 1000);
	return { v: 1, uid: "user-1", addr: address, iat: now, exp: now + 3600, ...overrides };
}

describe("session cookie round trip", () => {
	test("a token signed with the secret decodes back to the same payload", () => {
		const input = payload();
		const decoded = decodeSessionToken(encodeSessionToken(input, secret), secret);
		expect(decoded).toEqual(input);
	});

	test("a different secret does not verify", () => {
		expect(decodeSessionToken(encodeSessionToken(payload(), secret), other)).toBeNull();
	});

	test("a tampered payload does not verify", () => {
		const token = encodeSessionToken(payload(), secret);
		const [body = "", signature = ""] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({ ...payload({ uid: "someone-else" }) }),
			"utf8",
		).toString("base64url");
		expect(body).not.toBe(forged);
		expect(decodeSessionToken(`${forged}.${signature}`, secret)).toBeNull();
	});

	test("a tampered signature does not verify", () => {
		const token = encodeSessionToken(payload(), secret);
		const [body = ""] = token.split(".");
		const wrong = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
		expect(decodeSessionToken(`${body}.${wrong}`, secret)).toBeNull();
	});

	test("an expired token does not verify even with a valid signature", () => {
		const now = Math.floor(Date.now() / 1000);
		const token = encodeSessionToken(payload({ iat: now - 7200, exp: now - 1 }), secret);
		expect(decodeSessionToken(token, secret)).toBeNull();
	});

	test("a token that expires in the future verifies at a clock before its expiry", () => {
		const now = Math.floor(Date.now() / 1000);
		const token = encodeSessionToken(payload({ exp: now + 10 }), secret);
		expect(decodeSessionToken(token, secret, new Date((now + 5) * 1000))).not.toBeNull();
		expect(decodeSessionToken(token, secret, new Date((now + 11) * 1000))).toBeNull();
	});

	test("malformed tokens return null instead of throwing", () => {
		for (const token of ["", ".", "abc", "a.b", "!!!.???", `${"x".repeat(10)}.`]) {
			expect(decodeSessionToken(token, secret)).toBeNull();
		}
	});

	test("a non-address payload is rejected even when correctly signed", () => {
		const token = encodeSessionToken(payload({ addr: "0xNOTANADDRESS" }), secret);
		expect(decodeSessionToken(token, secret)).toBeNull();
	});

	test("a checksummed address in the payload is rejected: the cookie stores lowercase", () => {
		const token = encodeSessionToken(
			payload({ addr: "0xABCDEF0123456789abcdef0123456789abcdef01" }),
			secret,
		);
		expect(decodeSessionToken(token, secret)).toBeNull();
	});
});

describe("address presentation", () => {
	test("matches the mockup's 0x7c4a…e10b shape", () => {
		expect(truncateAddress("0x7c4a1111111111111111111111111111111111e10b")).toBe("0x7c4a…e10b");
	});
	test("short values are returned unchanged", () => {
		expect(truncateAddress("0x1234")).toBe("0x1234");
	});
});

describe("sign-in message", () => {
	const expiresAt = new Date("2026-09-05T12:00:00.000Z");

	test("is byte-stable for the same stored challenge", () => {
		const fields = {
			domain: "thesis.fun",
			walletAddress: address,
			chainId: 8453,
			nonce: "0123456789abcdef0123456789abcdef",
			statement: SIGN_IN_STATEMENT,
			expiresAt,
		};
		expect(buildSignInMessage(fields)).toBe(buildSignInMessage({ ...fields }));
	});

	test("carries the checksummed address, the chain, the nonce and the expiry", () => {
		const message = buildSignInMessage({
			domain: "thesis.fun",
			walletAddress: address,
			chainId: 8453,
			nonce: "nonce-value",
			statement: SIGN_IN_STATEMENT,
			expiresAt,
		});
		expect(message).toContain("thesis.fun wants you to sign in with your Ethereum account:");
		// EIP-55 checksum of the all-lowercase test address, cross-checked
		// against both viem's and ethers' getAddress before being pinned here.
		expect(message).toContain("0xabCDeF0123456789AbcdEf0123456789aBCDEF01");
		expect(message).not.toContain(address);
		expect(message).toContain("Chain ID: 8453");
		expect(message).toContain("Nonce: nonce-value");
		expect(message).toContain("Expiration Time: 2026-09-05T12:00:00.000Z");
		expect(message).toContain("URI: https://thesis.fun");
		// Deliberately absent: nothing in the message is re-derived from a constant.
		expect(message).not.toContain("Issued At");
	});

	test("a different nonce produces a different message", () => {
		const base = {
			domain: "thesis.fun",
			walletAddress: address,
			chainId: 8453,
			statement: SIGN_IN_STATEMENT,
			expiresAt,
		};
		expect(buildSignInMessage({ ...base, nonce: "one" })).not.toBe(
			buildSignInMessage({ ...base, nonce: "two" }),
		);
	});

	test("loopback hosts get an http URI", () => {
		expect(originForDomain("localhost:3001")).toBe("http://localhost:3001");
		expect(originForDomain("127.0.0.1:3109")).toBe("http://127.0.0.1:3109");
		expect(originForDomain("thesis.fun")).toBe("https://thesis.fun");
	});
});
