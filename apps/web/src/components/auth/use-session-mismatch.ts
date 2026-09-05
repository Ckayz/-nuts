"use client";
import { useEffect, useRef } from "react";
import { signOut as signOutAction } from "@/lib/auth/actions";

/**
 * B-m3. A signed-in session must never keep acting as the old identity once a
 * DIFFERENT account is connected.
 *
 * The header already dropped back to "Sign in" on a mismatch, but the SERVER
 * session stayed valid — so likes, comments and follows kept acting as the old
 * identity while the chip said nobody was signed in. The two now agree: a
 * mismatch signs the server session out, and returning to the original account
 * requires a fresh sign-in.
 *
 * TODO-OWNER: the owner may prefer to keep the old session alive and prompt
 * instead of signing out, or to sign out only when the person acts.
 *
 * This lives in its own file so `wallet-bar.tsx` needs one import and one call:
 * the wallet UI is being reworked in parallel and a merge should not have to
 * untangle two changes in one component.
 */

/**
 * Is a signed-in session now looking at a DIFFERENT connected account?
 *
 * A disconnected wallet is NOT a mismatch: the server session is still a real
 * session for the address that signed it, and the person may simply have closed
 * their wallet. Only a wallet connected AS SOMEBODY ELSE contradicts it.
 */
export function accountMismatch(
	sessionWallet: string | null,
	isConnected: boolean,
	address: string | undefined,
): boolean {
	if (sessionWallet === null) return false;
	if (!isConnected || address === undefined) return false;
	return address.toLowerCase() !== sessionWallet.toLowerCase();
}

/**
 * The effect body, extracted so it can be exercised without a DOM.
 *
 * `handled` is written BEFORE the await, so re-renders during the in-flight
 * action cannot fire a second sign-out. A FAILED sign-out clears it again: the
 * session really is still live, so a later render must retry rather than
 * pretend it was cleared. Nothing here sets state on failure, so that retry
 * cannot become a render loop.
 */
export async function syncSessionToAccount(input: {
	mismatched: boolean;
	address: string | undefined;
	handled: { current: string | null };
	signOut: () => Promise<void>;
	onSignedOut: () => void;
}): Promise<void> {
	const { mismatched, address, handled } = input;
	if (!mismatched || address === undefined) return;
	if (handled.current === address) return;
	handled.current = address;
	try {
		await input.signOut();
	} catch {
		handled.current = null;
		return;
	}
	input.onSignedOut();
}

/**
 * Returns whether the session and the connected account disagree, and signs the
 * server session out exactly once when they do.
 *
 * `onSignedOut` is read from a ref so an inline arrow in the caller cannot
 * re-run the effect.
 */
export function useSessionMismatch(
	sessionWallet: string | null,
	isConnected: boolean,
	address: string | undefined,
	onSignedOut: () => void,
): boolean {
	const mismatched = accountMismatch(sessionWallet, isConnected, address);
	const handled = useRef<string | null>(null);
	const signedOut = useRef(onSignedOut);
	signedOut.current = onSignedOut;
	useEffect(() => {
		void syncSessionToAccount({
			mismatched,
			address,
			handled,
			signOut: signOutAction,
			onSignedOut: () => signedOut.current(),
		});
	}, [mismatched, address]);
	return mismatched;
}
