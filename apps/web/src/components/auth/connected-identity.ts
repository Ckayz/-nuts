"use client";
import { useEffect, useState } from "react";

/**
 * B-R2 (lane B pass 2), second half. WHO the browser is currently acting as,
 * published once by the header's wallet control and read by every social
 * control on the page.
 *
 * The first half of B-R2 made a mismatched wallet retry its sign-out
 * (`use-session-mismatch.ts`). The half this file exists for is what happens
 * WHILE that is unresolved: the sign-out can fail (offline, a 500), and until
 * it succeeds the server session is still the OLD identity — so a Like, a
 * Follow or a comment posted in that window is attributed to the account the
 * person just left. Reviewer, measured: "`toggleLike`, `toggleFollow`, and
 * `addComment` pass `getSession().userId` directly to their writers. WalletBar's
 * mismatch handling does not disable those controls across the application."
 *
 * Why a module store and not React context: the wallet control lives in the
 * layout's top bar and the social controls are rendered by Server Components
 * several routes deep, so there is no shared client parent to hold state and no
 * prop path from one to the other. A context Provider would have to be added to
 * `components/providers.tsx` anyway; a store keeps the value in one place,
 * costs no re-render of the tree, and is directly testable — a test publishes
 * and renders, with no provider to assemble.
 *
 * Identity is a property of the TAB, not of any one component, so one
 * module-level value is the honest shape.
 *
 * SERVER SAFETY: nothing here is ever written during a server render. The only
 * writer is `publishConnectedIdentity`, called from a `useEffect` in
 * `wallet-bar.tsx`, and effects do not run on the server. A server render
 * therefore always reads the initial value below, which is also what the
 * browser reads on its first render — so hydration cannot disagree.
 */

export interface ConnectedIdentity {
	/**
	 * Is a signed-in session now looking at a DIFFERENT connected account?
	 * `accountMismatch` in `use-session-mismatch.ts` is the one definition; this
	 * is that value, published.
	 */
	readonly mismatched: boolean;
	/**
	 * The connected account as the publisher gives it — `wallet-bar.tsx`
	 * lower-cases it, and `lib/social/guards.ts` compares case-insensitively, so
	 * neither end depends on the other's casing. Null when no wallet is connected.
	 */
	readonly address: string | null;
}

const SIGNED_OUT: ConnectedIdentity = { mismatched: false, address: null };

let current: ConnectedIdentity = SIGNED_OUT;
const listeners = new Set<(value: ConnectedIdentity) => void>();

/** The value as of now. Exported for tests and for the hook's first render. */
export function connectedIdentity(): ConnectedIdentity {
	return current;
}

/**
 * Publish the wallet control's view of who this browser is.
 *
 * Called only from an effect. There is deliberately NO reset on unmount: if the
 * wallet control disappears, nothing can prove the identities agree again, and
 * clearing a `mismatched: true` would re-enable exactly the writes this exists
 * to stop. Fail closed.
 */
export function publishConnectedIdentity(value: ConnectedIdentity): void {
	if (value.mismatched === current.mismatched && value.address === current.address) return;
	current = value;
	// A copy, so a listener that unsubscribes during the walk cannot skip another.
	for (const listener of [...listeners]) listener(current);
}

/** Subscribe; returns the unsubscribe. */
export function subscribeConnectedIdentity(listener: (value: ConnectedIdentity) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** TEST SEAM: forget everything, so one test's publish cannot reach the next. */
export function resetConnectedIdentity(): void {
	current = SIGNED_OUT;
	listeners.clear();
}

/**
 * The published identity, re-rendering the caller when it changes.
 *
 * `useState` + `useEffect` rather than `useSyncExternalStore` for one reason
 * that matters here: this must render under `react-dom/server` (the OG routes
 * and this repo's component tests both use `renderToStaticMarkup`), where
 * `useSyncExternalStore` demands a separate server snapshot. The re-read inside
 * the effect closes the subscribe gap — a publish between the first render and
 * the subscription is picked up rather than lost.
 */
export function useConnectedIdentity(): ConnectedIdentity {
	const [value, setValue] = useState(connectedIdentity);
	useEffect(() => {
		setValue(connectedIdentity());
		return subscribeConnectedIdentity(setValue);
	}, []);
	return value;
}
