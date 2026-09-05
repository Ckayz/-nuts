"use client";

import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";

import { Button } from "@nuts/ui/components/button";

/**
 * The wallet hand-off (PRD 8.6 steps 8-9).
 *
 * The server prepared unsigned calldata; this sends it from the user's own
 * wallet. Two transactions in order: an exact ERC-20 approval when the existing
 * allowance is short, then the fill. Each is a separate wallet confirmation.
 *
 * The signature deadline is enforced here as well as on the server. A user can
 * leave a prepared trade on screen for minutes, and maker signatures last around
 * a minute, so the button refuses rather than sending a transaction that will
 * revert and cost gas for nothing.
 *
 * TODO: EIP-5792 `useSendCalls` would batch the approval and the fill into one
 * wallet confirmation on smart wallets. It needs a capability check and a
 * sequential fallback for wallets without it, so it is deliberately not in this
 * round: two reliable confirmations beat one that silently fails on some wallets.
 */

export interface PreparedTrade {
	readonly label?: string;
	readonly account?: string;
	readonly transactions: {
		readonly approve?: { readonly to: string; readonly data: string };
		readonly fill: { readonly to: string; readonly data: string };
	};
	readonly expected: {
		readonly premium?: { readonly amount: string; readonly token: string } | null;
		readonly contracts?: string | null;
		readonly maxLossUsd?: string | null;
		readonly cappedByOrderSize?: boolean;
		readonly requestedBudget?: { readonly amount: string; readonly token: string } | null;
	};
	readonly signatureExpiresAt?: string;
}

type Phase = "idle" | "approving" | "filling" | "done" | "expired" | "error";

export function TradeExecution({ trade }: { trade: PreparedTrade }) {
	const { address, chainId } = useAccount();
	const { switchChainAsync } = useSwitchChain();
	const { sendTransactionAsync } = useSendTransaction();

	const [phase, setPhase] = useState<Phase>("idle");
	const [hash, setHash] = useState<`0x${string}` | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	// "Sent" is not "done". The PRD forbids reporting a position before the chain
	// confirms it, so the BaseScan link appears on broadcast but the success line
	// waits for the receipt.
	const receipt = useWaitForTransactionReceipt({ hash: hash ?? undefined });

	const expiresAt = trade.signatureExpiresAt ? Date.parse(trade.signatureExpiresAt) : null;
	const expired = expiresAt !== null && expiresAt <= Date.now();
	const busy = phase === "approving" || phase === "filling";

	const premium = trade.expected.premium;
	const capped = trade.expected.cappedByOrderSize === true;

	async function send() {
		setMessage(null);

		if (expiresAt !== null && expiresAt <= Date.now()) {
			setPhase("expired");
			setMessage("This quote expired before it was signed. Ask the agent for a fresh one.");
			return;
		}
		// The prepared calldata is bound to one account: the server used it to read the
		// allowance. Sending from a different wallet would approve the wrong balance.
		if (trade.account && address && trade.account.toLowerCase() !== address.toLowerCase()) {
			setPhase("error");
			setMessage("Your connected wallet changed since this was prepared. Ask for a fresh quote.");
			return;
		}

		try {
			if (chainId !== base.id) await switchChainAsync({ chainId: base.id });

			if (trade.transactions.approve) {
				setPhase("approving");
				await sendTransactionAsync({
					to: trade.transactions.approve.to as `0x${string}`,
					data: trade.transactions.approve.data as `0x${string}`,
					value: 0n,
				});
			}

			setPhase("filling");
			const fillHash = await sendTransactionAsync({
				to: trade.transactions.fill.to as `0x${string}`,
				data: trade.transactions.fill.data as `0x${string}`,
				value: 0n,
			});

			setHash(fillHash);
			setPhase("done");
		} catch (error) {
			setPhase("error");
			const text = error instanceof Error ? error.message : "Transaction failed.";
			// Wallet rejections are a normal outcome, not a failure to report loudly.
			setMessage(/rejected|denied|User denied/i.test(text) ? "You cancelled the transaction." : text);
		}
	}

	return (
		<div className="rounded-lg border p-4">
			<p className="font-medium text-sm">{trade.label ?? "Prepared trade"}</p>

			<dl className="mt-3 space-y-1 text-sm">
				{premium && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">You pay</dt>
						<dd className="font-mono">
							{premium.amount} {premium.token}
						</dd>
					</div>
				)}
				{trade.expected.maxLossUsd && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Most you can lose</dt>
						<dd className="font-mono">${trade.expected.maxLossUsd}</dd>
					</div>
				)}
				{trade.expected.contracts && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Contracts</dt>
						<dd className="font-mono">{trade.expected.contracts}</dd>
					</div>
				)}
			</dl>

			{capped && trade.expected.requestedBudget && (
				<p className="mt-3 text-amber-600 text-xs dark:text-amber-500">
					This order could not absorb the full {trade.expected.requestedBudget.amount}{" "}
					{trade.expected.requestedBudget.token} you asked for. Only the amount above will be
					spent.
				</p>
			)}

			{trade.transactions.approve && (
				<p className="mt-3 text-muted-foreground text-xs">
					Two confirmations: first an exact spending approval, then the trade itself.
				</p>
			)}

			{phase === "done" && hash ? (
				<div className="mt-4">
					<p className="text-sm">
						{receipt.isLoading
							? "Sent. Waiting for the chain to confirm…"
							: receipt.data?.status === "success"
								? "Confirmed on Base."
								: receipt.data?.status === "reverted"
									? "The transaction reverted. Nothing was bought; ask the agent for a fresh quote."
									: "Sent."}
					</p>
					<a
						className="text-sm underline underline-offset-4"
						href={`https://basescan.org/tx/${hash}`}
						target="_blank"
						rel="noreferrer"
					>
						View on BaseScan
					</a>
				</div>
			) : (
				<div className="mt-4 flex items-center gap-3">
					<Button size="sm" onClick={send} disabled={busy || expired || !address}>
						{phase === "approving"
							? "Confirm approval…"
							: phase === "filling"
								? "Confirm trade…"
								: expired
									? "Quote expired"
									: "Sign in wallet"}
					</Button>
					{!address && <span className="text-muted-foreground text-xs">Connect a wallet first.</span>}
				</div>
			)}

			{message && <p className="mt-2 text-destructive text-xs">{message}</p>}
		</div>
	);
}
