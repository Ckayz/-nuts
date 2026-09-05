/**
 * B-m3. A signed-in session must never keep acting as the old identity once a
 * DIFFERENT account is connected.
 *
 * `WalletBar` is a wagmi client component with no DOM harness in this repo (no
 * testing-library, and `useAccount` throws outside a provider), so the decision
 * and the once-only guard live in two exported pure functions in
 * `use-session-mismatch.ts` and are exercised here directly. The last two blocks
 * read the hook's and the component's own bytes to prove the wiring.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { mount } from "@/test/hook-runner";
import { accountMismatch, syncSessionToAccount, useSessionMismatch } from "./use-session-mismatch";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

test("accountMismatch: only a wallet connected AS SOMEBODY ELSE contradicts the session", () => {
	// No session: nothing to contradict.
	expect(accountMismatch(null, true, B)).toBe(false);
	// Disconnected, or connected with no address yet: the session is still real.
	expect(accountMismatch(A, false, B)).toBe(false);
	expect(accountMismatch(A, false, undefined)).toBe(false);
	expect(accountMismatch(A, true, undefined)).toBe(false);
	// Same account, any casing.
	expect(accountMismatch(A, true, A)).toBe(false);
	expect(accountMismatch(A.toUpperCase(), true, A)).toBe(false);
	expect(accountMismatch(A, true, A.toUpperCase())).toBe(false);
	// The bug this fixes.
	expect(accountMismatch(A, true, B)).toBe(true);
});

function harness(signOutImpl?: () => Promise<void>) {
	const calls: string[] = [];
	let signedOut = 0;
	const handled = { current: null as string | null };
	const signOut = async () => {
		calls.push("signOut");
		if (signOutImpl) await signOutImpl();
	};
	return {
		calls,
		handled,
		signedOutCount: () => signedOut,
		// The signed-in session is A unless a case says otherwise; the guard is
		// keyed on the session AND the connected address (B-R2).
		run: (mismatched: boolean, address: string | undefined, sessionWallet: string | null = A) =>
			syncSessionToAccount({ mismatched, sessionWallet, address, handled, signOut, onSignedOut: () => { signedOut += 1; } }),
	};
}

test("session A + connected B signs the server session out exactly once across re-renders", async () => {
	const h = harness();
	await h.run(true, B);
	expect(h.calls).toHaveLength(1);
	expect(h.signedOutCount()).toBe(1);
	// Three more renders with the same mismatch: no further sign-outs.
	await h.run(true, B);
	await h.run(true, B);
	await h.run(true, B);
	expect(h.calls).toHaveLength(1);
	expect(h.signedOutCount()).toBe(1);
});

test("re-renders DURING the in-flight sign-out cannot fire a second one", async () => {
	let release: (() => void) | undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const h = harness(() => gate);
	const first = h.run(true, B);
	const second = h.run(true, B);
	const third = h.run(true, B);
	expect(h.calls).toHaveLength(1); // the ref is written BEFORE the await
	release!();
	await Promise.all([first, second, third]);
	expect(h.calls).toHaveLength(1);
	expect(h.signedOutCount()).toBe(1);
});

test("no mismatch, or no address, signs nothing out", async () => {
	const h = harness();
	await h.run(false, B);
	await h.run(false, undefined);
	await h.run(true, undefined);
	expect(h.calls).toEqual([]);
	expect(h.signedOutCount()).toBe(0);
});

test("a FAILED sign-out stays retryable and never claims the session was cleared", async () => {
	const h = harness(() => Promise.reject(new Error("network down")));
	await h.run(true, B);
	expect(h.calls).toHaveLength(1);
	expect(h.signedOutCount()).toBe(0); // the server session is still live
	expect(h.handled.current).toBeNull();
	await h.run(true, B); // a later render retries
	expect(h.calls).toHaveLength(2);
});

/**
 * B-R2 (lane B pass 2). The guard remembered the connected ADDRESS only, so a
 * second signed-in session under the same connected wallet matched the old mark
 * and was never signed out. The reviewer measured `NEW_SESSION_SAME_ADDRESS 1`.
 */
