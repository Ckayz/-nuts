/**
 * Address presentation and the session shape the header renders.
 *
 * Kept out of `actions.ts` because a `"use server"` module may export only async
 * functions; a sync helper or a value export there fails the build.
 */

export interface SignInSessionSummary {
	/** Lowercase, as stored in `users.wallet_address`. */
	walletAddress: string;
	/** `0x1234…abcd`, matching the mockup's `.wallet` chip. */
	truncatedAddress: string;
	expiresAt: string;
}

/** Mirrors the mockup's `0x7c4a…e10b`: six leading characters, four trailing. */
export function truncateAddress(address: string): string {
	return address.length > 11 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
