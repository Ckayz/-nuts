"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig, useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@nuts/ui/components/button";
import { TodoOwner } from "@/components/primitives";
// C3-r2: the AGENT's preparation action, which re-applies the PRD 10.2
// ceiling to what the second leg actually prepares. `prepareTrade` (the market
// ticket's) does not, and this leg is the one that produces the fill calldata.
import { prepareAgentTrade } from "@/lib/agent/actions";
import { recordTrade } from "@/lib/trade/actions";
import { clearHeldFill, readHeldFill, sessionFillStore, writeHeldFill } from "@/lib/trade/held-fill";
import { approvalMatches, fillIsStale } from "@/lib/trade/approval";
import { formatBaseUnits, formatUsd8 } from "@/lib/market/units";
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
	/**
	 * C#5. Present at the APPROVE stage: what the approval calldata actually
	 * does, decoded server-side from its own bytes. The card prints it and this
	 * component re-decodes the bytes before sending, so the number on screen and
	 * the number in the transaction are proven to be the same one.
	 */
	readonly allowance?: {
		readonly amount: string;
		readonly spender: string;
		readonly tokenAddress: string;
		readonly tokenSymbol: string;
		readonly tokenDecimals: number;
	};
	readonly preview: {
		readonly premium?: { readonly amount: string; readonly token: string } | null;
		readonly contracts?: string | null;
		readonly maxLossUsd?: string | null;
		readonly cappedByOrderSize?: boolean;
		readonly requestedBudget?: { readonly amount: string; readonly token: string } | null;
	};
	readonly signatureExpiresAt?: string;
	/**
	 * C#8. When the book fetch that produced the fill calldata started, ISO 8601.
	 * PRD 14 bounds fetch-to-broadcast at 30 seconds; the maker signature's own
	 * expiry is a different, longer clock.
	 */
	readonly preparedAt?: string;
}

type Phase = "idle" | "approving" | "preparing" | "filling" | "recording" | "done" | "expired" | "error";

/** The three amounts this card prints. */
export interface DisplayedTrade {
	readonly pay: string | null;
	readonly maxLossUsd: string | null;
	readonly contracts: string | null;
}

/**
 * C4-r2 (lane C confirming pass, finding 4). What the card shows.
 *
 * A server quote wins, because that is the object `sameEconomics` compares and
 * therefore the only one whose figures are the ones being signed for. Its raw
 * fields are converted here with the same helpers the market ticket uses:
 * `debit` and `numContracts` are base units, `maxLossUsd8` is 8-decimal USD.
 *
 * Falls back to the agent's own preview only before any server quote exists —
 * the approval stage, where no ticket has been issued yet.
 */
export function displayFrom(
	quote: QuoteRaw | null,
	preview: PreparedTrade["preview"],
): DisplayedTrade {
	if (quote !== null) {
		return {
			pay: `${formatBaseUnits(BigInt(quote.debit), quote.collateralDecimals)} ${quote.collateralSymbol}`,
			maxLossUsd: quote.maxLossUsd8 === null ? null : formatUsd8(BigInt(quote.maxLossUsd8)),
			contracts: formatBaseUnits(BigInt(quote.numContracts), quote.contractSizeDecimals),
		};
	}
	return {
		pay: preview.premium ? `${preview.premium.amount} ${preview.premium.token}` : null,
		maxLossUsd: preview.maxLossUsd ?? null,
		contracts: preview.contracts ?? null,
	};
}

/** Base mainnet. The app is Base-only (`lib/wagmi.ts`), so this is a constant, not a choice. */
const BASE_CHAIN_ID = 8453 as const;

/**
 * D-C2 (lane D confirming pass). EVERY user-facing sentence this card can show,
 * in one place.
 *
 * The mockup draws no agent view and the PRD sets no wording for one, so every
 * string below is this file's own. Owner rule (CLAUDE.md, "Product numbers and
 * copy are the owner's"): they are all `TODO-OWNER`. Collecting them here is
 * what makes that auditable — a reviewer greps one block instead of twenty
 * `setMessage` calls, and `trade-execution.copy.test.ts` fails if a new literal
 * is introduced anywhere else in the file.
 *
 * Each sentence states something the code actually does. When one is reworded,
 * check the claim as well as the tone.
 */