test("B-R2: a DIFFERENT mismatched session under the same address signs out again", async () => {
	const h = harness();
	await h.run(true, B, A);
	expect(h.calls).toHaveLength(1);
	// Signed in as C while still connected to B: a new session, a new sign-out.
	await h.run(true, B, "0x00000000000000000000000000000000000000cc");
	expect(h.calls).toHaveLength(2);
	expect(h.signedOutCount()).toBe(2);
	// The same pair again is still handled exactly once.
	await h.run(true, B, "0x00000000000000000000000000000000000000cc");
	expect(h.calls).toHaveLength(2);
});

test("switching to a THIRD account signs out again", async () => {
	const h = harness();
	await h.run(true, B);
	await h.run(true, "0x00000000000000000000000000000000000000cc");
	expect(h.calls).toHaveLength(2);
	expect(h.signedOutCount()).toBe(2);
});

/**
 * B-C1. The reviewer's four-step sequence. Before the fix the guard remembered
 * B forever, so step 4 returned early and session A stayed live under wallet B:
 *
 *   1 sign-in A, switch to B: {calls: 1, handled: "0xbb"}
 *   2 back to A (no session):  {calls: 1, handled: "0xbb"}
 *   3 sign in as A:            {calls: 1, handled: "0xbb"}
 *   4 switch to B again:       {calls: 1, handled: "0xbb"}   <- no sign-out
 */
test("B-C1: A -> B -> A -> B signs out BOTH times", async () => {
	const h = harness();
	// 1. Signed in as A, wallet switches to B.
	await h.run(true, B);
	expect(h.calls).toHaveLength(1);
	// 2. The sign-out landed, so there is no session to contradict any more.
	await h.run(false, B);
	expect(h.handled.current).toBeNull();
	// 3. Back on A and signed in again: still no mismatch.
	await h.run(false, A);
	// 4. Switch to B a SECOND time. This is the step that used to do nothing.
	await h.run(true, B);
	expect(h.calls).toHaveLength(2);
	expect(h.signedOutCount()).toBe(2);
});

test("B-C1: the guard is cleared by ANY run without a mismatch, whatever the address", async () => {
	const h = harness();
	await h.run(true, B);
	await h.run(false, undefined);
	expect(h.handled.current).toBeNull();
	await h.run(true, B);
	expect(h.calls).toHaveLength(2);
});

test("the hook runs the effect through the guard and defaults to the real signOut action", () => {
	const source = readFileSync(new URL("./use-session-mismatch.ts", import.meta.url), "utf8");
	expect(source).toContain("void syncSessionToAccount({");
	expect(source).toContain("handled,");
	// B-R2: the effect must carry NO dependency array, or a failed sign-out is
	// never retried until the person switches accounts.
	expect(source).toContain("\t\t});\n\t});\n\treturn mismatched;");
	expect(source).not.toContain("}, [mismatched, address]);");
	expect(source).toContain("signOut: () => signOutRef.current(),");
	// The seam DEFAULTS to the real action, so a caller that passes nothing —
	// `WalletBar` — still signs the server session out.
	expect(source).toContain("signOut: () => Promise<void> = signOutAction,");
	expect(source).toContain('import { signOut as signOutAction } from "@/lib/auth/actions";');
});

/**
 * B-C1, at HOOK level. The pure-function tests above drive `handled` by hand;
 * these mount the real hook, so the ref lifecycle, the effect and its
 * `[mismatched, address]` deps are the ones under test.
 */
