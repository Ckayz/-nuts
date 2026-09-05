/**
 * Session token codec: an HMAC-SHA256-signed, base64url-encoded JSON payload.
 *
 * Not encrypted — the payload holds only the user id and wallet address, both of
 * which are public onchain identities. The signature is what makes the cookie
 * unforgeable; the cookie itself is set httpOnly so page scripts cannot read it.
 *
 * Pure over an injected secret so it can be tested without process environment.
 * `signSessionToken` / `verifySessionToken` in `session.ts` bind it to
 * `getSessionSecret()`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
	/** Codec version. Bumped only if the payload shape changes. */
	v: 1;
	/** `users.id` (uuid). */
	uid: string;
	/** Lowercase wallet address, matching `users.wallet_address`. */
	addr: string;
	/** Issued-at, seconds since epoch. */
	iat: number;
	/** Expiry, seconds since epoch. */
	exp: number;
}

function base64url(input: Buffer): string {
	return input.toString("base64url");
}

function hmac(secret: string, body: string): Buffer {
	return createHmac("sha256", secret).update(body).digest();
}

export function encodeSessionToken(payload: SessionPayload, secret: string): string {
	const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
	return `${body}.${base64url(hmac(secret, body))}`;
}

/**
 * Returns the payload only when the signature matches and the token has not
 * expired. Every failure path returns null; nothing is thrown, so a tampered or
 * stale cookie signs the visitor out instead of breaking the page.
 */
export function decodeSessionToken(
	token: string,
	secret: string,
	now: Date = new Date(),
): SessionPayload | null {
	const separator = token.indexOf(".");
	if (separator <= 0) return null;
	const body = token.slice(0, separator);
	const signature = token.slice(separator + 1);
	if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;

	const expected = hmac(secret, body);
	const provided = Buffer.from(signature, "base64url");
	// timingSafeEqual throws on a length mismatch, so compare lengths first.
	if (provided.length !== expected.length) return null;
	if (!timingSafeEqual(provided, expected)) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = parsed as Record<string, unknown>;
	if (candidate.v !== 1) return null;
	if (typeof candidate.uid !== "string" || candidate.uid.length === 0) return null;
	if (typeof candidate.addr !== "string" || !/^0x[0-9a-f]{40}$/.test(candidate.addr)) return null;
	if (typeof candidate.iat !== "number" || !Number.isFinite(candidate.iat)) return null;
	if (typeof candidate.exp !== "number" || !Number.isFinite(candidate.exp)) return null;
	if (candidate.exp * 1000 <= now.getTime()) return null;

	return {
		v: 1,
		uid: candidate.uid,
		addr: candidate.addr,
		iat: candidate.iat,
		exp: candidate.exp,
	};
}
