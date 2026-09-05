"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useConfig, useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { TodoOwner } from "@/components/primitives";
import { signedUsd, usd, usd2 } from "@/lib/format";
// F19: the ticket printed the raw ISO instant ("2026-09-05T10:47:58.000Z").
// `expiryLabel(iso, true)` is the app-wide instant format ("05 Sep 26 10:47
// UTC"); the payload keeps the ISO string. TODO-OWNER: the format itself.
import { expiryLabel as instantLabel } from "@/lib/display";
import type { Side, Ticket } from "@/lib/display-types";
import { prepareTrade, quoteTicket, recordTrade } from "@/lib/trade/actions";
import { FillDialog } from "@/components/market/fill-dialog";
import type { FillCard, QuoteRaw, TicketQuoteView, TradePanelContext } from "@/lib/trade/types";

/**
 * The Bull/Bear ticket. Owner 2026-09-05: trading lives on the market page, so
 * this panel is rendered there and never inside a post.
 *
 * Look from the mockup's `#market` "Take a side" card (lines 860-899): the
 * segmented side control filled with the one accent, a 58px amount field with
 * the preset chips under it, the six-row key/value list, and a big accent
 * "Trade" button with "Sign with wallet" as its secondary line.
 *
 * Behaviour is unchanged by the redesign. Without `trade` it renders the static
 * panel over fixture data with an inert button. With `trade` it is wired to the
 * live book and the connected wallet — the server quotes, the server builds the
 * calldata, and the wallet signs. The app never holds a key and never sends a
 * transaction itself. The side control is still a radiogroup with roving focus
 * and arrow keys (the mockup's `role="group"` + `aria-pressed` would announce
 * two independent toggles for what is one choice).
 */
/**
 * C5. The figures a wallet is asked to sign for must be the figures the panel
 * showed. Every field below decides what the user pays, receives or risks, so
 * ANY difference stops the send and asks again.
 *
 * TODO-OWNER: any tolerance at all. Exact equality is used because no allowed
 * drift has been decided; a tolerance is a product number, not this file's.
 */
const ECONOMIC_FIELDS = [
	"numContracts",
	"contractSizeDecimals",
	"pricePerContract",
	"premiumGross",
	"feeEstimate",
	"collateralPosted",
	"debit",
	"credit",
	"collateralDecimals",
	"collateralSymbol",
	"collateralAddress",
	"maxLossUsd8",
	"maxPayoutUsd8",
	"breakEvenUsd8",
] as const satisfies readonly (keyof QuoteRaw)[];

export function sameEconomics(a: QuoteRaw | null, b: QuoteRaw | null): boolean {
	if (a === null || b === null) return false;
	return ECONOMIC_FIELDS.every((field) => a[field] === b[field]);
}

/** The fields that actually moved, for the sentence shown to the user. */
export function changedEconomics(a: QuoteRaw | null, b: QuoteRaw | null): readonly string[] {
	if (a === null || b === null) return [];
	return ECONOMIC_FIELDS.filter((field) => a[field] !== b[field]);
}

/**
 * F14 / C4. Everything that must hold before a wallet is asked to sign.
 *
 * Pure so it can be tested: the component has no DOM test harness here, and the
 * bug this replaces was precisely a guard that could never fire.
 *
 * `walletChainId` is the CONNECTED wallet's chain. It used to be read from
 * `useChainId()`, which returns the CONFIG's chain — Base only in
 * `lib/wagmi.ts` — so the comparison was `8453 !== 8453` for every user and a
 * wallet on Ethereum went straight to `eth_sendTransaction`.
 */
/**
 * Has the panel's structure changed out from under the quote it is showing?
 *
 * The market table's "Select" is a link to `?structure=…`, so choosing another
 * structure is a CLIENT-SIDE navigation: this component keeps its state and only
 * its props change. A side click requotes (`chooseSide`) and so does the amount
 * blur, but a structure change requoted nothing — so the panel kept the previous
 * structure's order id, contracts, max loss and break-even under the NEW
 * structure's name. Measured on a db-mode production build 2026-09-05: still
 * wrong 26 s after the click, and it cleared only when the amount field was
 * touched. `staleQuote` did keep `Trade` disabled the whole time, so nothing
 * could be signed against the wrong figures — the panel simply said something
 * untrue about which trade it was describing.
 *
 * Pure so it can be tested without a DOM harness, like `sendGuard` above.
 * `quoted` is undefined only before the first structure exists, in which case
 * the arrival of one is itself a change worth quoting.
 */
export function structureChanged(quoted: string | undefined, current: string | undefined): boolean {
	if (current === undefined) return false;
	return quoted !== current;
}

