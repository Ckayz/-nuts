import "server-only";

/**
 * Session cookie read/write and the `getSession()` helper every server read uses.
 *
 * The cookie is httpOnly, sameSite=lax (so the sign-in redirect and normal
 * navigation keep it) and `secure` outside development. It is signed, not
 * encrypted; see `token.ts`.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./constants";
import { getSessionSecret } from "./secret";
import { decodeSessionToken, encodeSessionToken, type SessionPayload } from "./token";

export interface Session {
	userId: string;
	/** Lowercase, as stored in `users.wallet_address`. */
	walletAddress: string;
	expiresAt: Date;
}

function toSession(payload: SessionPayload): Session {
	return {
		userId: payload.uid,
		walletAddress: payload.addr,
		expiresAt: new Date(payload.exp * 1000),
	};
}

/** Null when there is no cookie, the signature fails, or the session expired. */
export async function getSession(): Promise<Session | null> {
	const store = await cookies();
	const token = store.get(SESSION_COOKIE_NAME)?.value;
	if (!token) return null;
	const payload = decodeSessionToken(token, getSessionSecret());
	return payload === null ? null : toSession(payload);
}

/** Only callable from a server action or route handler; cookies are immutable in a page render. */
export async function setSession(input: { userId: string; walletAddress: string }): Promise<Session> {
	const issuedAt = Math.floor(Date.now() / 1000);
	// TODO-OWNER: SESSION_TTL_SECONDS is a placeholder, not an approved session length.
	const payload: SessionPayload = {
		v: 1,
		uid: input.userId,
		addr: input.walletAddress.toLowerCase(),
		iat: issuedAt,
		exp: issuedAt + SESSION_TTL_SECONDS,
	};
	const store = await cookies();
	store.set(SESSION_COOKIE_NAME, encodeSessionToken(payload, getSessionSecret()), {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: SESSION_TTL_SECONDS,
	});
	return toSession(payload);
}

export async function clearSession(): Promise<void> {
	const store = await cookies();
	store.delete(SESSION_COOKIE_NAME);
}
