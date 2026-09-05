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
		run: (mismatched: boolean, address: string | undefined) =>
			syncSessionToAccount({ mismatched, address, handled, signOut, onSignedOut: () => { signedOut += 1; } }),
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
	 * A failed sign-out leaves the guard clear, so the NEXT effect run retries.
	 * The effect's deps are `[mismatched, address]`: a re-render that changes
	 * neither does NOT re-run it, so the retry rides on the next account change
	 * rather than on any render. That is what this pins — the doc comment used to
	 * promise a retry "on a later render", which is not what the hook does.
	 */
	test("a failed sign-out retries on the next account change, not on a bare re-render", async () => {
		const h = mountHook(async () => { throw new Error("network down"); });
		await h.set({ session: A, address: B });
		expect(h.calls).toHaveLength(1);
		expect(h.text()).toBe("mismatch"); // the server session is still live
		// A re-render that changes neither dep: the effect does not run again.
		await h.set({});
		expect(h.calls).toHaveLength(1);
		// A new address changes a dep, so the retry happens.
		await h.set({ address: "0x00000000000000000000000000000000000000cc" });
		expect(h.calls).toHaveLength(2);
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