const COPY = {
	/** TODO-OWNER: recovery line shown when a sent fill is restored on mount. */
	heldFillRestored:
		"A fill you sent earlier is not recorded yet. Press the button to record it; it will not send a second trade.",
	/** TODO-OWNER: the fill is on chain and unrecorded; the button records, never re-sends. */
	recordAgain: "The fill is on chain; press again to record it.",
	/** TODO-OWNER: a durable row says the transaction reverted. */
	reverted: "The fill reverted on Base. Nothing was bought and nothing was counted.",
	/** TODO-OWNER: the maker signature died before the user signed. */
	quoteExpired: "This quote expired before it was signed. Ask the agent for a fresh one.",
	/** TODO-OWNER: the connected wallet is not the one the calldata was bound to. */
	walletChanged: "Your connected wallet changed since this was prepared. Ask for a fresh quote.",
	/** TODO-OWNER: the allowance is not on chain yet. */
	approvalNotLanded: "The approval has not landed yet. Try again in a moment.",
	/** TODO-OWNER: C#5 — the approval carries no decoded allowance. */
	approvalUnreadable:
		"This approval does not say what it would allow, so it was not sent. Ask the agent for a fresh quote.",
	/** TODO-OWNER: the approval transaction did not succeed. */
	approvalFailed: "The approval did not succeed on Base, so nothing was filled.",
	/** TODO-OWNER: C#5 — the bytes disagree with the printed allowance. */
	approvalNotSent: "Nothing was sent.",
	/** TODO-OWNER: C5 — the fresh quote differs from what the card showed. */
	priceMoved:
		"The price moved while this was prepared. The figures above have been replaced with the server's current ones — check them and press again to sign for those.",
	/** TODO-OWNER: C#8 — PRD 14's 30-second fetch-to-broadcast window, cited in `approval.ts`. */
	tooOldToSend:
		"This trade could not be refreshed inside the 30 seconds a fill has to reach Base, so nothing was sent. Ask the agent for a fresh quote.",
	/** TODO-OWNER: a wallet rejection is a normal outcome, not a failure. */
	cancelled: "You cancelled the transaction.",
	/** TODO-OWNER: fallback when the wallet gives no message at all. */
	transactionFailed: "Transaction failed.",
	/** TODO-OWNER: card title when the agent named no instrument. */
	untitled: "Prepared trade",
	/** TODO-OWNER: label above the amount leaving the wallet. */
	youPay: "You pay",
	/** TODO-OWNER: label above the maximum loss. */
	maxLoss: "Most you can lose",
	/** TODO-OWNER: label above the contract count. */
	contracts: "Contracts",
	/** TODO-OWNER: C#5 — the decoded allowance line. */
	allowanceLabel: "This approval allows",
	/** TODO-OWNER: the capped-order sentence, first half. */
	cappedPrefix: "This order could not absorb the full",
	/** TODO-OWNER: the capped-order sentence, second half. */
	cappedSuffix: "you asked for. Only the amount above will be spent.",
	/** TODO-OWNER: the two-confirmations note. */
	twoConfirmations: "Two confirmations: first an exact spending approval, then the trade itself.",
	/** TODO-OWNER: the confirmed state. */
	confirmed: "Confirmed on Base and recorded.",
	/** TODO-OWNER: link to this fill's own page. */
	openPosition: "Open the position",
	/** TODO-OWNER: link to the confirmed transaction. */
	viewOnExplorer: "View on BaseScan",
	/** TODO-OWNER: link to a sent-but-unconfirmed transaction. */
	viewSent: "View the sent transaction on BaseScan",
	/** TODO-OWNER: every label the one button can carry, one per phase. */
	button: {
		approving: "Confirm approval…",
		preparing: "Checking the order…",
		filling: "Confirm trade…",
		recording: "Waiting for the fill…",
		record: "Record the fill",
		expired: "Quote expired",
		idle: "Sign in wallet",
	},
	/** TODO-OWNER: shown when no wallet is connected. */
	connectFirst: "Connect a wallet first.",
} as const;

