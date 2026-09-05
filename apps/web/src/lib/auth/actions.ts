"use server";

/**
 * Server actions for sign-in with wallet. Every export must stay an async
 * function: Next treats this whole module as a client-callable surface, so the
 * session shape and `truncateAddress` live in `./address`.
 */
import { headers } from "next/headers";
import { db } from "@nuts/db";
import { vercelOrigin } from "@nuts/env/server";
import { truncateAddress, type SignInSessionSummary } from "./address";
import { clearSession, getSession, setSession } from "./session";
import { completeSignIn, startSignIn } from "./sign-in";

/**
 * The authority the challenge is bound to.
 *
 * `vercelOrigin` (packages/env/src/server.ts) is the deployment's own URL, set
 * by the platform and not by the caller, so it is used whenever it exists — it
 * is the only configured origin `@nuts/env` holds. Off Vercel there is none, and
 * the fallback is the `Host` header, which the caller controls. That is not a
 * security boundary on its own; the fence is the signature over the
 * server-issued nonce. Binding still stops a signature captured on one
 * deployment from being replayed on another.
 *
 * TODO-OWNER: the canonical sign-in domain. Pinning it needs an owner-set value
 * (the production hostname), and this round does not add environment variables.
 */
async function requestDomain(): Promise<string> {
	if (vercelOrigin !== undefined) {
		try {
			return new URL(vercelOrigin).host;
		} catch {
			// A malformed platform URL falls through to the Host header rather
			// than taking sign-in down.
		}
	}
	const header = await headers();
	const host = header.get("host");
	if (!host) throw new Error("Request has no Host header; cannot bind an auth challenge");
	return host;
}

/** Read-only session probe used by the header on mount. */
export async function readSignInSession(): Promise<SignInSessionSummary | null> {
	const session = await getSession();
	if (session === null) return null;
	return {
		walletAddress: session.walletAddress,
		truncatedAddress: truncateAddress(session.walletAddress),
		expiresAt: session.expiresAt.toISOString(),
	};
}

/** Step 1: issue a single-use challenge for the connected wallet. */
export async function requestSignInChallenge(
	walletAddress: string,
): Promise<{ nonce: string; message: string; expiresAt: string }> {
	return startSignIn(db, { walletAddress, domain: await requestDomain() });
}

/**
 * Step 2: verify the signature, consume the nonce, create-or-fetch the user row
 * and set the session cookie. This is where "profile creation on wallet
 * connected" actually lands — a wallet that has signed in once has a `users`
 * row, and signing in again reuses it.
 */
export async function verifySignInSignature(input: {
	walletAddress: string;
	nonce: string;
	signature: string;
}): Promise<{ ok: true; session: SignInSessionSummary } | { ok: false; reason: string }> {
	const result = await completeSignIn(db, {
		walletAddress: input.walletAddress,
		nonce: input.nonce,
		signature: input.signature,
		domain: await requestDomain(),
	});
	if (!result.ok) return { ok: false, reason: result.reason };
	const session = await setSession({
		userId: result.user.id,
		walletAddress: result.user.walletAddress,
	});
	return {
		ok: true,
		session: {
			walletAddress: session.walletAddress,
			truncatedAddress: truncateAddress(session.walletAddress),
			expiresAt: session.expiresAt.toISOString(),
		},
	};
}

export async function signOut(): Promise<void> {
	await clearSession();
}
