/**
 * B-m3. A signed-in session must never keep acting as the old identity once a
 * DIFFERENT account is connected.
 *
 * `WalletBar` is a wagmi client component with no DOM harness in this repo (no
 * testing-library, and `useAccount` throws outside a provider), so the decision
 * and the once-only guard live in two exported pure functions and are exercised
 * here directly. The last block reads the component's own bytes to prove the
 * effect is actually wired to them.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { accountMismatch, syncSessionToAccount } from "./wallet-bar";

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

test("the component wires the effect to the guard and to the session state", () => {
	const source = readFileSync(new URL("./wallet-bar.tsx", import.meta.url), "utf8");
	expect(source).toContain("const mismatched = accountMismatch(session?.walletAddress ?? null, isConnected, address);");
	expect(source).toContain("void syncSessionToAccount({");
	expect(source).toContain("handled: signedOutFor,");
	expect(source).toContain("onSignedOut: () => setSession(null),");
	// The header's own decision reads the SAME predicate, so chip and actions
	// can never disagree about who is signed in.
	expect(source).toContain("const sessionMatchesAccount = session !== null && !mismatched;");
});
