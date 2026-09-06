import "server-only";

/**
 * Per-wallet RFQ keypairs, encrypted at rest.
 *
 * WHAT THESE KEYS ARE. A Thetanuts RFQ carries the requester's compressed ECDH
 * public key. Market makers encrypt their offers to it, and only the holder of
 * the private half can read an offer before the maker reveals it on chain. They
 * are ENCRYPTION keys: they cannot sign a transaction and cannot move funds.
 * The wallet still signs every transaction; nothing here ever does.
 *
 * WHY THEY MUST OUTLIVE THE PROCESS. `packages/thetanuts/src/client.ts` gives
 * the read client a `MemoryStorageProvider`, so its keys die with the process.
 * An RFQ created under a key that is then lost can never have its offers
 * decrypted — the docs say so plainly and offer no recovery. So the key is
 * minted once per wallet and stored in `agent_rfq_keys`, which already exists
 * for exactly this (migration 0000).
 *
 * WHY THE PROVIDER IS BOUND TO A WALLET. MEASURED in the SDK
 * (`dist/index.js:11713, 12003`): `getStorageKeyId()` returns
 * `` `${keyPrefix}_${chainId}` `` — `thetanuts_rfq_key_8453` — which is the same
 * string for EVERY wallet. A provider that keyed rows on it would hand one
 * wallet's key to another. `dbKeyStorage(wallet)` therefore ignores the SDK's
 * key id entirely and keys on the wallet address, which is what
 * `agent_rfq_keys_wallet_key` makes unique.
 *
 * AT REST. AES-256-GCM under `RFQ_KEY_MASTER_KEY`, a fresh 12-byte IV per
 * write, the 16-byte tag verified on every read, stored as
 * `v1:` + base64(iv ‖ tag ‖ ciphertext). With no master key configured every
 * entry point here REFUSES — a private key is never written in clear, and RFQ
 * creation is refused with one sentence instead.
 *
 * The private key never leaves this module: it is not returned to a caller, not
 * logged, and never placed in an error message or an error's details.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SigningKey } from "ethers";
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { agentRfqKeys } from "@nuts/db/schema/index";
import { env } from "@nuts/env/server";
import { createRfqClient } from "@nuts/thetanuts";
import type { KeyStorageProvider } from "@thetanuts-finance/thetanuts-client";

/** The shared handle or a transaction handle, so a test can roll its work back. */
export type Database =
	| typeof defaultDb
	| Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];

export type RfqKeyErrorCode =
	/** `RFQ_KEY_MASTER_KEY` is absent or not 32 bytes of hex. Fail closed. */
	| "RFQ_KEYS_UNCONFIGURED"
	/** A stored value does not decrypt under the configured master key. */
	| "RFQ_KEY_UNREADABLE"
	/** The address is not a 20-byte hex address. */
	| "RFQ_KEY_INVALID_WALLET";

/** Never carries key material — not in the message, not in a `details` bag. */
export class RfqKeyError extends Error {
	readonly code: RfqKeyErrorCode;
	constructor(code: RfqKeyErrorCode, message: string) {
		super(message);
		this.name = "RfqKeyError";
		this.code = code;
	}
}

const MASTER_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const VERSION_PREFIX = "v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Is a usable master key configured?
 *
 * The shape is re-checked here rather than trusted from the schema, because
 * `SKIP_ENV_VALIDATION` bypasses validation outside production
 * (`packages/env/src/server.ts`) and a half-configured deployment must fail
 * closed rather than believe it has a fence.
 */
export function rfqKeysConfigured(): boolean {
	const value = env.RFQ_KEY_MASTER_KEY;
	return typeof value === "string" && MASTER_KEY_PATTERN.test(value);
}

function masterKey(): Buffer {
	const value = env.RFQ_KEY_MASTER_KEY;
	if (typeof value !== "string" || !MASTER_KEY_PATTERN.test(value)) {
		throw new RfqKeyError(
			"RFQ_KEYS_UNCONFIGURED",
			"RFQ requests are unavailable: no RFQ_KEY_MASTER_KEY is configured, and an RFQ key is never stored unencrypted.",
		);
	}
	return Buffer.from(value, "hex");
}

/** Lowercase 20-byte hex, the form `agent_rfq_keys` is keyed on. */
export function normalizeRfqWallet(value: string): string {
	const lower = value.trim().toLowerCase();
	if (!/^0x[0-9a-f]{40}$/.test(lower)) {
		throw new RfqKeyError("RFQ_KEY_INVALID_WALLET", "A wallet address must be a 0x-prefixed 20-byte hex string");
	}
	return lower;
}

/**
 * `v1:` + base64(iv ‖ tag ‖ ciphertext). A fresh IV per call, so encrypting one
 * plaintext twice produces two different payloads — a constant IV under one key
 * leaks plaintext relationships in GCM and also destroys its integrity.
 */
export function encryptRfqPrivateKey(privateKey: string, key: Buffer = masterKey()): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
	return VERSION_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/**
 * The reverse. A wrong master key, a truncated payload or a single flipped byte
 * all raise `RFQ_KEY_UNREADABLE` — the GCM tag is verified, so a tampered
 * ciphertext can never be returned as if it were a key.
 */