export type SendGuard =
	| { readonly ok: true }
	| { readonly ok: false; readonly action: "connect" | "switch" | "signIn"; readonly message: string };

export function sendGuard(input: {
	readonly isConnected: boolean;
	readonly address: string | undefined;
	readonly walletChainId: number | undefined;
	readonly expectedChainId: number;
	readonly sessionWallet: string | null;
}): SendGuard {
	if (!input.isConnected || input.address === undefined) {
		return { ok: false, action: "connect", message: "Connect your wallet first." };
	}
	// An unknown wallet chain is treated as the wrong chain: fail closed.
	if (input.walletChainId !== input.expectedChainId) {
		return { ok: false, action: "switch", message: "Switch your wallet to Base to trade." };
	}
	if (input.sessionWallet === null) {
		return { ok: false, action: "signIn", message: "Sign in with your wallet before signing a trade." };
	}
	if (input.address.toLowerCase() !== input.sessionWallet) {
		return {
			ok: false,
			action: "signIn",
			message: "Your connected wallet is not the one you signed in with. Sign in again to trade with it.",
		};
	}
	return { ok: true };
}

export type TicketPhase =
	| "idle"
	| "quoting"
	| "preparing"
	| "approving"
	| "filling"
	| "recording"
	| "confirmed"
	| "failed";

/**
 * What the button says while the ticket is working. `idle` and `failed` are
 * absent on purpose: at rest the button reads "Trade" and the line under it
 * reads "Sign with wallet", exactly as the mockup has them.
 */
