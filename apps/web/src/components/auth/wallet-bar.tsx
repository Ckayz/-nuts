"use client";
import { Avatar } from "@/components/primitives";

/**
 * Header wallet control: connect, then sign in, then show the truncated address.
 *
 * Never signs without a click (PRD 8.1 step 5 is a user action). The session is
 * read through a server action on mount rather than in a Server Component so the
 * layout does not call `cookies()` — that would make every route dynamic and
 * change the build output of pages this round is not meant to touch.
 *
 * TODO-OWNER: connector, signing, disconnect and sign-out labels retain the
 * existing auth copy; the mockup specifies only the chip's resting state.
 */
import "@/styles/thread.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import type { SignInSessionSummary } from "@/lib/auth/address";
import {
	readSignInSession,
	requestSignInChallenge,
	signOut,
	verifySignInSignature,
} from "@/lib/auth/actions";
import { config } from "@/lib/wagmi";
import { readableError } from "@/lib/messages";

type Phase = "loading" | "idle" | "signing" | "error";

/**
 * F24. Did the person decline in their wallet, or did something break?
 *
 * EIP-1193 gives a rejection code 4001, and viem/wagmi surface it as
 * `UserRejectedRequestError` with that code on the error or its `cause`. Wallets
 * that report neither still say so in words, so the message is checked last.
 * Anything unrecognised is treated as a REAL failure: staying silent about a
 * genuine outage is the failure this replaces.
 */
export function isWalletRejection(error: unknown): boolean {
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (current !== null && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		const record = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
		if (record.code === 4001 || record.code === "ACTION_REJECTED") return true;
		if (record.name === "UserRejectedRequestError") return true;
		if (typeof record.message === "string" && /user rejected|user denied|rejected the request|request rejected|rejected by the user|denied by the user/i.test(record.message)) {
			return true;
		}
		current = record.cause;
	}
	return false;
}

/**
 * F23. The chip's network line was the FIXTURE string ("Base", from
 * `mock/data.ts` through `view-data.ts`), so it read "Base" whatever chain the
 * wallet was actually on — including none. It is now the connected wallet's own
 * chain, falling back to the configured chain when disconnected.
 *
 * The name comes from wagmi's own chain object; an unrecognised chain is named
 * by its id rather than by an invented label.
 */
function networkLabel(chain: { name?: string } | undefined, chainId: number | undefined): string | null {
	if (chainId === undefined) return null;
	return chain?.name ?? `Chain ${chainId}`;
}

