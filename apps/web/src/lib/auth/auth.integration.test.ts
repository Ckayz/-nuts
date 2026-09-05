/**
 * Sign-in against the real database, in a transaction that is always rolled
 * back. Gated on `DATABASE_URL` the same way
 * `packages/db/test/schema.integration.test.ts` is, so the suite still runs
 * offline; without the variable this file emits one skipped test.
 *
 * Run it against the local throwaway:
 *   cd apps/web && bun test src/lib/auth/auth.integration.test.ts
 * (`@nuts/env/load` finds apps/web/.env.local and apps/web/.env by itself.)
 */
import { describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { authChallenges, users } from "@nuts/db/schema/index";
import { consumeChallenge, createOrFetchUser, deleteExpiredChallenges, issueChallenge, normalizeWalletAddress } from "./store";
import type { Database } from "./store";
import { completeSignIn, startSignIn } from "./sign-in";
import type { SignatureVerifier } from "./verifier";
import { buildSignInMessage } from "./message";
import { SIGN_IN_STATEMENT } from "./constants";

const databaseUrl = process.env.DATABASE_URL;
const DOMAIN = "localhost:3109";
// Deterministic addresses in this file's own namespace; never a real wallet.
const WALLET = "0x00000000000000000000000000000000feed0001";
const OTHER_WALLET = "0x00000000000000000000000000000000feed0002";

const accept: SignatureVerifier = async () => true;
const reject: SignatureVerifier = async () => false;

if (!databaseUrl) {
	console.log("auth integration skipped: DATABASE_URL is not set");
	test.skip("wallet sign-in requires DATABASE_URL", () => {});
} else {
	const { db } = await import("@nuts/db");

	/** Each case gets its own transaction and leaves no row behind. */
	function probe(name: string, run: (tx: Database) => Promise<void>) {
		test(name, async () => {
			const sentinel = new Error("rollback");
			try {
				await db.transaction(async (tx) => {
					await run(tx);
					throw sentinel;
				});
			} catch (error) {
				if (error !== sentinel) throw error;
			}
		});
	}

	describe("auth_challenges", () => {
		probe("issues a lowercase, Base-chain, unconsumed challenge", async (tx) => {
			const row = await issueChallenge(tx, { walletAddress: WALLET.toUpperCase().replace("0X", "0x"), domain: DOMAIN });
			expect(row.walletAddress).toBe(WALLET);
			expect(row.chainId).toBe(8453);
			expect(row.domain).toBe(DOMAIN);
			expect(row.consumedAt).toBeNull();
			expect(row.nonce).toMatch(/^[0-9a-f]{32}$/);
			expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
		});

		probe("a nonce can be consumed exactly once", async (tx) => {
			const issued = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			const first = await consumeChallenge(tx, { nonce: issued.nonce, walletAddress: WALLET });
			expect(first?.id).toBe(issued.id);
			expect(first?.consumedAt).not.toBeNull();
			const second = await consumeChallenge(tx, { nonce: issued.nonce, walletAddress: WALLET });
			expect(second).toBeNull();
		});

		probe("a nonce issued to one wallet cannot be consumed by another", async (tx) => {
			const issued = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			expect(await consumeChallenge(tx, { nonce: issued.nonce, walletAddress: OTHER_WALLET })).toBeNull();
			// Still spendable by its own wallet: the failed attempt did not burn it.
			expect(await consumeChallenge(tx, { nonce: issued.nonce, walletAddress: WALLET })).not.toBeNull();
		});

		probe("an expired challenge cannot be consumed", async (tx) => {
			const [row] = await tx
				.insert(authChallenges)
				.values({
					walletAddress: WALLET,
					nonce: `expired-${Date.now()}`,
					domain: DOMAIN,
					chainId: 8453,
					expiresAt: new Date(Date.now() - 1000),
				})
				.returning();
			expect(row).toBeDefined();
			expect(await consumeChallenge(tx, { nonce: row!.nonce, walletAddress: WALLET })).toBeNull();
		});

		probe("an unknown nonce consumes nothing", async (tx) => {
			expect(await consumeChallenge(tx, { nonce: "no-such-nonce", walletAddress: WALLET })).toBeNull();
		});
	});

	describe("users create-or-fetch", () => {
		probe("two connects from the same wallet produce exactly one row", async (tx) => {
			const first = await createOrFetchUser(tx, WALLET);
			const second = await createOrFetchUser(tx, WALLET.toUpperCase().replace("0X", "0x"));
			expect(second.id).toBe(first.id);
			const [count] = await tx
				.select({ total: sql<string>`count(*)` })
				.from(users)
				.where(eq(users.walletAddress, WALLET));
			expect(Number(count?.total)).toBe(1);
			expect(first.walletAddress).toBe(WALLET);
			// Nothing is invented for a new profile.
			expect(first.displayName).toBeNull();
			expect(first.bio).toBeNull();
			expect(first.avatarUrl).toBeNull();
		});

		probe("a second wallet gets its own row", async (tx) => {
			const a = await createOrFetchUser(tx, WALLET);
			const b = await createOrFetchUser(tx, OTHER_WALLET);
			expect(a.id).not.toBe(b.id);
		});

		test("a malformed address never reaches the database", () => {
			expect(() => normalizeWalletAddress("not-an-address")).toThrow("20-byte hex");
			expect(() => normalizeWalletAddress("0x1234")).toThrow("20-byte hex");
		});
	});

	describe("sign-in end to end", () => {
		probe("a valid signature creates the user and returns it", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const result = await completeSignIn(tx, {
				walletAddress: WALLET,
				nonce: challenge.nonce,
				signature: "0xdeadbeef",
				domain: DOMAIN,
				verify: accept,
			});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error("unreachable");
			expect(result.user.walletAddress).toBe(WALLET);

			const [row] = await tx
				.select()
				.from(authChallenges)
				.where(eq(authChallenges.nonce, challenge.nonce));
			expect(row?.consumedAt).not.toBeNull();
		});

		probe("signing in twice reuses the same user row", async (tx) => {
			const one = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const first = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: one.nonce, signature: "0x01", domain: DOMAIN, verify: accept,
			});
			const two = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const second = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: two.nonce, signature: "0x02", domain: DOMAIN, verify: accept,
			});
			expect(first.ok && second.ok).toBe(true);
			if (!first.ok || !second.ok) throw new Error("unreachable");
			expect(second.user.id).toBe(first.user.id);
			const [count] = await tx
				.select({ total: sql<string>`count(*)` })
				.from(users)
				.where(eq(users.walletAddress, WALLET));
			expect(Number(count?.total)).toBe(1);
		});

		probe("a bad signature burns the nonce and creates no user", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const failed = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0xbad", domain: DOMAIN, verify: reject,
			});
			expect(failed).toEqual({ ok: false, reason: "signature_invalid" });

			// Replaying the same nonce with a good signature must not work.
			const replay = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0xbad", domain: DOMAIN, verify: accept,
			});
			expect(replay).toEqual({ ok: false, reason: "challenge_invalid" });

			const [count] = await tx
				.select({ total: sql<string>`count(*)` })
				.from(users)
				.where(eq(users.walletAddress, WALLET));
			expect(Number(count?.total)).toBe(0);
		});

		probe("a challenge issued for another domain is refused", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: "thesis.fun" });
			const result = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0x01", domain: "evil.example", verify: accept,
			});
			expect(result).toEqual({ ok: false, reason: "domain_mismatch" });
		});

		probe("a non-hex signature is refused without calling the verifier", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			let called = false;
			const result = await completeSignIn(tx, {
				walletAddress: WALLET,
				nonce: challenge.nonce,
				signature: "not-hex",
				domain: DOMAIN,
				verify: async () => {
					called = true;
					return true;
				},
			});
			expect(result).toEqual({ ok: false, reason: "signature_invalid" });
			expect(called).toBe(false);
		});

		/**
		 * Smart-wallet path, mocked at the `verifyMessage` boundary. A Coinbase
		 * Smart Wallet signature is ERC-1271/6492 and only viem's public-client
		 * `verifyMessage` (an RPC call) can check it, so the test asserts the
		 * server hands that boundary exactly the bytes it rebuilt from the stored
		 * challenge — which is the part that can be wrong without an RPC.
		 */
		probe("the verifier receives the server's own message bytes", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const [stored] = await tx
				.select()
				.from(authChallenges)
				.where(and(eq(authChallenges.nonce, challenge.nonce), eq(authChallenges.walletAddress, WALLET)));
			expect(stored).toBeDefined();

			const expected = buildSignInMessage({
				domain: stored!.domain,
				walletAddress: stored!.walletAddress,
				chainId: stored!.chainId,
				nonce: stored!.nonce,
				statement: SIGN_IN_STATEMENT,
				expiresAt: stored!.expiresAt,
			});

			// An ERC-6492-wrapped signature: a long hex blob ending in the magic
			// suffix. The stub stands in for the RPC that would validate it.
			const erc6492 =
				`0x${"ab".repeat(200)}6492649264926492649264926492649264926492649264926492649264926492` as const;
			// Collected in an array so the observed values need no cast: a `let`
			// initialised to null narrows to `null` for the checks below.
			const seen: { address: string; message: string; signature: string }[] = [];
			const result = await completeSignIn(tx, {
				walletAddress: WALLET,
				nonce: challenge.nonce,
				signature: erc6492,
				domain: DOMAIN,
				verify: async (input) => {
					seen.push({ address: input.address, message: input.message, signature: input.signature });
					return true;
				},
			});

			expect(result.ok).toBe(true);
			expect(seen).toHaveLength(1);
			const observed = seen[0];
			expect(observed?.message).toBe(expected);
			expect(observed?.message).toBe(challenge.message);
			expect(observed?.address).toBe(WALLET);
			expect(observed?.signature).toBe(erc6492);
		});
	});

	describe("challenge issue is bounded for an unauthenticated caller", () => {
		probe("300 requests for one wallet leave exactly one live challenge", async (tx) => {
			let last = "";
			for (let index = 0; index < 300; index += 1) {
				const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
				last = challenge.nonce;
			}
			const rows = await tx
				.select()
				.from(authChallenges)
				.where(eq(authChallenges.walletAddress, WALLET));
			expect(rows).toHaveLength(1);
			expect(rows[0]?.nonce).toBe(last);
			expect(rows[0]?.consumedAt).toBeNull();
		});

		probe("the reused challenge keeps its original expiry", async (tx) => {
			const first = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			const second = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			expect(second.id).toBe(first.id);
			expect(second.nonce).toBe(first.nonce);
			expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime());
		});

		probe("a consumed challenge is not reused; the next request issues a new one", async (tx) => {
			const first = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			await consumeChallenge(tx, { nonce: first.nonce, walletAddress: WALLET });
			const second = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			expect(second.nonce).not.toBe(first.nonce);
		});

		probe("a different domain gets its own challenge, never the other domain's", async (tx) => {
			const one = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			const two = await issueChallenge(tx, { walletAddress: WALLET, domain: "thesis.fun" });
			expect(two.id).not.toBe(one.id);
			expect(two.domain).toBe("thesis.fun");
		});

		probe("a different wallet gets its own challenge", async (tx) => {
			const one = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			const two = await issueChallenge(tx, { walletAddress: OTHER_WALLET, domain: DOMAIN });
			expect(two.id).not.toBe(one.id);
		});

		probe("issuing sweeps that wallet's expired rows and leaves other wallets alone", async (tx) => {
			await tx.insert(authChallenges).values([
				{ walletAddress: WALLET, nonce: `stale-a-${Date.now()}`, domain: DOMAIN, chainId: 8453, expiresAt: new Date(Date.now() - 60_000) },
				{ walletAddress: WALLET, nonce: `stale-b-${Date.now()}`, domain: DOMAIN, chainId: 8453, expiresAt: new Date(Date.now() - 30_000) },
				{ walletAddress: OTHER_WALLET, nonce: `stale-c-${Date.now()}`, domain: DOMAIN, chainId: 8453, expiresAt: new Date(Date.now() - 60_000) },
			]);
			await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			const mine = await tx.select().from(authChallenges).where(eq(authChallenges.walletAddress, WALLET));
			expect(mine).toHaveLength(1);
			expect(mine[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
			const theirs = await tx.select().from(authChallenges).where(eq(authChallenges.walletAddress, OTHER_WALLET));
			expect(theirs).toHaveLength(1);
		});

		probe("an expired challenge is never reused, even before the sweep runs", async (tx) => {
			await tx.insert(authChallenges).values({
				walletAddress: WALLET,
				nonce: `expired-reuse-${Date.now()}`,
				domain: DOMAIN,
				chainId: 8453,
				expiresAt: new Date(Date.now() - 1000),
			});
			const issued = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
		});

		probe("deleteExpiredChallenges with no wallet sweeps every expired row", async (tx) => {
			// The live challenge is issued first: issuing sweeps its own wallet, so
			// inserting the stale rows afterwards keeps both of them in the table.
			const live = await issueChallenge(tx, { walletAddress: WALLET, domain: DOMAIN });
			await tx.insert(authChallenges).values([
				{ walletAddress: WALLET, nonce: `sweep-a-${Date.now()}`, domain: DOMAIN, chainId: 8453, expiresAt: new Date(Date.now() - 1000) },
				{ walletAddress: OTHER_WALLET, nonce: `sweep-b-${Date.now()}`, domain: DOMAIN, chainId: 8453, expiresAt: new Date(Date.now() - 1000) },
			]);
			const removed = await deleteExpiredChallenges(tx);
			expect(removed).toBe(2);
			const remaining = await tx
				.select()
				.from(authChallenges)
				.where(eq(authChallenges.nonce, live.nonce));
			expect(remaining).toHaveLength(1);
		});
	});
}
