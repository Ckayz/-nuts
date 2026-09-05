"use client";
import { useCallback, useRef, useState, useTransition } from "react";
import { useChainId, useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { TodoOwner } from "@/components/primitives";
import { signedUsd, usd, usd2 } from "@/lib/format";
import type { Side, Ticket } from "@/lib/display-types";
import { prepareTrade, quoteTicket, recordTrade } from "@/lib/trade/actions";
import { FillDialog } from "@/components/market/fill-dialog";
import type { FillCard, TicketQuoteView, TradePanelContext } from "@/lib/trade/types";

/**
 * The Bull/Bear ticket. Owner 2026-09-05: trading lives on the market page, so
 * this panel is rendered there and never inside a post.
 *
 * Without `trade` it renders exactly what it always did: the mockup's static
 * panel over fixture data, with an inert button. With `trade` it is wired to the
 * live book and the connected wallet — the server quotes, the server builds the
 * calldata, and the wallet signs. The app never holds a key and never sends a
 * transaction itself.
 */
export type TicketPhase =
	| "idle"
	| "quoting"
	| "preparing"
	| "approving"
	| "filling"
	| "recording"
	| "confirmed"
	| "failed";

const PHASE_LABEL: Record<TicketPhase, string> = {
	idle: "Sign with wallet",
	quoting: "Quoting…",
	preparing: "Checking the order…",
	approving: "Approving…",
	filling: "Confirm in your wallet…",
	recording: "Waiting for the fill…",
	confirmed: "Filled",
	failed: "Sign with wallet",
};

export function TakeASide({
	ticket,
	structureLabel,
	expiryLabel,
	trade,
	onSignedIn,
}: {
	ticket: Ticket;
	/** The structure being quoted, e.g. "BTC put spread 78,000 / 74,000 P". */
	structureLabel: string;
	expiryLabel: string;
	/** Live wiring. Absent in `DATA_SOURCE=mock`, where the panel stays static. */
	trade?: TradePanelContext;
	onSignedIn?: () => void;
}) {
	const bullRef = useRef<HTMLButtonElement>(null);
	const bearRef = useRef<HTMLButtonElement>(null);
	const [side, setSide] = useState<Side>(trade?.quote.side ?? "bull");
	const [quote, setQuote] = useState<TicketQuoteView | null>(trade?.quote ?? null);
	const [budgetInput, setBudgetInput] = useState(trade?.quote.budgetInput ?? "");
	const [phase, setPhase] = useState<TicketPhase>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const [txHash, setTxHash] = useState<string | null>(null);
	// The post-fill share card (owner's fomo reference, 2026-09-05).
	const [card, setCard] = useState<FillCard | null>(null);
	const [pending, startTransition] = useTransition();

	const { address, isConnected } = useConnection();
	const chainId = useChainId();
	const { switchChain, isPending: switching } = useSwitchChain();
	const { mutateAsync: sendTransactionAsync } = useSendTransaction();

	const view = quote ?? null;
	const shown = trade === undefined ? ticket : (view?.ticket ?? ticket);
	const sideNote = trade === undefined ? ticket.sideNote : (view?.sideNote ?? ticket.sideNote);

	const requote = useCallback(
		(nextSide: Side, nextBudget: string) => {
			if (trade === undefined) return;
			setPhase("quoting");
			setMessage(null);
			startTransition(async () => {
				const next = await quoteTicket({
					structureId: trade.structureId,
					side: nextSide,
					budgetInput: nextBudget,
				});
				setQuote(next);
				setPhase("idle");
			});
		},
		[trade],
	);

	const chooseSide = useCallback(
		(next: Side) => {
			setSide(next);
			if (trade !== undefined) requote(next, budgetInput);
		},
		[budgetInput, requote, trade],
	);

	const sign = useCallback(() => {
		if (trade === undefined) return;
		setMessage(null);
		setTxHash(null);
		setCard(null);
		// Chain and wallet are checked before anything is prepared: no calldata is
		// requested for a wallet that is not the signed-in one, and none is sent
		// on another chain (PRD 13, "Wrong chain: block financial actions").
		if (chainId !== trade.chainId) {
			setMessage("Switch your wallet to Base to trade.");
			switchChain({ chainId: trade.chainId });
			return;
		}
		if (!isConnected || !address) {
			setMessage("Connect your wallet first.");
			return;
		}
		if (trade.sessionWallet === null) {
			setMessage("Sign in with your wallet before signing a trade.");
			onSignedIn?.();
			return;
		}
		if (address.toLowerCase() !== trade.sessionWallet) {
			setMessage("Your connected wallet is not the one you signed in with. Sign in again to trade with it.");
			onSignedIn?.();
			return;
		}

		startTransition(async () => {
			try {
				setPhase("preparing");
				const first = await prepareTrade({
					structureId: trade.structureId,
					side,
					budgetInput,
					thesisId: trade.thesis?.id ?? null,
				});
				if (!first.ok) {
					setPhase("failed");
					setMessage(first.reason);
					if (first.needsSignIn) onSignedIn?.();
					return;
				}
				let ready = first;
				if (ready.stage === "approve") {
					setPhase("approving");
					setMessage(ready.note);
					await sendTransactionAsync({
						to: ready.approve.to,
						data: ready.approve.data,
						value: 0n,
					});
					// The allowance must be on chain before the fill is built and
					// simulated, so the order is refetched after the approval.
					setPhase("preparing");
					const second = await prepareTrade({
						structureId: trade.structureId,
						side,
						budgetInput,
						thesisId: trade.thesis?.id ?? null,
					});
					if (!second.ok) {
						setPhase("failed");
						setMessage(second.reason);
						return;
					}
					if (second.stage !== "fill") {
						setPhase("failed");
						setMessage("The approval has not landed yet. Try again in a moment.");
						return;
					}
					ready = second;
				}
				if (ready.stage !== "fill") {
					setPhase("failed");
					setMessage("Could not build this fill.");
					return;
				}
				setPhase("filling");
				setMessage(ready.note);
				const hash = await sendTransactionAsync({
					to: ready.fill.to,
					data: ready.fill.data,
					value: 0n,
				});
				setTxHash(hash);
				setPhase("recording");
				const recorded = await recordTrade({ token: ready.token, txHash: hash });
				if (!recorded.ok) {
					setPhase("failed");
					setMessage(recorded.reason);
					return;
				}
				if (recorded.status === "failed") {
					setPhase("failed");
					setMessage("The fill reverted on Base. Nothing was published and nothing was counted.");
					return;
				}
				setPhase("confirmed");
				setMessage("Your fill is on chain and public.");
				setCard(recorded.card);
			} catch (error) {
				// A rejected signature is a cancellation, not a failure (PRD 13).
				setPhase("idle");
				setMessage(error instanceof Error ? error.message.split("\n")[0] ?? null : null);
			}
		});
	}, [address, budgetInput, chainId, isConnected, onSignedIn, sendTransactionAsync, side, switchChain, trade]);

	const bull = trade?.sides.bull;
	const bear = trade?.sides.bear;
	const busy = pending || phase === "approving" || phase === "filling" || phase === "recording";
	const blocked = trade !== undefined && (view === null || !view.executable);

	return (
		<div className="panel">
			<h3>Take a side</h3>
			<span className="note">
				{structureLabel} · expires <b className="mono">{expiryLabel}</b>
			</span>
			<div
				className="seg"
				role="radiogroup"
				aria-label="Take a side"
				onKeyDown={(event) => {
					if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
					event.preventDefault();
					const next = event.key === "Home" ? "bull" : event.key === "End" ? "bear" : side === "bull" ? "bear" : "bull";
					chooseSide(next);
					(next === "bull" ? bullRef : bearRef).current?.focus();
				}}
			>
				<button
					type="button"
					className="bull"
					role="radio"
					aria-checked={side === "bull"}
					ref={bullRef}
					tabIndex={side === "bull" ? 0 : -1}
					disabled={bull !== undefined && !bull.available}
					onClick={() => chooseSide("bull")}
				>
					Bull · buy it
				</button>
				<button
					type="button"
					className="bear"
					role="radio"
					aria-checked={side === "bear"}
					ref={bearRef}
					tabIndex={side === "bear" ? 0 : -1}
					disabled={bear !== undefined && !bear.available}
					onClick={() => chooseSide("bear")}
				>
					Bear · sell it
				</button>
			</div>
			<span className="note">{sideNote}</span>
			{bull !== undefined && !bull.available && bull.reason !== null ? (
				<span className="note">Bull: {bull.reason}</span>
			) : null}
			{bear !== undefined && !bear.available && bear.reason !== null ? (
				<span className="note">Bear: {bear.reason}</span>
			) : null}
			<div className="field">
				<span className="lbl">Your max loss</span>
				<div className="inp">
					<span>$</span>
					{trade === undefined ? (
						<span>{shown.maxLossUsd.raw}</span>
					) : (
						<input
							value={budgetInput}
							inputMode="decimal"
							aria-label={`Amount in ${shown.collateralSymbol}`}
							onChange={(event) => setBudgetInput(event.target.value)}
							onBlur={() => requote(side, budgetInput)}
						/>
					)}
					<span className="u">{shown.collateralSymbol}</span>
				</div>
				<div className="presets">
					{shown.presetsUsd.map((v) => (
						<button
							type="button"
							key={v.raw}
							onClick={
								trade === undefined
									? undefined
									: () => {
											setBudgetInput(v.raw);
											requote(side, v.raw);
										}
							}
						>
							{usd(v)}
						</button>
					))}
				</div>
				<span className="note">
					Preset values <TodoOwner />
				</span>
			</div>
			<dl className="kv">
				<dt>Order</dt>
				<dd>{shown.orderLabel}</dd>
				<dt>Contracts</dt>
				<dd>{shown.contracts}</dd>
				<dt>Max loss</dt>
				<dd className="bear">{usd2(shown.maxLossUsd)}</dd>
				<dt>Max payout</dt>
				<dd className="big bull">{signedUsd(shown.maxPayoutUsd)}</dd>
				<dt>Break-even</dt>
				<dd>{usd(shown.breakEvenUsd)}</dd>
				<dt>Liquidity left</dt>
				<dd>{usd(shown.liquidityLeftUsd)}</dd>
			</dl>
			<button
				type="button"
				className="btn primary block"
				disabled={trade !== undefined && (busy || blocked || switching)}
				onClick={trade === undefined ? undefined : sign}
			>
				{trade === undefined ? "Sign with wallet" : PHASE_LABEL[phase]}
			</button>
			<span className="note">
				Approve USDC once, then one fill on Base. Your fill is public the moment it confirms.
			</span>
			{trade !== undefined && view !== null && !view.executable && view.reason !== null ? (
				<span className="note">{view.reason}</span>
			) : null}
			{trade !== undefined && view !== null && view.signatureExpiresAt !== null ? (
				<span className="note">
					Maker signature valid until <b className="mono">{view.signatureExpiresAt}</b>. It is refetched when
					you sign. <TodoOwner />
				</span>
			) : null}
			{message !== null ? <span className="note">{message}</span> : null}
			{card !== null && trade !== undefined && txHash !== null ? (
				<FillDialog
					card={card}
					txHref={`${trade.explorerTxBase}${txHash}`}
					txLabel={`${txHash.slice(0, 8)}…${txHash.slice(-6)} ↗`}
					onClose={() => setCard(null)}
				/>
			) : null}
			{txHash !== null && trade !== undefined ? (
				<a className="tx" href={`${trade.explorerTxBase}${txHash}`} rel="noreferrer" target="_blank">
					{txHash.slice(0, 8)}…{txHash.slice(-6)} ↗
				</a>
			) : null}
			{trade !== undefined && trade.thesis !== null ? (
				<span className="note">On {trade.thesis.headline}</span>
			) : null}
		</div>
	);
}
