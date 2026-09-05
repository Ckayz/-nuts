"use client";

/**
 * Header wallet control: connect, then sign in, then show the truncated address.
 *
 * Never signs without a click (PRD 8.1 step 5 is a user action). The session is
 * read through a server action on mount rather than in a Server Component so the
 * layout does not call `cookies()` — that would make every route dynamic and
 * change the build output of pages this round is not meant to touch.
 *
 * TODO-OWNER: the mockup's header (docs/mockups/thesis-fun-mockup.html, the
 * `.hdr .r` block) has only the connected `0x7c4a…e10b` chip — it specifies no
 * connect, sign-in, or sign-out control. Every label below is a placeholder.
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import type { SignInSessionSummary } from "@/lib/auth/address";
import {
	readSignInSession,
	requestSignInChallenge,
	signOut,
	verifySignInSignature,
} from "@/lib/auth/actions";

type Phase = "loading" | "idle" | "signing" | "error";

export function WalletBar({ network }: { network: string }) {
	const { address, isConnected } = useAccount();
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
				setMessage(result.reason);
				return;
			}
			setSession(result.session);
			setPhase("idle");
		} catch {
			// A rejected signature is a cancellation, not a failure (PRD 13).
			setPhase("idle");
			setMessage(null);
		}
	}, [address, signMessageAsync]);

	const runSignOut = useCallback(async () => {
		await signOut();
		setSession(null);
	}, []);

	if (phase === "loading") return <span className="wallet dim">…</span>;

	// The session belongs to one address. If the wallet is now on a different
	// account, the header must not keep showing the old identity — it drops back
	// to the sign-in control so the connected account can sign for itself. A
	// disconnected wallet is not a mismatch: the server session is still real.
	const sessionMatchesAccount =
		session !== null &&
		(!isConnected || !address || address.toLowerCase() === session.walletAddress.toLowerCase());

	if (session !== null && sessionMatchesAccount) {
		return (
			<span className="wallet">
				<span className="dot" />
				{session.truncatedAddress}
				<span className="dim">{network}</span>
				<button type="button" className="acts" onClick={runSignOut}>
					Sign out
				</button>
			</span>
		);
	}

	if (!isConnected || !address) {
		const connector = connectors[0];
		return (
			<span className="wallet">
				{connectors.map((c) => (
					<button
						type="button"
						key={c.uid}
						className="acts"
						disabled={connectPending}
						onClick={() => connect({ connector: c })}
					>
						{c.name}
					</button>
				))}
				{connector === undefined ? <span className="dim">no connector</span> : null}
			</span>
		);
	}

	return (
		<span className="wallet">
			<span className="dot" />
			<button
				type="button"
				className="acts"
				disabled={phase === "signing"}
				onClick={runSignIn}
			>
				{phase === "signing" ? "Signing…" : "Sign in"}
			</button>
			<button type="button" className="acts dim" onClick={() => disconnect()}>
				Disconnect
			</button>
			{message !== null ? <span className="dim">{message}</span> : null}
		</span>
	);
}
