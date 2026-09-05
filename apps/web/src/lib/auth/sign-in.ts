import "server-only";

/**
 * Sign-in orchestration, independent of the Next request context so it can be
 * driven directly by a test with a rolled-back transaction and a stubbed
 * verifier. The server actions in `actions.ts` add cookies and headers on top.
 */
import type { User } from "@nuts/db/schema/index";
import { SIGN_IN_STATEMENT } from "./constants";
import { buildSignInMessage } from "./message";
import { consumeChallenge, createOrFetchUser, issueChallenge, normalizeWalletAddress, peekChallenge, type Database } from "./store";
import { verifyWalletSignature, type SignatureVerifier } from "./verifier";

export interface SignInChallenge {
	nonce: string;
	/** Exact bytes to pass to `personal_sign`. */
	message: string;
	expiresAt: string;
}

export async function startSignIn(
	database: Database,
	input: { walletAddress: string; domain: string },
): Promise<SignInChallenge> {
	const row = await issueChallenge(database, input);
	return {
		nonce: row.nonce,
		message: buildSignInMessage({
			domain: row.domain,
			walletAddress: row.walletAddress,
			chainId: row.chainId,
			nonce: row.nonce,
			statement: SIGN_IN_STATEMENT,
			expiresAt: row.expiresAt,
		}),
		expiresAt: row.expiresAt.toISOString(),
	};
}

export type CompleteSignInFailure =
	| "challenge_invalid"
	| "domain_mismatch"
	| "signature_invalid";

export type CompleteSignInResult =
	| { ok: true; user: User }
	| { ok: false; reason: CompleteSignInFailure };

/**
 * Verifies the signature FIRST, then consumes the nonce.
 *
 * `requestSignInChallenge` is unauthenticated and returns the wallet's LIVE
 * challenge to any caller (`issueChallenge` reuses the unconsumed row), so a
 * consume-before-verify order let anyone burn another wallet's challenge by
 * posting junk: the honest owner's pending signature then failed as
 * `challenge_invalid`. Order here is peek → domain → signature syntax →
 * signature → atomic consume, so a failed attempt leaves the row spendable and
 * only a genuine signature spends it.
 *
 * Single use is still enforced by the atomic consume: two verifications of the
 * same nonce race on one UPDATE and the loser gets `challenge_invalid`.
 *
 * The signed message is rebuilt from the stored row, never taken from the
 * client, so domain, chain and expiry are the server's own values.
 *
 * TODO-OWNER: how many failed verification attempts one live challenge may
 * absorb (and any per-wallet or per-IP rate limit) is a product limit and is
 * not set here.
 */
export async function completeSignIn(
	database: Database,
	input: {
		walletAddress: string;
		nonce: string;
		signature: string;
		/** Host of the request doing the verification. */
		domain: string;
		verify?: SignatureVerifier;
	},
): Promise<CompleteSignInResult> {
	const walletAddress = normalizeWalletAddress(input.walletAddress);
	const challenge = await peekChallenge(database, { nonce: input.nonce, walletAddress });
	if (challenge === null) return { ok: false, reason: "challenge_invalid" };
	if (challenge.domain !== input.domain) return { ok: false, reason: "domain_mismatch" };
	// No chain check: `issueChallenge` writes AUTH_CHAIN_ID (./constants) and the
	// `auth_challenges_base_chain` CHECK refuses any other value, so a stored row
	// cannot carry a different chain. The signed message still names the chain,
	// and it is rebuilt from `challenge.chainId` below.
	if (!/^0x[0-9a-fA-F]*$/.test(input.signature) || input.signature.length < 4) {
		return { ok: false, reason: "signature_invalid" };
	}

	const message = buildSignInMessage({
		domain: challenge.domain,
		walletAddress: challenge.walletAddress,
		chainId: challenge.chainId,
		nonce: challenge.nonce,
		statement: SIGN_IN_STATEMENT,
		expiresAt: challenge.expiresAt,
	});

	const verify = input.verify ?? verifyWalletSignature;
	const valid = await verify({
		address: walletAddress as `0x${string}`,
		message,
		signature: input.signature as `0x${string}`,
	});
	if (!valid) return { ok: false, reason: "signature_invalid" };

	// Only a verified signature spends the nonce. The UPDATE re-checks
	// unconsumed + unexpired, so a concurrent verification of the same nonce and
	// a challenge that expired during verification both land here as null.
	const spent = await consumeChallenge(database, { nonce: challenge.nonce, walletAddress });
	if (spent === null) return { ok: false, reason: "challenge_invalid" };

	const user = await createOrFetchUser(database, walletAddress);
	return { ok: true, user };
}
