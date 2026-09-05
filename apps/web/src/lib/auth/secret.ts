/**
 * The single place `SESSION_SECRET` is read.
 *
 * FOLLOW-UP (out of this round's fence): this belongs in `packages/env`'s
 * validated server schema as `SESSION_SECRET: z.string().min(32)`, next to
 * DATABASE_URL and BASE_RPC_URL, so a missing value fails at boot instead of at
 * first sign-in. `packages/env` is owned by another writer this round, so the
 * value is read from `process.env` here and validated at first use with the same
 * 32-character floor. Documented in `apps/web/.env.example`.
 */

const MINIMUM_SECRET_LENGTH = 32;

let cached: string | undefined;

export function getSessionSecret(): string {
	if (cached !== undefined) return cached;
	const value = process.env.SESSION_SECRET;
	if (!value) {
		throw new Error(
			"SESSION_SECRET is not set. Sign-in cookies cannot be signed. Add a random value of at least " +
				`${MINIMUM_SECRET_LENGTH} characters to apps/web/.env (see apps/web/.env.example).`,
		);
	}
	if (value.length < MINIMUM_SECRET_LENGTH) {
		throw new Error(
			`SESSION_SECRET is ${value.length} characters; at least ${MINIMUM_SECRET_LENGTH} are required.`,
		);
	}
	cached = value;
	return cached;
}

/** Test seam: clears the memoised value so a test can vary the environment. */
export function resetSessionSecretCache(): void {
	cached = undefined;
}
