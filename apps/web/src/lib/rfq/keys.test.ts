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
	dbKeyStorage,
	encryptRfqPrivateKey,
	getOrCreateWalletRfqKey,
	normalizeRfqWallet,
	RfqKeyError,
	rfqKeysConfigured,
	type Database,
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

/* ─────────────────────────── the first-mint race ─────────────────────────── */

/**
 * A-1. `agent_rfq_keys` holds ONE row per wallet, and the SDK's
 * `getOrCreateKeyPair` is `has()` → `get()` → generate → `set()` with no lock
 * (`dist/index.js:11760-11773`). Two overlapping FIRST mints for one wallet
 * therefore both find nothing and both generate; only one private half can be
 * stored, and the caller left holding the other one has an RFQ whose offers can
 * never be decrypted — the docs give no recovery.
 *
 * The database is injected here (`getOrCreateWalletRfqKey`'s own second
 * parameter) so the interleaving is exact rather than hoped for: every
 * operation yields a macrotask, which is what a real connection does. It keeps
 * the drizzle call shapes the module actually uses, including BOTH conflict
 * clauses, so the mutant below runs against it unchanged.
 */
interface FakeRow {
	walletAddress: string;
	publicKey: string;
	encryptedPrivateKey: string;
}

function racyDatabase(state: { row: FakeRow | null; inserts: number; updates: number }): Database {
	const yielded = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
	const fake = {
		select: () => ({
			from: () => ({
				where: () => ({
					async limit() {
						await yielded();
						return state.row === null ? [] : [{ encryptedPrivateKey: state.row.encryptedPrivateKey }];
					},
				}),
			}),
		}),
		insert: () => ({
			values: (values: FakeRow) => ({
				async onConflictDoNothing() {
					await yielded();
					state.inserts += 1;
					if (state.row === null) state.row = { ...values };
				},
				onConflictDoUpdate: async ({ set }: { set: Partial<FakeRow> }) => {
					await yielded();
					state.inserts += 1;
					state.row = state.row === null ? { ...values } : { ...state.row, ...set };
				},
			}),
		}),
		update: () => ({
			set: (values: Partial<FakeRow>) => ({
				async where() {
					await yielded();
					state.updates += 1;
					if (state.row !== null) state.row = { ...state.row, ...values };
				},
			}),
		}),
		delete: () => ({
			async where() {
				await yielded();
				state.row = null;
			},
		}),
	};
	return fake as unknown as Database;
}

describe("the first-mint race", () => {
	const WALLET = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";

	test("two concurrent first mints leave one row, and BOTH callers get the stored key", async () => {
		const state = { row: null as FakeRow | null, inserts: 0, updates: 0 };
		const database = racyDatabase(state);
		const [first, second] = await Promise.all([
			getOrCreateWalletRfqKey(WALLET, database),
			getOrCreateWalletRfqKey(WALLET, database),
		]);

		// The race really happened: both callers reached `set` with nothing stored.
		expect(state.inserts).toBe(2);
		const row = state.row;
		if (row === null) throw new Error("no row was written");
		const storedPublicKey = new SigningKey(decryptRfqPrivateKey(row.encryptedPrivateKey)).compressedPublicKey;
		// Neither caller may be handed a public key whose private half is gone.
		expect(first.compressedPublicKey).toBe(storedPublicKey);
		expect(second.compressedPublicKey).toBe(storedPublicKey);
		// And the column agrees with the ciphertext beside it.
		expect(row.publicKey).toBe(storedPublicKey);
	});

	test("set is insert-only: a second write never replaces a stored key", async () => {
		const state = { row: null as FakeRow | null, inserts: 0, updates: 0 };
		const storage = dbKeyStorage(WALLET, racyDatabase(state));
		const keyId = "thetanuts_rfq_key_8453";
		const kept = `0x${"11".repeat(32)}`;
		const loser = `0x${"22".repeat(32)}`;

		await storage.set(keyId, kept);
		await storage.set(keyId, loser);
		expect(await storage.get(keyId)).toBe(kept);
		expect(state.row?.publicKey).toBe(new SigningKey(kept).compressedPublicKey);
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
