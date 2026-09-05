import "server-only";

/**
 * Sign-in orchestration, independent of the Next request context so it can be
 * driven directly by a test with a rolled-back transaction and a stubbed
 * verifier. The server actions in `actions.ts` add cookies and headers on top.
 */
import type { User } from "@nuts/db/schema/index";
import { SIGN_IN_STATEMENT } from "./constants";
import { buildSignInMessage } from "./message";
import { consumeChallenge, createOrFetchUser, issueChallenge, normalizeWalletAddress, type Database } from "./store";
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
 * Consumes the nonce **before** checking the signature. A burned nonce on a bad
 * signature is the safe direction: it costs an honest user one extra click and
 * denies an attacker repeated attempts against the same challenge.
 *
 * The signed message is rebuilt from the consumed row, never taken from the
 * client, so domain, chain and expiry are the server's own values.
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
	const challenge = await consumeChallenge(database, { nonce: input.nonce, walletAddress });
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

	const user = await createOrFetchUser(database, walletAddress);
	return { ok: true, user };
}
