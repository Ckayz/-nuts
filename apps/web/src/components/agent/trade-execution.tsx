"use client";

import { useCallback, useState } from "react";
import { useConfig, useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@nuts/ui/components/button";
import { prepareTrade, recordTrade } from "@/lib/trade/actions";
import { sameEconomics, sendGuard } from "@/components/market/take-a-side";
import type { QuoteRaw } from "@/lib/trade/types";

/**
 * The wallet hand-off for an agent-prepared trade (PRD 8.6 steps 8-9).
 *
 * The server prepared unsigned calldata; this sends it from the user's own
 * wallet. The AI never signs.
 *
 * FOLD (money path). This component used to send both transactions from one
 * server call and then stop: the approval was not awaited to a receipt before
 * the fill was built, neither send asserted the chain or the account, and the
 * fill receipt was never recorded — the money left the wallet and no position
 * row ever existed. It now drives exactly the same three server actions as the
 * market ticket (`prepareTrade` -> wallet -> `recordTrade`), so an agent fill
 * and a market-page fill are checked by one implementation:
 *
 *   C4 `chainId` and `account` pinned on every send; the approval awaited to a
 *      MINED receipt before the fill is prepared, so the fill is never built
 *      against an allowance that is not on chain yet.
 *   C5 the economics the server is about to have signed are compared with the
 *      ones this card displayed; any difference stops and asks again.
 *   C6 the fill hash is kept once it exists, and the button never re-sends
 *      while one is held — a failed recording offers a retry, never a second
 *      fill.
 *
 * TODO: EIP-5792 `useSendCalls` would batch the approval and the fill into one
 * wallet confirmation on smart wallets. It needs a capability check and a
 * sequential fallback for wallets without it, so it is deliberately not in this
 * round: two reliable confirmations beat one that silently fails on some wallets.
 */

export interface PreparedTrade {
	readonly label?: string;
	readonly account?: string;
	readonly chainId?: 8453;
	/** What the shared server path needs to re-prepare after the approval lands. */
	readonly structureId: string;
	readonly side: "bull" | "bear";
	readonly budgetInput: string;
	readonly thesisId: string | null;
	readonly stage: "approve" | "fill";
	readonly transactions: {
		readonly approve?: { readonly to: string; readonly data: string };
		readonly fill?: { readonly to: string; readonly data: string };
	};
	/** Present only when the server already reached the fill stage. */
	readonly token?: string;
	readonly expected?: QuoteRaw;
	readonly preview: {
		readonly premium?: { readonly amount: string; readonly token: string } | null;
		readonly contracts?: string | null;
		readonly maxLossUsd?: string | null;
		readonly cappedByOrderSize?: boolean;
		readonly requestedBudget?: { readonly amount: string; readonly token: string } | null;
	};
	readonly signatureExpiresAt?: string;
}

type Phase = "idle" | "approving" | "preparing" | "filling" | "recording" | "done" | "expired" | "error";

/** Base mainnet. The app is Base-only (`lib/wagmi.ts`), so this is a constant, not a choice. */
const BASE_CHAIN_ID = 8453 as const;

export function TradeExecution({ trade }: { trade: PreparedTrade }) {
	const { address, isConnected, chainId: walletChainId } = useConnection();
	const { switchChain } = useSwitchChain();
	const { mutateAsync: sendTransactionAsync } = useSendTransaction();
	const config = useConfig();

	const [phase, setPhase] = useState<Phase>("idle");
	const [hash, setHash] = useState<`0x${string}` | null>(null);
	const [positionPath, setPositionPath] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	/** C5: the economics the user has been shown and clicked through. */
	const [acknowledged, setAcknowledged] = useState<QuoteRaw | null>(null);

	const expiresAt = trade.signatureExpiresAt ? Date.parse(trade.signatureExpiresAt) : null;
	const expired = expiresAt !== null && expiresAt <= Date.now();
	const busy = phase === "approving" || phase === "preparing" || phase === "filling" || phase === "recording";

	const premium = trade.preview.premium;
	const capped = trade.preview.cappedByOrderSize === true;
	const expectedChainId = trade.chainId ?? BASE_CHAIN_ID;

	const send = useCallback(async () => {
		setMessage(null);

		if (expiresAt !== null && expiresAt <= Date.now()) {
			setPhase("expired");
			setMessage("This quote expired before it was signed. Ask the agent for a fresh one.");
			return;
		}
		// C6. A hash already exists: the fill happened. Never send a second one.
		if (hash !== null) {
			setPhase("recording");
			const again = await recordTrade({ token: trade.token ?? "", txHash: hash });
			if (!again.ok) {
				setPhase("error");
				setMessage(again.reason);
				return;
			}
			setPositionPath(`/p/${again.positionId}`);
			setPhase("done");
			return;
		}
		// The prepared calldata is bound to one account: the server read the
		// allowance with it. Sending from a different wallet would approve the
		// wrong balance.
		if (trade.account && address && trade.account.toLowerCase() !== address.toLowerCase()) {
			setPhase("error");
			setMessage("Your connected wallet changed since this was prepared. Ask for a fresh quote.");
			return;
		}

		// F14/C4: the CONNECTED wallet's chain, and the whole precondition ladder
		// the market ticket uses. `sessionWallet` is the account the server bound
		// the ticket to, which is this same connected address.
		const guard = sendGuard({
			isConnected,
			address,
			walletChainId,
			expectedChainId,
			sessionWallet: trade.account?.toLowerCase() ?? address?.toLowerCase() ?? null,
		});
		if (!guard.ok) {
			setPhase("error");
			setMessage(guard.message);
			if (guard.action === "switch") switchChain({ chainId: expectedChainId });
			return;
		}
		const account = address as `0x${string}`;

		try {
			let ready:
				| { stage: "approve"; approve: { to: string; data: string } }
				| { stage: "fill"; fill: { to: string; data: string }; token: string; expected: QuoteRaw } =
				trade.stage === "approve" && trade.transactions.approve
					? { stage: "approve", approve: trade.transactions.approve }
					: {
							stage: "fill",
							fill: trade.transactions.fill ?? { to: "", data: "" },
							token: trade.token ?? "",
							expected: trade.expected as QuoteRaw,
						};

			if (ready.stage === "approve") {
				setPhase("approving");
				const approvalHash = await sendTransactionAsync({
					to: ready.approve.to as `0x${string}`,
					data: ready.approve.data as `0x${string}`,
					value: 0n,
					// C4: pinned on every send.
					chainId: expectedChainId,
					account,
				});
				// C4: the allowance must be ON CHAIN before the fill is built.
				const approvalReceipt = await waitForTransactionReceipt(config, {
					hash: approvalHash,
					chainId: expectedChainId,
				});
				if (approvalReceipt.status !== "success") {
					setPhase("error");
					setMessage("The approval did not succeed on Base, so nothing was filled.");
					return;
				}
				setPhase("preparing");
				const second = await prepareTrade({
					structureId: trade.structureId,
					side: trade.side,
					budgetInput: trade.budgetInput,
					thesisId: trade.thesisId,
				});
				if (!second.ok) {
					setPhase("error");
					setMessage(second.reason);
					return;
				}
				if (second.stage !== "fill") {
					setPhase("error");
					setMessage("The approval has not landed yet. Try again in a moment.");
					return;
				}
				ready = { stage: "fill", fill: second.fill, token: second.token, expected: second.expected };
			}

			// C5. Nothing is signed until the figures on this card are the figures
			// being signed for.
			const shown = acknowledged ?? trade.expected ?? null;
			if (!sameEconomics(ready.expected, shown)) {
				setAcknowledged(ready.expected);
				setPhase("idle");
				setMessage(
					"The price moved while this was prepared. The agent's figures are stale — ask it for a fresh quote, or press again to sign for the server's current ones.",
				);
				return;
			}

			setPhase("filling");
			const fillHash = await sendTransactionAsync({
				to: ready.fill.to as `0x${string}`,
				data: ready.fill.data as `0x${string}`,
				value: 0n,
				chainId: expectedChainId,
				account,
			});
			// C6: kept before anything else can fail, so the fill is never re-sent.
			setHash(fillHash);

			setPhase("recording");
			// THE one recording path — the same server action the market ticket
			// uses, so the receipt is bound to the prepared order by the same
			// fences (C1-C3).
			const recorded = await recordTrade({ token: ready.token, txHash: fillHash });
			if (!recorded.ok) {
				setPhase("error");
				setMessage(`${recorded.reason} The fill is on chain; press again to record it.`);
				return;
			}
			if (recorded.status === "failed") {
				setPhase("error");
				setMessage("The fill reverted on Base. Nothing was bought and nothing was counted.");
				return;
			}
			setPositionPath(`/p/${recorded.positionId}`);
			setPhase("done");
		} catch (error) {
			setPhase("error");
			const text = error instanceof Error ? error.message : "Transaction failed.";
			// Wallet rejections are a normal outcome, not a failure to report loudly.
			setMessage(/rejected|denied|User denied/i.test(text) ? "You cancelled the transaction." : text);
		}
	}, [
		acknowledged,
		address,
		config,
		expectedChainId,
		expiresAt,
		hash,
		isConnected,
		sendTransactionAsync,
		switchChain,
		trade,
		walletChainId,
	]);

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
				{trade.preview.maxLossUsd && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Most you can lose</dt>
						<dd className="font-mono">${trade.preview.maxLossUsd}</dd>
					</div>
				)}
				{trade.preview.contracts && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Contracts</dt>
						<dd className="font-mono">{trade.preview.contracts}</dd>
					</div>
				)}
			</dl>

			{capped && trade.preview.requestedBudget && (
				<p className="mt-3 text-amber-600 text-xs dark:text-amber-500">
					This order could not absorb the full {trade.preview.requestedBudget.amount}{" "}
					{trade.preview.requestedBudget.token} you asked for. Only the amount above will be spent.
				</p>
			)}

			{trade.stage === "approve" && (
				<p className="mt-3 text-muted-foreground text-xs">
					Two confirmations: first an exact spending approval, then the trade itself.
				</p>
			)}

			{phase === "done" && hash ? (
				<div className="mt-4">
					<p className="text-sm">Confirmed on Base and recorded.</p>
					<div className="flex gap-4">
						{positionPath && (
							<a className="text-sm underline underline-offset-4" href={positionPath}>
								Open the position
							</a>
						)}
						<a
							className="text-sm underline underline-offset-4"
							href={`https://basescan.org/tx/${hash}`}
							target="_blank"
							rel="noreferrer"
						>
							View on BaseScan
						</a>
					</div>
				</div>
			) : (
				<div className="mt-4 flex items-center gap-3">
					<Button size="sm" onClick={() => void send()} disabled={busy || expired || !address}>
						{phase === "approving"
							? "Confirm approval…"
							: phase === "preparing"
								? "Checking the order…"
								: phase === "filling"
									? "Confirm trade…"
									: phase === "recording"
										? "Waiting for the fill…"
										: expired
											? "Quote expired"
											: hash !== null
												? "Record the fill"
												: "Sign in wallet"}
					</Button>
					{!address && <span className="text-muted-foreground text-xs">Connect a wallet first.</span>}
				</div>
			)}

			{hash !== null && phase !== "done" && (
				<a
					className="mt-2 block text-sm underline underline-offset-4"
					href={`https://basescan.org/tx/${hash}`}
					target="_blank"
					rel="noreferrer"
				>
					View the sent transaction on BaseScan
				</a>
			)}

			{message && <p className="mt-2 text-destructive text-xs">{message}</p>}
		</div>
	);
}
