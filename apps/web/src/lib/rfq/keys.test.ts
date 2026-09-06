/**
 * RFQ key envelope. Offline: the crypto entry points take the master key
 * explicitly, so nothing here depends on how this checkout is configured.
 *
 * The env-dependent half — "absent master key refuses" — runs only when the
 * variable is genuinely absent, because `@nuts/env/server` validates once at
 * import and a test cannot un-set it afterwards.
 */
import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { SigningKey } from "ethers";
import {
	decryptRfqPrivateKey,
	encryptRfqPrivateKey,
	normalizeRfqWallet,
	RfqKeyError,
	rfqKeysConfigured,
} from "./keys";

const key = () => randomBytes(32);
const samplePrivateKey = `0x${"7f".repeat(32)}`;

describe("rfq key envelope", () => {
	test("round trips a private key under its own master key", () => {
		const master = key();
		const payload = encryptRfqPrivateKey(samplePrivateKey, master);
		expect(payload.startsWith("v1:")).toBe(true);
		expect(payload).not.toContain(samplePrivateKey.slice(2));
		expect(decryptRfqPrivateKey(payload, master)).toBe(samplePrivateKey);
	});

	test("the envelope is iv(12) + tag(16) + ciphertext, and the IV is fresh every time", () => {
		const master = key();
		const first = encryptRfqPrivateKey(samplePrivateKey, master);
		const second = encryptRfqPrivateKey(samplePrivateKey, master);

		// A constant IV would make these equal, and GCM under a repeated IV leaks.
		expect(first).not.toBe(second);
		const ivOf = (payload: string) => Buffer.from(payload.slice(3), "base64").subarray(0, 12).toString("hex");
		expect(ivOf(first)).not.toBe(ivOf(second));

		const raw = Buffer.from(first.slice(3), "base64");
		expect(raw.length).toBe(12 + 16 + Buffer.from(samplePrivateKey, "utf8").length);
		// Both still decrypt: two payloads, one key.
		expect(decryptRfqPrivateKey(first, master)).toBe(samplePrivateKey);
		expect(decryptRfqPrivateKey(second, master)).toBe(samplePrivateKey);
	});

	test("a different master key cannot read it, and says nothing about the key", () => {
		const payload = encryptRfqPrivateKey(samplePrivateKey, key());
		let thrown: unknown;
		try {
			decryptRfqPrivateKey(payload, key());
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(RfqKeyError);
		expect((thrown as RfqKeyError).code).toBe("RFQ_KEY_UNREADABLE");
		const text = `${(thrown as Error).message} ${(thrown as Error).stack ?? ""}`;
		expect(text).not.toContain(samplePrivateKey);
		expect(text).not.toContain("7f7f");
	});

	test("a tampered ciphertext, tag or IV is refused, never returned as a key", () => {
		const master = key();
		const payload = encryptRfqPrivateKey(samplePrivateKey, master);
		const raw = Buffer.from(payload.slice(3), "base64");

		for (const index of [0, 12, 20, 28, raw.length - 1]) {
			const flipped = Buffer.from(raw);
			flipped[index] = (flipped[index] ?? 0) ^ 0x01;
			expect(() => decryptRfqPrivateKey(`v1:${flipped.toString("base64")}`, master)).toThrowError(
				expect.objectContaining({ code: "RFQ_KEY_UNREADABLE" }),
			);
		}
		// Truncations and a missing envelope version are refused too.
		expect(() => decryptRfqPrivateKey(`v1:${raw.subarray(0, 20).toString("base64")}`, master)).toThrowError(
			expect.objectContaining({ code: "RFQ_KEY_UNREADABLE" }),
		);
		expect(() => decryptRfqPrivateKey(raw.toString("base64"), master)).toThrowError(
			expect.objectContaining({ code: "RFQ_KEY_UNREADABLE" }),
		);
		expect(() => decryptRfqPrivateKey("", master)).toThrowError(expect.objectContaining({ code: "RFQ_KEY_UNREADABLE" }));
	});

	test("the stored bytes are what a keypair actually needs", () => {
		const master = key();
		const generated = `0x${randomBytes(32).toString("hex")}`;
		const recovered = decryptRfqPrivateKey(encryptRfqPrivateKey(generated, master), master);
		expect(new SigningKey(recovered).compressedPublicKey).toBe(new SigningKey(generated).compressedPublicKey);
	});
});

describe("wallet normalisation", () => {
	test("lowercases a valid address and refuses anything else", () => {
		expect(normalizeRfqWallet("0xAbC1230000000000000000000000000000000000")).toBe(
			"0xabc1230000000000000000000000000000000000",
		);
		for (const bad of ["", "0x", "abc", "0x123", `0x${"z".repeat(40)}`, `0x${"a".repeat(41)}`]) {
			expect(() => normalizeRfqWallet(bad)).toThrowError(expect.objectContaining({ code: "RFQ_KEY_INVALID_WALLET" }));
		}
	});
});

describe("configuration fence", () => {
	const configured = rfqKeysConfigured();

	test("rfqKeysConfigured reports the shape of the configured value", () => {
		expect(typeof configured).toBe("boolean");
	});

	test.skipIf(configured)("with no master key configured, every keyed path refuses", async () => {
		expect(rfqKeysConfigured()).toBe(false);
		expect(() => encryptRfqPrivateKey(samplePrivateKey)).toThrowError(
			expect.objectContaining({ code: "RFQ_KEYS_UNCONFIGURED" }),
		);
		expect(() => decryptRfqPrivateKey("v1:AAAA")).toThrowError(
			expect.objectContaining({ code: "RFQ_KEYS_UNCONFIGURED" }),
		);
		const { getOrCreateWalletRfqKey } = await import("./keys");
		await expect(
			getOrCreateWalletRfqKey("0x1111111111111111111111111111111111111111"),
		).rejects.toThrowError(expect.objectContaining({ code: "RFQ_KEYS_UNCONFIGURED" }));
	});
});