const PHASE_LABEL: Partial<Record<TicketPhase, string>> = {
	quoting: "Quoting…",
	preparing: "Checking the order…",
	approving: "Approving…",
	filling: "Confirm in your wallet…",
	recording: "Waiting for the fill…",
	confirmed: "Filled",
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
	/**
	 * C5. The economics the user has SEEN and clicked through. Null until a
	 * divergence has been shown once; after that, a send is only allowed when the
	 * server's fresh quote still equals this.
	 */
	const [acknowledged, setAcknowledged] = useState<QuoteRaw | null>(null);
	/**
	 * C5. Requotes are async and can land out of order (type "10", then "100":
	 * the "10" response may arrive last and overwrite the panel). Only the
	 * newest request may write state.
	 */
	const requoteSeq = useRef(0);
	/** C5. The state the current quote belongs to; a quote for another structure, side or budget is not this panel's. */
	const quotedFor = useRef<{ structureId: string; side: Side; budgetInput: string } | null>(
		trade === undefined ? null : { structureId: trade.structureId, side: trade.quote.side, budgetInput: trade.quote.budgetInput },
	);

	const config = useConfig();
	// F14. `useChainId()` returns the CONFIG's chain, and `lib/wagmi.ts`
	// configures Base alone, so it was ALWAYS 8453 and the wrong-chain guard
	// below could never fire — a wallet on Ethereum reached `eth_sendTransaction`
	// with no chain assertion. `useConnection().chainId` is the CONNECTED
	// wallet's chain (@wagmi/core `GetConnectionReturnType`), which is the thing
	// the guard is about.
	const { address, isConnected, chainId: walletChainId } = useConnection();
	const { switchChain, isPending: switching } = useSwitchChain();
	const { mutateAsync: sendTransactionAsync } = useSendTransaction();

	const view = quote ?? null;
	const shown = trade === undefined ? ticket : (view?.ticket ?? ticket);
	const sideNote = trade === undefined ? ticket.sideNote : (view?.sideNote ?? ticket.sideNote);

	const requote = useCallback(
		(nextSide: Side, nextBudget: string) => {
			if (trade === undefined) return;
			const seq = requoteSeq.current + 1;
			requoteSeq.current = seq;
			setPhase("quoting");
			setMessage(null);
			// C5. A new quote invalidates whatever the user had acknowledged.
			setAcknowledged(null);
			startTransition(async () => {
				const next = await quoteTicket({
					structureId: trade.structureId,
					side: nextSide,
					budgetInput: nextBudget,
				});
				// C5. Drop a response that a newer request has already superseded.
				if (requoteSeq.current !== seq) return;
				quotedFor.current = { structureId: trade.structureId, side: nextSide, budgetInput: nextBudget };
				setQuote(next);
				setPhase("idle");
			});
		},
		[trade],
	);

	/**
	 * F20. True while the amount field says something the panel has not been
	 * quoted for — the ticket requotes on blur, so until then every figure below
	 * belongs to the PREVIOUS amount. The panel says so instead of showing money
	 * that contradicts the input.
	 */
	const staleQuote =
		trade !== undefined &&
		quotedFor.current !== null &&
		(quotedFor.current.budgetInput !== budgetInput ||
			quotedFor.current.side !== side ||
			quotedFor.current.structureId !== trade.structureId);

	const chooseSide = useCallback(
		(next: Side) => {
			setSide(next);
			if (trade !== undefined) requote(next, budgetInput);
		},
		[budgetInput, requote, trade],
	);

	/**
	 * Requote when the structure changes, exactly as a side click does. One
	 * server quote per navigation — a discrete, user-initiated event, so there is
	 * no debounce, no interval and no timing value chosen here.
	 */
	const quotedStructure = useRef(trade?.structureId);
	useEffect(() => {
		if (trade === undefined) return;
		if (!structureChanged(quotedStructure.current, trade.structureId)) return;
		quotedStructure.current = trade.structureId;
		requote(side, budgetInput);
	}, [budgetInput, requote, side, trade]);

	const sign = useCallback(() => {
		if (trade === undefined) return;
		setMessage(null);
		setTxHash(null);
		setCard(null);
		// Chain and wallet are checked before anything is prepared: no calldata is
		// requested for a wallet that is not the signed-in one, and none is sent
		// on another chain (PRD 13, "Wrong chain: block financial actions").
		const guard = sendGuard({
			isConnected,
			address,
			walletChainId,
			expectedChainId: trade.chainId,
			sessionWallet: trade.sessionWallet,
		});
		if (!guard.ok) {
			setMessage(guard.message);
			if (guard.action === "switch") switchChain({ chainId: trade.chainId });
			if (guard.action === "signIn") onSignedIn?.();
			return;
		}
		const account = address as `0x${string}`;

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
					// C4. `chainId` and `account` are pinned on every send: without
					// them wagmi asserts NEITHER, so a wallet that moved chains (or
					// accounts) between the guard above and this line would still be
					// asked to sign.
					const approvalHash = await sendTransactionAsync({
						to: ready.approve.to,
						data: ready.approve.data,
						value: 0n,
						chainId: trade.chainId,
						account,
					});
					// C4. The allowance must be ON CHAIN before the fill is built and
					// simulated. Preparation used to continue on the approval HASH,
					// which is only a broadcast: the refetch below then read an
					// allowance that did not exist yet.
					const approvalReceipt = await waitForTransactionReceipt(config, {
						hash: approvalHash,
						chainId: trade.chainId,
					});
					if (approvalReceipt.status !== "success") {
						setPhase("failed");
						setMessage("The approval did not succeed on Base, so nothing was filled.");
						return;
					}
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

				// C5. The calldata about to be signed was built from a FRESH server
				// quote that the browser has never shown. Nothing may be signed until
				// the figures on screen are the figures being signed for.
				const shownRaw = acknowledged ?? quote?.raw ?? null;
				if (!sameEconomics(ready.expected, shownRaw)) {
					const moved = changedEconomics(ready.expected, shownRaw);
					setAcknowledged(ready.expected);
					setPhase("idle");
					setMessage(
						shownRaw === null
							? "The panel has no quote to compare against. Check the figures and press Trade again."
							: `The price moved while this was prepared (${moved.join(", ")}). The panel has been refreshed — check it and press Trade again to sign for the new figures.`,
					);
					// Refresh the printed figures from the server so the panel shows
					// what the next click will sign for.
					requote(side, budgetInput);
					return;
				}

				setPhase("filling");
				setMessage(ready.note);
				const hash = await sendTransactionAsync({
					to: ready.fill.to,
					data: ready.fill.data,
					value: 0n,
					// C4: same pinning as the approval.
					chainId: trade.chainId,
					account,
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
	}, [
		acknowledged,
		address,
		budgetInput,
		config,
		isConnected,
		onSignedIn,
		quote,
		requote,
		sendTransactionAsync,
		side,
		switchChain,
		trade,
		walletChainId,
	]);

	const bull = trade?.sides.bull;
	const bear = trade?.sides.bear;
	const busy = pending || phase === "approving" || phase === "filling" || phase === "recording";
	// F20: a stale panel must not be signed for — the figures below belong to the
	// previous amount. The requote happens on blur, so leaving the field clears
	// this by itself.
	const blocked = trade !== undefined && (view === null || !view.executable || staleQuote);

	return (
		<section className="card pad ticket">
			<h3 style={{ fontSize: "16px" }}>Take a side</h3>
			<span className="sub num">
				{structureLabel} · expires {expiryLabel}
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
					role="radio"
					aria-checked={side === "bull"}
					ref={bullRef}
					tabIndex={side === "bull" ? 0 : -1}
					disabled={bull !== undefined && !bull.available}
					onClick={() => chooseSide("bull")}
				>
					Bull · buy
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={side === "bear"}
					ref={bearRef}
					tabIndex={side === "bear" ? 0 : -1}
					disabled={bear !== undefined && !bear.available}
					onClick={() => chooseSide("bear")}
				>
					Bear · sell
				</button>
			</div>
			<p className="fine">{sideNote}</p>
			{bull !== undefined && !bull.available && bull.reason !== null ? (
				<span className="msg">
					<b>Bull</b> {bull.reason}
				</span>
			) : null}
			{bear !== undefined && !bear.available && bear.reason !== null ? (
				<span className="msg">
					<b>Bear</b> {bear.reason}
				</span>
			) : null}

			<span className="lbl">Your max loss</span>
			<div className="amt">
				<span className="cur">$</span>
				{trade === undefined ? (
					<span className="val num">{shown.maxLossUsd.raw}</span>
				) : (
					<input
						value={budgetInput}
						inputMode="decimal"
						aria-label={`Amount in ${shown.collateralSymbol}`}
						onChange={(event) => setBudgetInput(event.target.value)}
						onBlur={() => requote(side, budgetInput)}
					/>
				)}
				<span className="unit">{shown.collateralSymbol}</span>
			</div>
			<div className="pills">
				{shown.presetsUsd.map((v) => (
					<button
						type="button"
						className="pill"
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
			<span className="under">
				Preset amounts
				<TodoOwner />
			</span>

			{staleQuote ? (
				<span className="msg">
					These figures are for {quotedFor.current?.budgetInput === "" ? "the previous amount" : quotedFor.current?.budgetInput}
					{", "}not what you have typed. Leave the field to requote.
					<TodoOwner />
				</span>
			) : null}

			<dl className="kv">
				<div>
					<dt className="k">Order</dt>
					<dd className="v num">{shown.orderLabel}</dd>
				</div>
				<div>
					<dt className="k">Contracts</dt>
					<dd className="v num">{shown.contracts}</dd>
				</div>
				<div>
					<dt className="k">Max loss</dt>
					<dd className="v num">{usd2(shown.maxLossUsd)}</dd>
				</div>
				<div>
					<dt className="k">Max payout</dt>
					<dd className={`v num ${shown.maxPayoutUsd.pnlClass}`}>{signedUsd(shown.maxPayoutUsd)}</dd>
				</div>
				<div>
					<dt className="k">Break-even</dt>
					<dd className="v num">{usd(shown.breakEvenUsd)}</dd>
				</div>
				<div>
					<dt className="k">Liquidity left</dt>
					<dd className="v num">{usd(shown.liquidityLeftUsd)}</dd>
				</div>
			</dl>

			<button
				type="button"
				className="btn acc big block go"
				disabled={trade !== undefined && (busy || blocked || switching)}
				onClick={trade === undefined ? undefined : sign}
			>
				{(trade === undefined ? undefined : PHASE_LABEL[phase]) ?? "Trade"}
			</button>
			<span className="sign">Sign with wallet</span>
			<p className="fine" style={{ marginTop: "12px" }}>
				Approve USDC once, then one fill on Base. Your fill is public the moment it confirms.
			</p>

			{trade !== undefined && view !== null && !view.executable && view.reason !== null ? (
				<span className="msg">{view.reason}</span>
			) : null}
			{trade !== undefined && view !== null && view.signatureExpiresAt !== null ? (
				<span className="msg">
					Maker signature valid until <b className="num">{instantLabel(view.signatureExpiresAt, true)}</b>. It is
					refetched when you sign.
					<TodoOwner />
				</span>
			) : null}
			{message !== null ? <span className="msg">{message}</span> : null}
			{txHash !== null && trade !== undefined ? (
				<a className="tx" href={`${trade.explorerTxBase}${txHash}`} rel="noreferrer" target="_blank">
					{txHash.slice(0, 8)}…{txHash.slice(-6)} ↗
				</a>
			) : null}
			{trade !== undefined && trade.thesis !== null ? (
				<span className="msg">On {trade.thesis.headline}</span>
			) : null}

			{card !== null && trade !== undefined && txHash !== null ? (
				<FillDialog
					card={card}
					txHref={`${trade.explorerTxBase}${txHash}`}
					txLabel={`${txHash.slice(0, 8)}…${txHash.slice(-6)} ↗`}
					onClose={() => setCard(null)}
				/>
			) : null}
		</section>
	);
}
