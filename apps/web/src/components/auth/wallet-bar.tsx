"use client";

/**
 * Header wallet control: connect, then sign in, then show the truncated address.
 *
 * Never signs without a click (PRD 8.1 step 5 is a user action). The session is
 * read through a server action on mount rather than in a Server Component so the
 * layout does not call `cookies()` — that would make every route dynamic and
 * change the build output of pages this round is not meant to touch.
 *
 * TODO-OWNER: every label here is placeholder copy; the mockup specifies only
 * the chip's resting state and the "Connect wallet" primary.
 */

import "@/styles/thread.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useConnect, useConnection, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import type { Connector } from "wagmi";

import { Avatar, TodoOwner } from "@/components/primitives";
import type { SignInSessionSummary } from "@/lib/auth/address";
import {
	readSignInSession,
	requestSignInChallenge,
	signOut,
	verifySignInSignature,
} from "@/lib/auth/actions";
import { readableError } from "@/lib/messages";
import { config } from "@/lib/wagmi";
import { ConnectDialog } from "./connect-dialog";

type Phase = "loading" | "idle" | "signing";

const BASE_CHAIN = config.chains[0];

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
		if (
			typeof record.message === "string" &&
			/user rejected|user denied|rejected the request|request rejected|rejected by the user|denied by the user/i.test(
				record.message,
			)
		) {
			return true;
		}
		current = record.cause;
	}
	return false;
}

/**
 * F23. The chip's network line was the FIXTURE string ("Base"), so it read
 * "Base" whatever chain the wallet was on — including none. It is now the
 * connected wallet's own chain id, named from the configured chain when it
 * matches and by its number when it does not, rather than by an invented label.
 */
export function networkLabel(chainId: number | undefined): string | null {
	if (chainId === undefined) return null;
	return chainId === BASE_CHAIN.id ? BASE_CHAIN.name : `Chain ${chainId}`;
}

/** A connect attempt that failed for a reason worth showing. */
function connectMessage(error: unknown): string | null {
	if (error === null || error === undefined) return null;
	// Declining the wallet's own prompt is a decision, not a fault (PRD 13).
	if (isWalletRejection(error)) return null;
	const name = (error as { name?: unknown }).name;
	if (name === "ProviderNotFoundError") {
		return "That wallet is not available in this browser. Install it, or pick another.";
	}
	return readableError("sign_in_failed");
}

