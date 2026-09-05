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
 * What one sign-out attempt is FOR: this session, contradicted by this account.
 *
 * B-R2 (lane B pass 2). The guard used to remember only the connected address,
 * so a DIFFERENT signed-in session under the same connected wallet — sign in as
 * A while connected to B, the sign-out fires; sign in as C, still connected to
 * B — matched the old mark and was never signed out (measured:
 * `NEW_SESSION_SAME_ADDRESS 1`). Both halves identify the work.
 */
export function mismatchKey(sessionWallet: string | null, address: string): string {
	return `${(sessionWallet ?? "").toLowerCase()}->${address.toLowerCase()}`;
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
 * retries instead of pretending the session was cleared. B-R2: at hook level
 * that next run used to need `[mismatched, address]` to change, so a network
 * failure left the old identity usable until the person switched accounts
 * again. The hook below now runs this on every render while unresolved.
 */
export async function syncSessionToAccount(input: {
	mismatched: boolean;
	sessionWallet: string | null;
	address: string | undefined;
	handled: { current: string | null };
	signOut: () => Promise<void>;
	onSignedOut: () => void;
}): Promise<void> {
	const { mismatched, sessionWallet, address, handled } = input;
	if (!mismatched) {
		handled.current = null;
		return;
	}
	if (address === undefined) return;
	const key = mismatchKey(sessionWallet, address);
	if (handled.current === key) return;
	handled.current = key;
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
	// B-R2: NO dependency array. The deps used to be `[mismatched, address]`, so
	// a sign-out that failed (offline, a 500) was retried only if the person
	// switched accounts again — the old identity stayed usable for likes,
	// comments and follows indefinitely. Running on every render covers both
	// gaps the reviewer measured: a later render after the network recovers, and
	// a NEW mismatched session under the same connected address (the session
	// wallet is part of `mismatchKey`, so that case is a different unit of work
	// rather than a dependency-array entry).
	//
	// Why this is bounded and cannot spin: the failure path sets no state, so it
	// never schedules the render that would run it again — at most ONE attempt
	// per render, and renders come from elsewhere. `handled` is written BEFORE
	// the await, so concurrent renders cannot overlap two attempts. On success
	// `onSignedOut` renders once, after which `mismatched` is false and the body
	// only clears the mark. TODO-OWNER: whether a persistently failing sign-out
	// should back off or surface a retry button is the owner's call; no delay or
	// attempt ceiling is invented here.
	useEffect(() => {
		void syncSessionToAccount({
			mismatched,
			sessionWallet,
			address,
			handled,
			signOut: () => signOutRef.current(),
			onSignedOut: () => signedOut.current(),
		});
	});
	return mismatched;
}