describe("useSessionMismatch, mounted", () => {
	function mountHook(signOut: () => Promise<void>) {
		const calls: string[] = [];
		let session: string | null = null;
		let connected = true;
		let address: string | undefined = undefined;
		const wrapped = async () => {
			calls.push("signOut");
			await signOut();
		};
		function Probe(): ReactElement {
			// `force` stands in for `WalletBar`'s `setSession(null)`: the caller drops
			// the session in React state, which re-renders and re-runs the effect.
			const [, force] = useState(0);
			const onSignedOut = () => {
				session = null;
				force((n) => n + 1);
			};
			const mismatched = useSessionMismatch(session, connected, address, onSignedOut, wrapped);
			return createElement("div", null, mismatched ? "mismatch" : "ok");
		}
		const view = mount(Probe as (props: never) => ReactElement, {});
		return {
			calls,
			async set(next: { session?: string | null; address?: string | undefined; connected?: boolean }) {
				if ("session" in next) session = next.session ?? null;
				if ("address" in next) address = next.address;
				if ("connected" in next) connected = next.connected ?? true;
				view.setProps({});
				await view.settle();
			},
			text: () => view.text(),
		};
	}

	test("the four-step wallet switch signs out TWICE through the real hook", async () => {
		const h = mountHook(async () => {});
		await h.set({ session: A, address: A });
		expect(h.calls).toHaveLength(0);
		// Switch to B: mismatch, sign-out, and the caller drops the session.
		await h.set({ address: B });
		expect(h.calls).toHaveLength(1);
		expect(h.text()).toBe("ok"); // the session went away, so nothing is mismatched
		// Back on A and signed in again.
		await h.set({ session: A, address: A });
		expect(h.calls).toHaveLength(1);
		// And switch to B a second time.
		await h.set({ address: B });
		expect(h.calls).toHaveLength(2);
	});

	/**
	 * B-R2 (lane B pass 2), the reviewer's own sequence. The effect's deps used to
	 * be `[mismatched, address]`, so a failed sign-out was retried ONLY if the
	 * person switched accounts again: the reviewer measured `FIRST_FAILURE 1 /
	 * RECOVERED_RERENDER 1 / NEW_SESSION_SAME_ADDRESS 1`, i.e. the old identity
	 * stayed usable for likes, comments and follows indefinitely. The effect now
	 * has no dependency array, and the guard is keyed on session + address.
	 */
	test("B-R2: a failed sign-out is retried on a later render and by a new mismatched session", async () => {
		let recovered = false;
		const h = mountHook(async () => { if (!recovered) throw new Error("network down"); });
		await h.set({ session: A, address: B });
		expect(h.calls).toHaveLength(1); // FIRST_FAILURE
		expect(h.text()).toBe("mismatch"); // the server session is still live
		// A bare re-render once the network is back: the retry happens here. This
		// is the step that used to stay at 1.
		recovered = true;
		await h.set({});
		expect(h.calls).toHaveLength(2); // RECOVERED_RERENDER
		// A DIFFERENT signed-in session under the same connected wallet is its own
		// unit of work, so it signs out too.
		await h.set({ session: "0x00000000000000000000000000000000000000cc" });
		expect(h.calls).toHaveLength(3); // NEW_SESSION_SAME_ADDRESS
	});

	/**
	 * The bound on the retry: at most ONE attempt per render. A successful
	 * sign-out is not repeated by the extra renders the no-deps effect now sees,
	 * and the failure path sets no state, so it cannot schedule its own re-run.
	 */
	test("B-R2: a SUCCESSFUL sign-out is not repeated by later renders", async () => {
		const h = mountHook(async () => {});
		await h.set({ session: A, address: B });
		expect(h.calls).toHaveLength(1);
		await h.set({});
		await h.set({});
		await h.set({});
		expect(h.calls).toHaveLength(1);
	});
});

test("WalletBar calls the hook and reads the SAME predicate for the header", () => {
	// One import and one call: the wallet UI is being reworked in parallel, so
	// this change must stay a one-line merge.
	const source = readFileSync(new URL("./wallet-bar.tsx", import.meta.url), "utf8");
	expect(source).toContain('import { useSessionMismatch } from "./use-session-mismatch";');
	expect(source).toContain("const mismatched = useSessionMismatch(session?.walletAddress ?? null, isConnected, address, () => setSession(null));");
	// The chip and the actions cannot disagree about who is signed in.
	expect(source).toContain("const sessionMatchesAccount = session !== null && !mismatched;");
});