export function WalletBar() {
	const router = useRouter();
	const { address, isConnected, chainId } = useConnection();
	const { connect, connectors, isPending: connectPending, error: connectError } = useConnect();
	const { disconnect } = useDisconnect();
	const { switchChain } = useSwitchChain();
	const { signMessageAsync } = useSignMessage();

	const [session, setSession] = useState<SignInSessionSummary | null>(null);
	const [phase, setPhase] = useState<Phase>("loading");
	const [message, setMessage] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);

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

	// The picker closes itself once a connection lands, so the user is not left
	// staring at a wallet list behind their own wallet's prompt.
	useEffect(() => {
		if (isConnected) setPicking(false);
	}, [isConnected]);

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
				setPhase("idle");
				// F18: the raw code (`challenge_invalid`, ...) used to reach the user.
				setMessage(readableError(result.reason));
				return;
			}
			setSession(result.session);
			setPhase("idle");
			// Without this the chip flips to "signed in" while every server-rendered
			// page still says otherwise: `signedIn` is computed on the server and
			// gates Like, Follow and the comment box, so the whole flow completed and
			// the app still told the user to sign in.
			router.refresh();
		} catch (error) {
			// A rejected signature IS a cancellation (PRD 13) and stays silent.
			// Everything else — the challenge request failing, the network being
			// down, verification throwing — is a real failure and says so.
			if (isWalletRejection(error)) {
				setPhase("idle");
				setMessage(null);
				return;
			}
			setPhase("idle");
			setMessage(readableError("sign_in_failed"));
		}
	}, [address, router, signMessageAsync]);

	const runSignOut = useCallback(async () => {
		await signOut();
		setSession(null);
		setMessage(null);
		router.refresh();
	}, [router]);

	const choose = useCallback(
		(connector: Connector) => {
			connect({ connector });
		},
		[connect],
	);

	const picker = picking ? (
		<ConnectDialog
			connectors={connectors}
			pending={connectPending}
			error={connectMessage(connectError)}
			onSelect={choose}
			onClose={() => setPicking(false)}
		/>
	) : null;

	// Reserve the chip's own footprint before the session is known, so the header
	// does not jump when it resolves. `.wallet` is the tallest of the states.
	if (phase === "loading") {
		return <span className="wallet mut" aria-hidden="true" />;
	}

	// The session belongs to one address. If the wallet is now on a different
	// account, the header must not keep showing the old identity — it drops back
	// to the sign-in control so the connected account can sign for itself. A
	// disconnected wallet is not a mismatch: the server session is still real.
	const mismatched =
		session !== null && isConnected && Boolean(address) &&
		address?.toLowerCase() !== session.walletAddress.toLowerCase();

	const wrongChain = isConnected && chainId !== undefined && chainId !== BASE_CHAIN.id;

	if (session !== null && !mismatched) {
		return (
			<>
				<details className="wallet-menu">
					<summary className="wallet" aria-label={`Wallet menu for ${session.truncatedAddress}`}>
						<Avatar
							seed={session.walletAddress.toLowerCase()}
							initials={session.truncatedAddress.slice(2, 4).toUpperCase()}
							size={26}
						/>
						<span
							className={wrongChain ? "dot warn" : isConnected ? "dot" : "dot off"}
							aria-hidden="true"
						/>
						<span className="num">{session.truncatedAddress}</span>
					</summary>

					<div className="card pad stack">
						<span className="mut">{networkLabel(chainId) ?? BASE_CHAIN.name}</span>

						{wrongChain ? (
							<button type="button" className="btn acc" onClick={() => switchChain({ chainId: BASE_CHAIN.id })}>
								Switch to {BASE_CHAIN.name}
							</button>
						) : null}

						{/* TODO-OWNER: profile and reconnect menu labels. */}
						<Link className="btn sec" href={`/u/${session.walletAddress.toLowerCase()}`}>
							Profile
						</Link>

						{isConnected ? null : (
							<button type="button" className="btn sec" onClick={() => setPicking(true)}>
								Connect wallet
							</button>
						)}

						<button type="button" className="btn sec" onClick={runSignOut}>
							Sign out
						</button>

						{message === null ? null : (
							<span className="fine" role="status">
								{message}
							</span>
						)}
					</div>
				</details>
				{picker}
			</>
		);
	}

	// Not connected at all: the mockup's primary. One button, one job.
	if (!isConnected || !address) {
		return (
			<>
				<button type="button" className="btn acc" onClick={() => setPicking(true)}>
					Connect wallet
				</button>
				{picker}
			</>
		);
	}

	// Connected, but this address has no session — or the session belongs to a
	// different address and the user must sign for the one they are now on.
	return (
		<>
			<span className="wallet-actions">
				<button type="button" className="btn acc" disabled={phase === "signing"} onClick={runSignIn}>
					{phase === "signing" ? "Signing…" : "Sign in"}
				</button>

				<details className="wallet-menu">
					<summary className="btn sec" aria-label="Wallet options">
						···
					</summary>
					<div className="card pad stack">
						<span className="mut">{networkLabel(chainId) ?? BASE_CHAIN.name}</span>

						{wrongChain ? (
							<button type="button" className="btn acc" onClick={() => switchChain({ chainId: BASE_CHAIN.id })}>
								Switch to {BASE_CHAIN.name}
							</button>
						) : null}

						{mismatched ? (
							<span className="fine">
								Your wallet is on a different account than the one signed in. Sign in again to use
								it. <TodoOwner />
							</span>
						) : null}

						<button type="button" className="btn sec" onClick={() => disconnect()}>
							Disconnect
						</button>

						{message === null ? null : (
							<span className="fine" role="status">
								{message}
							</span>
						)}
					</div>
				</details>
			</span>
			{picker}
		</>
	);
}