/**
 * B-m3. Is a signed-in session now looking at a DIFFERENT connected account?
 *
 * A disconnected wallet is NOT a mismatch: the server session is still a real
 * session for the address that signed it, and the person may simply have closed
 * their wallet. Only a wallet that is connected AS SOMEBODY ELSE contradicts it.
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
 * B-m3. The header already dropped back to "Sign in" when the connected account
 * differed from the session, but the SERVER session stayed valid — so likes,
 * comments and follows kept acting as the old identity while the chip said
 * nobody was signed in. The two now agree: a mismatch signs the server session
 * out, and returning to the original account requires a fresh sign-in.
 *
 * TODO-OWNER: the owner may prefer to keep the old session alive and prompt
 * instead of signing out, or to sign out only when the person acts.
 *
 * `handled` is a ref, written BEFORE the await, so re-renders during the
 * in-flight action cannot fire a second sign-out. A FAILED sign-out clears the
 * ref again: the session really is still live, so a later render must retry
 * rather than pretend it was cleared. Nothing here sets state on failure, so
 * that retry cannot become a render loop.
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

export function WalletBar() {
	const { address, isConnected, chain, chainId } = useAccount();
	const { connect, connectors, isPending: connectPending } = useConnect();
	const { disconnect } = useDisconnect();
	const { signMessageAsync } = useSignMessage();

	const [session, setSession] = useState<SignInSessionSummary | null>(null);
	const [phase, setPhase] = useState<Phase>("loading");
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		readSignInSession()
			.then((value) => {
				if (cancelled) return;
				setSession(value);
				setPhase("idle");
			})
			.catch(() => {
				if (!cancelled) setPhase("idle");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const runSignIn = useCallback(async () => {
		if (!address) return;
		setPhase("signing");
		setMessage(null);
		try {
			const challenge = await requestSignInChallenge(address);
			const signature = await signMessageAsync({ message: challenge.message });
			const result = await verifySignInSignature({
				walletAddress: address,
				nonce: challenge.nonce,
				signature,
			});
			if (!result.ok) {
				setPhase("error");
				// F18: the raw code (`challenge_invalid`, ...) used to reach the user.
				setMessage(readableError(result.reason));
				return;
			}
			setSession(result.session);
			setPhase("idle");
		} catch (error) {
			// F24. A rejected signature IS a cancellation (PRD 13) and stays
			// silent. Everything else — the challenge request failing, the network
			// being down, the verification action throwing — used to be swallowed
			// as one too, so a real outage looked exactly like the user changing
			// their mind and the button simply went quiet.
			if (isWalletRejection(error)) {
				setPhase("idle");
				setMessage(null);
				return;
			}
			setPhase("error");
			setMessage(readableError("sign_in_failed"));
		}
	}, [address, signMessageAsync]);

	const runSignOut = useCallback(async () => {
		await signOut();
		setSession(null);
	}, []);

	// The session belongs to one address. If the wallet is now on a different
	// account, the header must not keep showing the old identity — it drops back
	// to the sign-in control so the connected account can sign for itself, AND
	// the server session is signed out so the actions agree with the header.
	const mismatched = accountMismatch(session?.walletAddress ?? null, isConnected, address);
	const signedOutFor = useRef<string | null>(null);
	useEffect(() => {
		void syncSessionToAccount({
			mismatched,
			address,
			handled: signedOutFor,
			signOut,
			onSignedOut: () => setSession(null),
		});
	}, [mismatched, address]);

	if (phase === "loading") return <span className="wallet mut">…</span>;

	const sessionMatchesAccount = session !== null && !mismatched;

	if (session !== null && sessionMatchesAccount) {
  return <details className="wallet-menu"><summary className="wallet"><Avatar seed={session.walletAddress.toLowerCase()} initials={session.truncatedAddress.slice(2, 4).toUpperCase()} size={26} /><span className="dot" aria-hidden="true" /><span className="num">{session.truncatedAddress}</span></summary><div className="card pad"><span className="mut">{networkLabel(chain, chainId) ?? config.chains[0].name}</span>{/* TODO-OWNER: profile and reconnect menu labels. */}<Link className="btn sec" href={`/u/${session.walletAddress.toLowerCase()}`}>Profile</Link>{!isConnected ? connectors.map(c => <button type="button" key={c.uid} className="btn sec" disabled={connectPending} onClick={() => connect({ connector: c })}>Connect {c.name}</button>) : null}<button type="button" className="btn sec" onClick={runSignOut}>Sign out</button></div></details>;
 }
 if (!isConnected || !address) {
  return <details className="wallet-menu"><summary className="btn out">Sign in</summary><div className="card pad stack">{connectors.map(c => <button type="button" key={c.uid} className="btn sec" disabled={connectPending} onClick={() => connect({ connector: c })}>{c.name}</button>)}{connectors.length === 0 ? <span className="mut">no connector</span> : null}</div></details>;
 }
 return <span className="wallet-actions"><button type="button" className="btn out" disabled={phase === "signing"} onClick={runSignIn}>{phase === "signing" ? "Signing…" : "Sign in"}</button><details className="wallet-menu"><summary className="btn sec" aria-label="Wallet options">…</summary><div className="card pad"><button type="button" className="btn sec" onClick={() => disconnect()}>Disconnect</button></div></details>{message !== null ? <span className="mut" role="status">{message}</span> : null}</span>;
}