export function TradeExecution({ trade }: { trade: PreparedTrade }) {
	const { address, isConnected, chainId: walletChainId } = useConnection();
	const { switchChain } = useSwitchChain();
	const { mutateAsync: sendTransactionAsync } = useSendTransaction();
	const config = useConfig();

	const [phase, setPhase] = useState<Phase>("idle");
	/**
	 * C5-r2 (lane C confirming pass, finding 5). The SENT fill: the hash the
	 * wallet returned AND the token the calldata was built from. The retry used
	 * `trade.token` — the token from the APPROVAL-stage output, which is empty
	 * whenever a collateral approval was needed — so a recording retry presented
	 * `""` and could never succeed.
	 */
	const [sent, setSent] = useState<{ hash: `0x${string}`; token: string } | null>(null);
	/**
	 * C#3/#4-r3. The hash for DISPLAY, kept apart from the recording hold. The
	 * hold is released the moment a durable row exists — including a row that
	 * says the fill reverted — and the BaseScan link must survive that.
	 */
	const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
	const hash = txHash;
	/**
	 * C#2-r3 (lane C confirming pass, finding 2). The same durable hold the
	 * market ticket uses. `sent` above lives in component state, and the
	 * reviewer's remount measured `{"sends":2}`: a fresh card knew nothing about
	 * money that had already left the wallet.
	 */
	const holdWallet = (trade.account ?? address ?? null)?.toLowerCase() ?? null;
	const holdChain = trade.chainId ?? BASE_CHAIN_ID;
	const holdSent = useCallback(
		(fill: { hash: `0x${string}`; token: string } | null) => {
			setSent(fill);
			const store = sessionFillStore();
			if (fill === null) clearHeldFill(store, holdChain, holdWallet);
			else writeHeldFill(store, holdChain, holdWallet, { token: fill.token, txHash: fill.hash });
		},
		[holdChain, holdWallet],
	);
	const restored = useRef(false);
	useEffect(() => {
		if (restored.current) return;
		restored.current = true;
		const held = readHeldFill(sessionFillStore(), holdChain, holdWallet);
		if (held === null) return;
		setSent({ hash: held.txHash as `0x${string}`, token: held.token });
		setTxHash(held.txHash as `0x${string}`);
		setPhase("error");
		// TODO-OWNER: recovery copy.
		setMessage(COPY.heldFillRestored);
	}, [holdChain, holdWallet]);
	const [positionPath, setPositionPath] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	/** C5: the economics the user has been shown and clicked through. */
	const [acknowledged, setAcknowledged] = useState<QuoteRaw | null>(null);
	/**
	 * C4-r2 (lane C confirming pass, finding 4). The figures ON SCREEN.
	 *
	 * The card displayed `trade.preview` (the agent's first quote) while the
	 * comparison used `trade.expected` (a different read). After a mismatch,
	 * `acknowledged` changed but every printed amount stayed the same, so the
	 * second click authorised economics nobody had seen. The card now displays
	 * whatever quote the comparison is against, and a mismatch REPLACES the
	 * displayed figures before the button can be pressed again.
	 */
	const [shownQuote, setShownQuote] = useState<QuoteRaw | null>(trade.expected ?? null);

	const expiresAt = trade.signatureExpiresAt ? Date.parse(trade.signatureExpiresAt) : null;
	const expired = expiresAt !== null && expiresAt <= Date.now();
	const busy = phase === "approving" || phase === "preparing" || phase === "filling" || phase === "recording";

	const capped = trade.preview.cappedByOrderSize === true;
	const expectedChainId = trade.chainId ?? BASE_CHAIN_ID;
	// C4-r2. ONE source for the three printed amounts. While a server quote is
	// held it is that quote, so the numbers compared and the numbers displayed
	// are the same read; before one exists the agent's preview is all there is.
	const displayed = displayFrom(shownQuote, trade.preview);
	/**
	 * C#5. The allowance this card is asking for, printed from the SAME decoded
	 * value the send is checked against. Absent whenever the server is already
	 * past the approval.
	 */
	const allowance =
		trade.stage === "approve" && trade.allowance !== undefined
			? `${formatBaseUnits(BigInt(trade.allowance.amount), trade.allowance.tokenDecimals)} ${trade.allowance.tokenSymbol}`
			: null;

	/**
	 * C#3 / C#4 (lane C confirming pass, findings 3 and 4; lane D's D-C1). THE
	 * one place a `recordTrade` answer is interpreted.
	 *
	 * Round 2 had two: the first submit checked `recorded.status === "failed"`,
	 * and the retry checked only `again.ok` and then set `"done"`. The reviewer
	 * returned `{ok:true,status:"failed"}` for a REVERTED transaction on a retry
	 * and the card said "Confirmed on Base and recorded."
	 * (`retry_revert {"phase":"done","confirmedText":true}`). A successful server
	 * action is not a successful fill.
	 *
	 * It also awaited outside the enclosing `try`, so a rejected request left
	 * `phase === "recording"` forever and `busy` kept the retry button disabled
	 * (`retry_throw {"phase":"recording","button":{"disabled":true}}`). Every
	 * caller below runs this inside a `catch`, and no failure path leaves the
	 * phase in a busy state.
	 */
	const finishRecording = useCallback(
		async (fill: { hash: `0x${string}`; token: string }) => {
			setPhase("recording");
			const recorded = await recordTrade({ token: fill.token, txHash: fill.hash });
			if (!recorded.ok) {
				// No durable row: the fill is on chain and still unrecorded, so the
				// hold STAYS and the button keeps recording.
				setPhase("error");
				setMessage(`${recorded.reason} ${COPY.recordAgain}`);
				return;
			}
			// A durable row exists — confirmed, or failed because the fill reverted.
			// Either way there is nothing left to record.
			holdSent(null);
			if (recorded.status === "failed") {
				setPhase("error");
				setMessage(COPY.reverted);
				return;
			}
			setPositionPath(`/p/${recorded.positionId}`);
			setPhase("done");
		},
		[holdSent],
	);

	/** C#3. The message for a recording that never reached the server. */
	const recordingThrew = useCallback((error: unknown) => {
		setPhase("error");
		const first = error instanceof Error ? (error.message.split("\n")[0] ?? "") : "";
		setMessage(`${first} ${COPY.recordAgain}`.trim());
	}, []);

	const send = useCallback(async () => {
		setMessage(null);

		// C6 / C5-r2. A hash already exists: the fill happened. Never send a second
		// one — and recover it with the token that BUILT it. This runs BEFORE the
		// expiry check on purpose: a quote's signature window has nothing to do
		// with recording money that has already moved, and checking it first left
		// a sent fill permanently unrecordable.
		if (sent !== null) {
			// C#3. Inside a try: a rejected promise used to escape and freeze the
			// phase at "recording", which disabled the only button that could retry.
			try {
				await finishRecording(sent);
			} catch (error) {
				recordingThrew(error);
			}
			return;
		}

		if (expiresAt !== null && expiresAt <= Date.now()) {
			setPhase("expired");
			setMessage(COPY.quoteExpired);
			return;
		}
		// The prepared calldata is bound to one account: the server read the
		// allowance with it. Sending from a different wallet would approve the
		// wrong balance.
		if (trade.account && address && trade.account.toLowerCase() !== address.toLowerCase()) {
			setPhase("error");
			setMessage(COPY.walletChanged);
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
				| {
						stage: "fill";
						fill: { to: string; data: string };
						token: string;
						expected: QuoteRaw;
						preparedAt: string | undefined;
					} =
				trade.stage === "approve" && trade.transactions.approve
					? { stage: "approve", approve: trade.transactions.approve }
					: {
							stage: "fill",
							fill: trade.transactions.fill ?? { to: "", data: "" },
							token: trade.token ?? "",
							expected: trade.expected as QuoteRaw,
							preparedAt: trade.preparedAt,
						};

			/**
			 * C#8. Re-prepares whenever the calldata in hand is past PRD 14's
			 * 30-second fetch-to-broadcast window. The card can sit in a chat
			 * transcript for minutes; the only thing that used to refresh it was an
			 * APPROVAL leg, so a wallet with a sufficient allowance broadcast
			 * whatever the agent prepared, however old
			 * (`STALE_FILL {elapsedSeconds:31, signatureStillValid:true,
			 * prepares:0, sends:1}`).
			 */
			const reprepare = async (): Promise<string | null> => {
				setPhase("preparing");
				const fresh = await prepareAgentTrade({
					structureId: trade.structureId,
					side: trade.side,
					budgetInput: trade.budgetInput,
					thesisId: trade.thesisId,
				});
				if (!fresh.ok) return fresh.reason;
				if (fresh.stage !== "fill") return COPY.approvalNotLanded;
				ready = {
					stage: "fill",
					fill: fresh.fill,
					token: fresh.token,
					expected: fresh.expected,
					preparedAt: fresh.preparedAt,
				};
				return null;
			};

			if (ready.stage === "approve") {
				// C#5. The bytes about to be signed are decoded here and compared
				// with the allowance this card PRINTED. An approval is a real
				// wallet transaction granting a real allowance; round 2 sent it
				// before any gate ran and printed the model's own preview beside it
				// (APPROVE_BEFORE_GATE {"sends":[{"amount":"20000000"}]} under a $5
				// card). PRD 10.2: "Allowances must be exact for the approved
				// transaction."
				if (trade.allowance === undefined) {
					setPhase("error");
					// TODO-OWNER: wording.
					setMessage(COPY.approvalUnreadable);
					return;
				}
				const exact = approvalMatches({
					data: ready.approve.data,
					expectedSpender: trade.allowance.spender,
					expectedAmount: trade.allowance.amount,
				});
				if (!exact.ok) {
					setPhase("error");
					// TODO-OWNER: wording.
					setMessage(`${exact.reason} ${COPY.approvalNotSent}`);
					return;
				}
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
					setMessage(COPY.approvalFailed);
					return;
				}
				setPhase("preparing");
				const second = await prepareAgentTrade({
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
					setMessage(COPY.approvalNotLanded);
					return;
				}
				ready = {
					stage: "fill",
					fill: second.fill,
					token: second.token,
					expected: second.expected,
					preparedAt: second.preparedAt,
				};
			}

			// C#8. Checked AFTER the approval branch, so the one preparation that
			// branch already did is not repeated — and checked again below, because
			// a fresh preparation that is somehow still stale must not be sent.
			if (ready.stage === "fill" && fillIsStale(ready.preparedAt, Date.now())) {
				const failed = await reprepare();
				if (failed !== null) {
					setPhase("error");
					setMessage(failed);
					return;
				}
			}

			// C5. Nothing is signed until the figures on this card are the figures
			// being signed for.
			const shown = acknowledged ?? shownQuote;
			if (!sameEconomics(ready.expected, shown)) {
				setAcknowledged(ready.expected);
				// C4-r2: the card now PRINTS the server's current figures, so the
				// second click cannot authorise something the user never saw.
				setShownQuote(ready.expected);
				setPhase("idle");
				setMessage(COPY.priceMoved);
				return;
			}

			// C#8. The last age check before the money moves. A re-preparation that
			// is itself already past the window means the round trip cannot finish
			// inside PRD 14's bound, and nothing is broadcast.
			if (fillIsStale(ready.preparedAt, Date.now())) {
				setPhase("expired");
				// TODO-OWNER: wording.
				setMessage(COPY.tooOldToSend);
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
			// C6 / C5-r2: kept before anything else can fail, so the fill is never
			// re-sent — with the token that built THIS calldata, not the one the
			// approval stage handed back.
			setTxHash(fillHash);
			holdSent({ hash: fillHash, token: ready.token });

			// C#3/#4: the SAME handler the retry uses. Its own try, so a recording
			// failure can never be mistaken for a wallet rejection by the catch
			// below — the money has already moved by this line.
			try {
				await finishRecording({ hash: fillHash, token: ready.token });
			} catch (error) {
				recordingThrew(error);
			}
		} catch (error) {
			setPhase("error");
			const text = error instanceof Error ? error.message : COPY.transactionFailed;
			// Wallet rejections are a normal outcome, not a failure to report loudly.
			setMessage(/rejected|denied|User denied/i.test(text) ? COPY.cancelled : text);
		}
	}, [
		acknowledged,
		address,
		config,
		expectedChainId,
		expiresAt,
		finishRecording,
		holdSent,
		isConnected,
		recordingThrew,
		sent,
		shownQuote,
		sendTransactionAsync,
		switchChain,
		trade,
		walletChainId,
	]);

	return (
		<div className="rounded-lg border p-4">
			<p className="font-medium text-sm">{trade.label ?? COPY.untitled}</p>

			<dl className="mt-3 space-y-1 text-sm">
				{displayed.pay && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">{COPY.youPay}</dt>
						<dd className="num">{displayed.pay}</dd>
					</div>
				)}
				{displayed.maxLossUsd && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">{COPY.maxLoss}</dt>
						<dd className="num">${displayed.maxLossUsd}</dd>
					</div>
				)}
				{displayed.contracts && (
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">{COPY.contracts}</dt>
						<dd className="num">{displayed.contracts}</dd>
					</div>
				)}
			</dl>

			{capped && trade.preview.requestedBudget && (
				// Design rule (CLAUDE.md): one accent, `Manrope` only, colour on
				// money alone — so no amber and no mono anywhere in here.
				<p className="mt-3 text-muted-foreground text-xs">
					{COPY.cappedPrefix} {trade.preview.requestedBudget.amount}{" "}
					{trade.preview.requestedBudget.token} {COPY.cappedSuffix} <TodoOwner />
				</p>
			)}

			{allowance !== null && (
				<div className="mt-3 flex justify-between gap-4 text-sm">
					{/* C#5: read out of the approval calldata itself. TODO-OWNER: wording. */}
					<span className="text-muted-foreground">{COPY.allowanceLabel} <TodoOwner /></span>
					<span className="num">{allowance}</span>
				</div>
			)}

			{trade.stage === "approve" && (
				<p className="mt-3 text-muted-foreground text-xs">
					{COPY.twoConfirmations} <TodoOwner />
				</p>
			)}

			{phase === "done" && hash ? (
				<div className="mt-4">
					<p className="text-sm">{COPY.confirmed} <TodoOwner /></p>
					<div className="flex gap-4">
						{positionPath && (
							<a className="text-sm underline underline-offset-4" href={positionPath}>
								{COPY.openPosition}
							</a>
						)}
						<a
							className="text-sm underline underline-offset-4"
							href={`https://basescan.org/tx/${hash}`}
							target="_blank"
							rel="noreferrer"
						>
							{COPY.viewOnExplorer}
						</a>
					</div>
				</div>
			) : (
				<div className="mt-4 flex items-center gap-3">
					{/* C5-r2: an expired quote must never block RECORDING a fill that
					    has already been sent. */}
					<Button size="sm" onClick={() => void send()} disabled={busy || (expired && sent === null) || !address}>
						{phase === "approving"
							? COPY.button.approving
							: phase === "preparing"
								? COPY.button.preparing
								: phase === "filling"
									? COPY.button.filling
									: phase === "recording"
										? COPY.button.recording
										: sent !== null
											? COPY.button.record
											: expired
												? COPY.button.expired
												: COPY.button.idle}
					</Button>
					{!address && <span className="text-muted-foreground text-xs">{COPY.connectFirst}</span>}
				</div>
			)}

			{hash !== null && phase !== "done" && (
				<a
					className="mt-2 block text-sm underline underline-offset-4"
					href={`https://basescan.org/tx/${hash}`}
					target="_blank"
					rel="noreferrer"
				>
					{COPY.viewSent}
				</a>
			)}

			{/* D-n6: neutral, like the market ticket's own failure line
			    (`.ticket .msg`, styles/market.css). Colour is for money only, so
			    a failure reads as a hairlined note, never as red text. */}
			{message && <p className="agent-msg">{message}</p>}
		</div>
	);
}