export function decryptRfqPrivateKey(payload: string, key: Buffer = masterKey()): string {
	if (!payload.startsWith(VERSION_PREFIX)) {
		throw new RfqKeyError("RFQ_KEY_UNREADABLE", "The stored RFQ key is not in the v1 envelope this build writes");
	}
	const raw = Buffer.from(payload.slice(VERSION_PREFIX.length), "base64");
	if (raw.length <= IV_BYTES + TAG_BYTES) {
		throw new RfqKeyError("RFQ_KEY_UNREADABLE", "The stored RFQ key is too short to contain an IV, a tag and a key");
	}
	const iv = raw.subarray(0, IV_BYTES);
	const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	} catch {
		// The underlying error is swallowed on purpose: it can carry buffer
		// fragments, and "it did not authenticate" is the whole of what a caller
		// may know.
		throw new RfqKeyError("RFQ_KEY_UNREADABLE", "The stored RFQ key did not decrypt under the configured master key");
	}
}

/** The compressed public half of a private key, derived rather than trusted from a column. */
function compressedPublicKeyOf(privateKey: string): string {
	try {
		return new SigningKey(privateKey).compressedPublicKey;
	} catch {
		throw new RfqKeyError("RFQ_KEY_UNREADABLE", "The RFQ private key is not a valid secp256k1 key");
	}
}

/**
 * A `KeyStorageProvider` over `agent_rfq_keys`, bound to ONE wallet.
 *
 * The SDK's key id is ignored by design (see the file header): it is per chain,
 * not per wallet, so two wallets would collide on it. The row is keyed on the
 * wallet address, which carries the unique index.
 */
export function dbKeyStorage(walletAddress: string, db: Database = defaultDb): KeyStorageProvider {
	const wallet = normalizeRfqWallet(walletAddress);

	async function stored(): Promise<string | null> {
		const rows = await db
			.select({ encryptedPrivateKey: agentRfqKeys.encryptedPrivateKey })
			.from(agentRfqKeys)
			.where(eq(agentRfqKeys.walletAddress, wallet))
			.limit(1);
		return rows[0]?.encryptedPrivateKey ?? null;
	}

	return {
		async get(): Promise<string | null> {
			const payload = await stored();
			return payload === null ? null : decryptRfqPrivateKey(payload);
		},
		/**
		 * INSERT-ONLY. A wallet's RFQ key is minted once and never replaced: the
		 * private half is the only thing that can ever decrypt an offer made to
		 * a public key already published on chain, and the docs give no recovery
		 * when it is lost. An upsert here made two overlapping FIRST mints
		 * destructive — the SDK's `getOrCreateKeyPair` is `has()` → `get()` →
		 * generate → `set()` with no lock, so both callers mint and the second
		 * write threw the first key away (A-1).
		 *
		 * A `set` that loses the conflict is therefore a NO-OP, not a failure:
		 * `getOrCreateWalletRfqKey` re-reads afterwards and both callers converge
		 * on whichever key actually persisted.
		 */
		async set(_keyId: string, privateKey: string): Promise<void> {
			const key = masterKey();
			// Derived here so the public column can never drift from the private
			// half it claims to describe.
			const publicKey = compressedPublicKeyOf(privateKey);
			const encryptedPrivateKey = encryptRfqPrivateKey(privateKey, key);
			await db
				.insert(agentRfqKeys)
				.values({ walletAddress: wallet, publicKey, encryptedPrivateKey })
				.onConflictDoNothing({ target: agentRfqKeys.walletAddress });
		},
		async remove(): Promise<void> {
			await db.delete(agentRfqKeys).where(eq(agentRfqKeys.walletAddress, wallet));
		},
		async has(): Promise<boolean> {
			return (await stored()) !== null;
		},
	};
}

/**
 * The wallet's RFQ public key, minting one on first use.
 *
 * ONLY the public half is returned. It is the value that goes into
 * `requesterPublicKey` on the calldata and it is the only part that may reach a
 * model, a browser or a log.
 */
export async function getOrCreateWalletRfqKey(
	walletAddress: string,
	db: Database = defaultDb,
): Promise<{ compressedPublicKey: string }> {
	const wallet = normalizeRfqWallet(walletAddress);
	// Refuse before touching the database, so an unconfigured deployment cannot
	// read a row it has no key for and cannot half-write one.
	masterKey();
	const storage = dbKeyStorage(wallet, db);
	const client = createRfqClient({
		rpcUrl: env.BASE_RPC_URL,
		referrer: env.THESIS_REFERRER,
		keyStorageProvider: storage,
	});
	await client.rfqKeys.getOrCreateKeyPair();
	// THE STORED KEY IS THE ANSWER, never the one this call generated. Two
	// concurrent first mints both generate, and only one insert wins; the loser's
	// key exists nowhere, so returning it would put a public key on chain whose
	// offers nobody could ever decrypt (A-1). Re-reading makes both callers agree
	// on the key that actually persisted.
	// The SDK's key id is per chain, not per wallet, and `dbKeyStorage` ignores it
	// by design (see the file header); it is passed through so the provider is
	// driven exactly as the SDK drives it.
	const storedPrivateKey = await storage.get(client.rfqKeys.getStorageKeyId());
	if (storedPrivateKey === null) {
		throw new RfqKeyError("RFQ_KEY_UNREADABLE", "This wallet's RFQ key could not be read back after it was minted");
	}
	const compressedPublicKey = compressedPublicKeyOf(storedPrivateKey);
	// A row written by an older build, or a repaired one, must not keep a public
	// key that disagrees with the private half now in storage. Safe because the
	// value written is derived from the ciphertext that is actually there.
	await db
		.update(agentRfqKeys)
		.set({ publicKey: compressedPublicKey })
		.where(eq(agentRfqKeys.walletAddress, wallet));
	return { compressedPublicKey };
}
