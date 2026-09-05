import "server-only";

/**
 * Database side of sign-in: challenge issue, single-use consume, and the
 * create-or-fetch of the `users` row that a wallet connection implies.
 *
 * Every function takes the database handle so a test can pass a transaction and
 * roll it back. Column and constraint names verified against
 * `packages/db/src/schema/auth-challenges.ts` and `users.ts`.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { authChallenges, users } from "@nuts/db/schema/index";
import type { AuthChallenge, User } from "@nuts/db/schema/index";
import { AUTH_CHAIN_ID, CHALLENGE_TTL_SECONDS } from "./constants";

/** The shared handle or a transaction handle from `db.transaction`. */
export type Database =
	| typeof defaultDb
	| Parameters<Parameters<typeof defaultDb.transaction>[0]>[0];

/**
 * Lowercase form required by the `users_wallet_address_lowercase` and
 * `auth_challenges_wallet_address_lowercase` CHECKs. Rejects anything that is
 * not a 20-byte hex address, so a malformed value never reaches the database.
 */
export function normalizeWalletAddress(value: string): string {
	const lower = value.trim().toLowerCase();
	if (!/^0x[0-9a-f]{40}$/.test(lower)) {
		throw new Error("Wallet address must be a 0x-prefixed 20-byte hex string");
	}
	return lower;
}

/** 16 random bytes as hex. Unique index `auth_challenges_nonce_unique` also enforces uniqueness. */
export function newNonce(): string {
	return randomBytes(16).toString("hex");
}

export async function issueChallenge(
	database: Database,
	input: { walletAddress: string; domain: string },
): Promise<AuthChallenge> {
	const walletAddress = normalizeWalletAddress(input.walletAddress);
	// TODO-OWNER: CHALLENGE_TTL_SECONDS is a placeholder nonce lifetime.
	const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
	const [row] = await database
		.insert(authChallenges)
		.values({
			walletAddress,
			nonce: newNonce(),
			domain: input.domain,
			chainId: AUTH_CHAIN_ID,
			expiresAt,
		})
		.returning();
	if (!row) throw new Error("Failed to issue auth challenge");
	return row;
}

/**
 * Consumes a challenge atomically. The single UPDATE is the single-use fence:
 * two concurrent verifications race on the same row and exactly one sees
 * `consumed_at IS NULL`, so the loser gets null and no signature is checked
 * twice against the same nonce.
 *
 * Returns null for an unknown nonce, a wrong wallet, an expired challenge or a
 * nonce that was already spent — the caller cannot tell these apart, which is
 * the intent.
 */
export async function consumeChallenge(
	database: Database,
	input: { nonce: string; walletAddress: string },
): Promise<AuthChallenge | null> {
	const walletAddress = normalizeWalletAddress(input.walletAddress);
	const rows = await database
		.update(authChallenges)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(authChallenges.nonce, input.nonce),
				eq(authChallenges.walletAddress, walletAddress),
				isNull(authChallenges.consumedAt),
				gt(authChallenges.expiresAt, new Date()),
			),
		)
		.returning();
	return rows[0] ?? null;
}

/**
 * Create-or-fetch by lowercase address. Idempotent: a second connect from the
 * same wallet conflicts on `users_wallet_address_unique` and returns the
 * existing row, so two connects produce exactly one row.
 *
 * The profile columns (`display_name`, `bio`, `avatar_url`) are left null. The
 * wallet address is the identity; nothing is invented for a new user.
 */
export async function createOrFetchUser(
	database: Database,
	walletAddressInput: string,
): Promise<User> {
	const walletAddress = normalizeWalletAddress(walletAddressInput);
	const inserted = await database
		.insert(users)
		.values({ walletAddress })
		.onConflictDoNothing({ target: users.walletAddress })
		.returning();
	if (inserted[0]) return inserted[0];
	const existing = await database
		.select()
		.from(users)
		.where(eq(users.walletAddress, walletAddress))
		.limit(1);
	if (existing[0]) return existing[0];
	// Unreachable unless the row was deleted between the two statements.
	throw new Error(`Failed to create or fetch user for ${walletAddress}`);
}

/** Housekeeping helper for expired, unconsumed nonces. Not wired to a schedule. */
export async function deleteExpiredChallenges(database: Database): Promise<number> {
	const rows = await database
		.delete(authChallenges)
		.where(sql`${authChallenges.expiresAt} <= now()`)
		.returning({ id: authChallenges.id });
	return rows.length;
}
