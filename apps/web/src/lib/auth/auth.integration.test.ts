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
import { DEFAULT_HANDLE_RE, DEFAULT_DISPLAY_NAME_RE } from "../profile/default-identity";
import { describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { authChallenges, users } from "@nuts/db/schema/index";
import { consumeChallenge, createOrFetchUser, deleteExpiredChallenges, issueChallenge, normalizeWalletAddress, peekChallenge } from "./store";
import type { Database } from "./store";
import { completeSignIn, startSignIn } from "./sign-in";
import type { SignatureVerifier } from "./verifier";
import { buildSignInMessage } from "./message";
import { SIGN_IN_STATEMENT } from "./constants";

// Error filtering can be verified offline; collision recovery below uses real pg.
test("create-or-fetch rethrows unrelated database errors unchanged", async () => {
	for (const error of [
		{ code: "23505", constraint: "other_unique" },
		{ code: "23514", constraint: "users_handle_unique" },
		new Error("connection failed"),
		new Error("wrapped", { cause: { code: "23505", constraint: "other_unique" } }),
	]) {
		let calls = 0;
		const database = { transaction: async () => { calls++; throw error; } } as unknown as Database;
		try {
			await createOrFetchUser(database, "0x00000000000000000000000000000000feed0001");
			throw new Error("Expected the original database error");
		} catch (actual) { expect(actual).toBe(error); }
		expect(calls).toBe(1);
	}
});

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
			expect(first.handle).toMatch(DEFAULT_HANDLE_RE);
			expect(first.displayName).toMatch(DEFAULT_DISPLAY_NAME_RE);
			expect(first.handle!.slice(-4)).toBe(first.displayName!.slice(-4));
			expect(second.handle).toBe(first.handle);
			expect(first.bio).toBeNull();
			expect(first.avatarUrl).toBeNull();
		});

		probe("a second wallet gets its own row", async (tx) => {
			const a = await createOrFetchUser(tx, WALLET);
			const b = await createOrFetchUser(tx, OTHER_WALLET);
			expect(a.id).not.toBe(b.id);
		});

		probe("handle collision retries through the real Drizzle error wrapper", async (tx) => {
			// Pass-5 lane B (2026-09-06): the digits were hardcoded (7 and 8), and other
			// integration files leave `thesis_NNNN` rows behind on a reused database,
			// so a leaked `thesis_0007`/`thesis_0008` made this probe red for a reason
			// that had nothing to do with sign-in. The two digits are now the first
			// two values whose handle is NOT taken, read from the database itself.
			const taken = new Set((await tx.select({ handle: users.handle }).from(users)).map((row) => row.handle));
			const free: number[] = [];
			for (let n = 0; n < 10_000 && free.length < 2; n++) {
				if (!taken.has(`thesis_${String(n).padStart(4, "0")}`)) free.push(n);
			}
			const [a, b] = free as [number, number];
			const first = await createOrFetchUser(tx, WALLET, { randomInt: () => a });
			let calls = 0;
			const second = await createOrFetchUser(tx, OTHER_WALLET, { randomInt: () => calls++ === 0 ? a : b });
			expect(first.handle).toBe(`thesis_${String(a).padStart(4, "0")}`);
			expect(second.handle).toBe(`thesis_${String(b).padStart(4, "0")}`);
			expect(calls).toBe(2);
		});

		probe("real duplicate handles expose the exact pg code and constraint through cause", async (tx) => {
			await createOrFetchUser(tx, WALLET, { randomInt: () => 7 });
			let observed: unknown;
			try {
				await tx.transaction(inner => inner.insert(users).values({ walletAddress: OTHER_WALLET, handle: "thesis_0007" }));
			} catch (error) { observed = error; }
			expect(observed).toBeInstanceOf(Error);
			expect((observed as Error).cause).toMatchObject({ code: "23505", constraint: "users_handle_unique" });
		});

		probe("constant collisions fall back to a named profile without a handle", async (tx) => {
			await createOrFetchUser(tx, WALLET, { randomInt: () => 7 });
			let calls = 0;
			const second = await createOrFetchUser(tx, OTHER_WALLET, { randomInt: () => { calls++; return 7; } });
			expect(calls).toBe(6); // Initial attempt + the brief's five retries.
			expect(second.handle).toBeNull();
			expect(second.displayName).toBe("thesis-0007");
		});

		probe("reconnecting never overwrites an edited profile", async (tx) => {
			const first = await createOrFetchUser(tx, WALLET);
			await tx.update(users).set({ handle: "identity_edited", displayName: "Edited name" }).where(eq(users.id, first.id));
			const second = await createOrFetchUser(tx, WALLET);
			expect(second.id).toBe(first.id);
			expect(second.handle).toBe("identity_edited");
			expect(second.displayName).toBe("Edited name");
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

		/**
		 * B1. `requestSignInChallenge` is unauthenticated and hands the live row
		 * to any caller, so a bad signature must NOT spend the nonce: otherwise
		 * anyone could burn the challenge the honest owner is signing right now.
		 * The nonce is spent only by a signature that verifies.
		 */
		probe("a bad signature leaves the nonce spendable and creates no user", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const failed = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0xbad", domain: DOMAIN, verify: reject,
			});
			expect(failed).toEqual({ ok: false, reason: "signature_invalid" });

			// The attacker's attempt did not consume the row.
			const [afterFailure] = await tx
				.select()
				.from(authChallenges)
				.where(eq(authChallenges.nonce, challenge.nonce));
			expect(afterFailure?.consumedAt).toBeNull();
			expect(await peekChallenge(tx, { nonce: challenge.nonce, walletAddress: WALLET })).not.toBeNull();

			// No user was created by the failed attempt.
			const [beforeCount] = await tx
				.select({ total: sql<string>`count(*)` })
				.from(users)
				.where(eq(users.walletAddress, WALLET));
			expect(Number(beforeCount?.total)).toBe(0);

			// The honest owner's real signature still works on the same nonce.
			const honest = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0xabcdef", domain: DOMAIN, verify: accept,
			});
			expect(honest.ok).toBe(true);
			const [spent] = await tx
				.select()
				.from(authChallenges)
				.where(eq(authChallenges.nonce, challenge.nonce));
			expect(spent?.consumedAt).not.toBeNull();
		});

		/** B1. Junk from anyone must never cost the owner their live challenge. */
		probe("a stranger cannot burn a wallet's live challenge with junk attempts", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			for (let index = 0; index < 25; index += 1) {
				const attempt = await completeSignIn(tx, {
					walletAddress: WALLET,
					nonce: challenge.nonce,
					signature: `0x${index.toString(16).padStart(4, "0")}`,
					domain: DOMAIN,
					verify: reject,
				});
				expect(attempt).toEqual({ ok: false, reason: "signature_invalid" });
			}
			// Non-hex junk (refused before the verifier) must not spend it either.
			expect(
				await completeSignIn(tx, {
					walletAddress: WALLET, nonce: challenge.nonce, signature: "not-hex", domain: DOMAIN, verify: reject,
				}),
			).toEqual({ ok: false, reason: "signature_invalid" });
			// A wrong-domain attempt must not spend it either.
			expect(
				await completeSignIn(tx, {
					walletAddress: WALLET, nonce: challenge.nonce, signature: "0x01", domain: "evil.example", verify: accept,
				}),
			).toEqual({ ok: false, reason: "domain_mismatch" });

			const [row] = await tx
				.select()
				.from(authChallenges)
				.where(eq(authChallenges.nonce, challenge.nonce));
			expect(row?.consumedAt).toBeNull();
		});

		/** B1. Single use survives the reorder: a verified nonce is spent once. */
		probe("a verified nonce cannot be replayed", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const first = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0x01", domain: DOMAIN, verify: accept,
			});
			expect(first.ok).toBe(true);
			const replay = await completeSignIn(tx, {
				walletAddress: WALLET, nonce: challenge.nonce, signature: "0x01", domain: DOMAIN, verify: accept,
			});
			expect(replay).toEqual({ ok: false, reason: "challenge_invalid" });
		});

		/**
		 * B1. The consume race loser reports `challenge_invalid`, not a user.
		 * Simulated by spending the row from inside the verifier, which is the
		 * window a second concurrent request occupies.
		 */
		probe("the consume race loser gets challenge_invalid", async (tx) => {
			const challenge = await startSignIn(tx, { walletAddress: WALLET, domain: DOMAIN });
			const result = await completeSignIn(tx, {
				walletAddress: WALLET,
				nonce: challenge.nonce,
				signature: "0x01",
				domain: DOMAIN,
				verify: async () => {
					// The competing request wins the UPDATE while we verify.
					await consumeChallenge(tx, { nonce: challenge.nonce, walletAddress: WALLET });
					return true;
				},
			});
			expect(result).toEqual({ ok: false, reason: "challenge_invalid" });
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
