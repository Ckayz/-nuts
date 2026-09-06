/**
 * The RFQ key store against a real database.
 *
 * Needs BOTH a loopback `DATABASE_URL` passed on the command (the shared fence
 * in `packages/db/src/test-fence.ts` refuses anything else, and refuses a value
 * only an env file supplied) and an `RFQ_KEY_MASTER_KEY` — `@nuts/env/server`
 * validates once at import, so the variable has to be in the environment before
 * the process starts:
 *
 *   cd apps/web && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/claude_rfq1 \
 *     RFQ_KEY_MASTER_KEY=$(openssl rand -hex 32) bun test src/lib/rfq/keys.integration.test.ts
 *
 * It writes and deletes only the `agent_rfq_keys` rows for the random wallets it
 * mints, and it signs and sends nothing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@nuts/db";
import { agentRfqKeys } from "@nuts/db/schema/index";
import { SigningKey } from "ethers";
import { dbKeyStorage, decryptRfqPrivateKey, getOrCreateWalletRfqKey, rfqKeysConfigured } from "./keys";

const databaseUrl = process.env.DATABASE_URL;
const ready = Boolean(databaseUrl) && rfqKeysConfigured();
if (!ready) {
	console.log(
		`rfq keys integration skipped: ${databaseUrl ? "" : "DATABASE_URL is not set; "}${rfqKeysConfigured() ? "" : "RFQ_KEY_MASTER_KEY is not set"}`,
	);
}
const describeLive = ready ? describe : describe.skip;

const wallets: string[] = [];
const newWallet = () => {
	const wallet = `0x${randomBytes(20).toString("hex")}`;
	wallets.push(wallet);
	return wallet;
};

afterAll(async () => {
	if (ready && wallets.length > 0) {
		await db.delete(agentRfqKeys).where(inArray(agentRfqKeys.walletAddress, wallets));
	}
});

describeLive("rfq key storage", () => {
	test("mints one key per wallet, and gives the same public key back on every later call", async () => {
		const wallet = newWallet();
		const first = await getOrCreateWalletRfqKey(wallet);
		const second = await getOrCreateWalletRfqKey(wallet);

		expect(first.compressedPublicKey).toBe(second.compressedPublicKey);
		expect(first.compressedPublicKey).toMatch(/^0x0[23][0-9a-f]{64}$/i);
		// Only the public half is returned.
		expect(Object.keys(first)).toEqual(["compressedPublicKey"]);

		const rows = await db.select().from(agentRfqKeys).where(eq(agentRfqKeys.walletAddress, wallet));
		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (!row) throw new Error("row missing");
		expect(row.publicKey).toBe(first.compressedPublicKey);

		// The column is a ciphertext, and the plaintext it hides is the private
		// half of exactly the public key that was returned.
		expect(row.encryptedPrivateKey.startsWith("v1:")).toBe(true);
		expect(row.encryptedPrivateKey).not.toContain("0x");
		const privateKey = decryptRfqPrivateKey(row.encryptedPrivateKey);
		expect(new SigningKey(privateKey).compressedPublicKey).toBe(first.compressedPublicKey);
	});

	test("two wallets get two rows and two different keys", async () => {
		const one = newWallet();
		const two = newWallet();
		const first = await getOrCreateWalletRfqKey(one);
		const second = await getOrCreateWalletRfqKey(two);

		expect(first.compressedPublicKey).not.toBe(second.compressedPublicKey);
		const rows = await db.select().from(agentRfqKeys).where(inArray(agentRfqKeys.walletAddress, [one, two]));
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((row) => row.encryptedPrivateKey)).size).toBe(2);

		// The SDK asks every provider for the SAME key id (per chain, not per
		// wallet), so this is the assertion that the wallet binding is what keys
		// the row rather than that id.
		const storageOne = dbKeyStorage(one);
		const storageTwo = dbKeyStorage(two);
		const keyId = "thetanuts_rfq_key_8453";
		const readOne = await storageOne.get(keyId);
		const readTwo = await storageTwo.get(keyId);
		expect(readOne).not.toBe(readTwo);
		expect(new SigningKey(readOne as string).compressedPublicKey).toBe(first.compressedPublicKey);
		expect(new SigningKey(readTwo as string).compressedPublicKey).toBe(second.compressedPublicKey);
	});

	test("an address in any case reaches one row", async () => {
		const wallet = newWallet();
		const lower = await getOrCreateWalletRfqKey(wallet);
		const upper = await getOrCreateWalletRfqKey(`0x${wallet.slice(2).toUpperCase()}`);
		expect(upper.compressedPublicKey).toBe(lower.compressedPublicKey);
		expect(await db.select().from(agentRfqKeys).where(eq(agentRfqKeys.walletAddress, wallet))).toHaveLength(1);
	});

	test("has, set, get and remove behave over a real row", async () => {
		const wallet = newWallet();
		const storage = dbKeyStorage(wallet);
		const keyId = "thetanuts_rfq_key_8453";

		expect(await storage.has(keyId)).toBe(false);
		expect(await storage.get(keyId)).toBeNull();

		const privateKey = `0x${randomBytes(32).toString("hex")}`;
		await storage.set(keyId, privateKey);
		expect(await storage.has(keyId)).toBe(true);
		expect(await storage.get(keyId)).toBe(privateKey);

		// `set` upserts: a second write replaces the row rather than failing the
		// unique index, and re-derives the public column from the new key.
		const replacement = `0x${randomBytes(32).toString("hex")}`;
		await storage.set(keyId, replacement);
		const rows = await db.select().from(agentRfqKeys).where(eq(agentRfqKeys.walletAddress, wallet));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.publicKey).toBe(new SigningKey(replacement).compressedPublicKey);
		expect(await storage.get(keyId)).toBe(replacement);

		await storage.remove(keyId);
		expect(await storage.has(keyId)).toBe(false);
		expect(await db.select().from(agentRfqKeys).where(eq(agentRfqKeys.walletAddress, wallet))).toHaveLength(0);
	});
});
