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
 * action cannot fire a second sign-out.
 *
 * B-C1 (lane B confirming pass). `handled` is CLEARED the moment the mismatch
 * is gone, and that clearing is the whole fix. It used to remember the
 * mismatching address forever, so this sequence left a live session under the
 * wrong wallet:
 *
 *   sign in as A -> switch to B   the session is signed out, `handled` = B
 *   back to A, sign in again      a real session for A, `handled` STILL B
 *   switch to B again             `handled.current === "B"` -> early return,
 *                                 so session A stayed valid while the wallet
 *                                 was B, and `getSession()` kept acting as A.
 *
 * Clearing on `!mismatched` cannot loop: nothing below sets state on that
 * branch, and the branch does no work.
 *
 * A FAILED sign-out clears `handled` too, so the NEXT run of this function
 * retries instead of pretending the session was cleared. At hook level that
 * next run needs the effect to fire again — its deps are `[mismatched,
 * address]` — so the retry happens on the next account or mismatch change, not
 * on an arbitrary re-render. `use-session-mismatch.test.ts` pins both.
 */
export async function syncSessionToAccount(input: {
	mismatched: boolean;
	address: string | undefined;
	handled: { current: string | null };
	signOut: () => Promise<void>;
	onSignedOut: () => void;
}): Promise<void> {
	const { mismatched, address, handled } = input;
	if (!mismatched) {
		handled.current = null;
		return;
	}
	if (address === undefined) return;
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
 *
 * `signOut` is a TEST SEAM and nothing else: `WalletBar` passes nothing, so the
 * real server action runs. It exists because the bug B-C1 found lives in the
 * REF LIFECYCLE across effect runs, which extracted pure functions cannot show
 * — the hook itself has to be mounted, and mounting it must not fire a real
 * sign-out.
 */
export function useSessionMismatch(
	sessionWallet: string | null,
	isConnected: boolean,
	address: string | undefined,
	onSignedOut: () => void,
	signOut: () => Promise<void> = signOutAction,
): boolean {
	const mismatched = accountMismatch(sessionWallet, isConnected, address);
	const handled = useRef<string | null>(null);
	const signedOut = useRef(onSignedOut);
	signedOut.current = onSignedOut;
	const signOutRef = useRef(signOut);
	signOutRef.current = signOut;
	useEffect(() => {
		void syncSessionToAccount({
			mismatched,
			address,
			handled,
			signOut: () => signOutRef.current(),
			onSignedOut: () => signedOut.current(),
		});
	}, [mismatched, address]);
	return mismatched;
}
