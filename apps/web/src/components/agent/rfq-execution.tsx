"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig, useConnection, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@nuts/ui/components/button";
import { TodoOwner } from "@/components/primitives";
import { sendGuard } from "@/components/market/take-a-side";
import { approvalMatches, APPROVAL_RECEIPT_TIMEOUT_MS, fillIsStale } from "@/lib/trade/approval";
import { formatBaseUnits } from "@/lib/market/units";
import type { TxRequest } from "@/lib/trade/types";
import {
	getRfqStatusFor,
	prepareRfqCancelFor,
	prepareRfqCreateFor,
	prepareRfqSettleFor,
	recordRfqCancelFor,
	recordRfqCreateFor,
	recordRfqSettleFor,
} from "@/lib/rfq/actions";
import {
	clearHeldRfq,
	type HeldRfq,
	nextPollDelayMs,
	type PreparedRfqAction,
	type PreparedRfqCreate,
	readHeldRfq,
	rfqCanCancel,
	rfqCanSettle,
	rfqCreateRequestOf,
	type RfqExpected,
	rfqHoldStore,
	type RfqStatusView,
	type RfqTxKind,
	sameRfqEconomics,
	strikesAscending,
	writeHeldRfq,
} from "./rfq-contract";

/**
 * The wallet hand-off for an agent-prepared RFQ (owner 2026-09-06 10:1x, levels
 * 1 and 2: create -> watch -> settle after the reveal window, or cancel).
 *
 * Deliberately the sibling of `trade-execution.tsx`, step for step, because the
 * money-path defects that file has already paid for are the same ones an RFQ
 * card can have:
 *
 *   C#5 the approval's BYTES are decoded and compared with the escrow this card
 *       PRINTED before anything is signed, and the spender must be the FACTORY —
 *       the contract that pulls the deposit (W1: `requesterDeposit` is always 0;
 *       the escrow is the calldata's top-level `reservePrice`).
 *   C4  the approval is awaited to a MINED receipt, bounded by
 *       `APPROVAL_RECEIPT_TIMEOUT_MS`, and the create is then RE-PREPARED, so
 *       calldata is never broadcast against an allowance that is not on chain.
 *   C#8 a create older than PRD 14's 30-second window is refreshed, never sent.
 *   C#3 a broadcast transaction is held until a durable row exists, and a
 *       recording failure leaves the button RECORDING rather than re-sending.
 *
 * What is NOT here, on purpose: no offer decryption and no early settlement
 * (level 3). The agent never signs; every transaction below is a separate
 * confirmation in the user's own wallet, started by a control the user pressed.
 */

/** Base mainnet. The app is Base-only (`lib/wagmi.ts`). */
const BASE_CHAIN_ID = 8453 as const;

/**
 * EVERY user-facing sentence this card can show, in one tagged block — the same
 * fence `trade-execution.tsx` uses and `copy.test.ts` enforces.
 *
 * The mockup draws no agent view and the PRD sets no wording for an RFQ, so
 * every string below is this file's own and every one of them is the owner's to
 * write. Each sentence states something the code actually does; when one is
 * reworded, check the claim as well as the tone.
 */
const COPY = {
	/** TODO-OWNER: card title when the agent named nothing. */
	untitled: "Custom option request",
	/** TODO-OWNER: label above the escrowed deposit. */
	deposit: "You escrow",
	/** TODO-OWNER: label above the maximum loss, which IS the escrow. */
	maxLoss: "Most you can lose",
	/** TODO-OWNER: label above the strike or strikes. */
	strikes: "Strikes",
	/** TODO-OWNER: label above the contract count. */
	contracts: "Contracts",
	/** TODO-OWNER: label above the option's expiry. */
	expiry: "Expiry",
	/** TODO-OWNER: label above the moment offers stop being accepted. */
	offerDeadline: "Offers close",
	/** TODO-OWNER: C#5 — the decoded allowance line. */
	allowanceLabel: "This approval allows",
	/** TODO-OWNER: the two-confirmations note for the create path. */
	twoConfirmations:
		"Two confirmations: first an exact approval for the escrow, then the request itself.",
	/** TODO-OWNER: what the escrow is and when it comes back. */
	escrowNote:
		"The escrow is held by the factory while market makers answer. It is refunded if you cancel, and anything unused comes back when the request settles.",
	/** TODO-OWNER: recovery line when a sent transaction is restored on mount. */
	heldRestored:
		"A request you sent earlier is not recorded yet. Press the button to record it; it will not send a second transaction.",
	/** TODO-OWNER: the transaction is on chain and unrecorded; the button records, never re-sends. */
	recordAgain: "The transaction is on chain; press again to record it.",
	/** TODO-OWNER: a durable row says the transaction reverted. */
	reverted: "The transaction reverted on Base. Nothing was requested and nothing was escrowed.",
	/** TODO-OWNER: the connected wallet is not the one the calldata was bound to. */
	walletChanged: "Your connected wallet changed since this was prepared. Ask the agent to prepare it again.",
	/** TODO-OWNER: C#5 — the approval carries no decoded allowance. */
	approvalUnreadable:
		"This approval does not say what it would allow, so it was not sent. Ask the agent to prepare the request again.",
	/** TODO-OWNER: C#5 — the bytes disagree with the printed allowance. */
	approvalNotSent: "Nothing was sent.",
	/** TODO-OWNER: the decoded allowance is not the escrow this card printed. */
	allowanceNotEscrow: "This approval is not for the escrow shown above, so it was not sent.",
	/** TODO-OWNER: the allowance would go somewhere other than the factory that pulls the escrow. */
	approvalWrongSpender:
		"This approval would let a contract other than the one that holds the escrow spend your USDC, so it was not sent.",
	/** TODO-OWNER: the approval transaction did not succeed. */
	approvalFailed: "The approval did not succeed on Base, so nothing was requested.",
	/** TODO-OWNER: the approval was broadcast and has not been mined inside the bound. */
	approvalNotConfirmed:
		"Your approval has not confirmed on Base yet, so nothing was requested. Nothing else was sent. Press again once it confirms.",
	/** TODO-OWNER: the allowance is not on chain yet. */
	approvalNotLanded: "The approval has not landed yet. Try again in a moment.",
	/** TODO-OWNER: the terms the server would now sign for are not the ones on screen. */
	termsMoved:
		"The terms of this request changed while it was prepared. The figures above have been replaced with the server's current ones — check them and press again to sign for those.",
	/** TODO-OWNER: C#8 — PRD 14's 30-second fetch-to-broadcast window, cited in `approval.ts`. */
	tooOldToSend:
		"This request could not be refreshed inside the 30 seconds calldata has to reach Base, so nothing was sent. Ask the agent to prepare it again.",
	/**
	 * TODO-OWNER: the tool output carried no request to re-prepare from, so this
	 * card cannot refresh the calldata and refuses to broadcast it.
	 */
	cannotRefresh:
		"This request cannot be refreshed against the live factory, so nothing was sent. Ask the agent to prepare it again.",
	/** TODO-OWNER: a wallet rejection is a normal outcome, not a failure. */
	cancelled: "You cancelled the transaction.",
	/** TODO-OWNER: fallback when the wallet gives no message at all. */
	transactionFailed: "Transaction failed.",
	/** TODO-OWNER: shown when no wallet is connected. */
	connectFirst: "Connect a wallet first.",
	/** TODO-OWNER: the request is live and this card is waiting on it. */
	watchingTitle: "Your request is live",
	/** TODO-OWNER: label above the factory's own id for this request. */
	quotationLabel: "Request id",
	/** TODO-OWNER: the settled state. */
	settledTitle: "Settled.",
	/** TODO-OWNER: where the resulting option shows up, and why it is not instant. */
	settledNote:
		"The option is yours. It appears in your positions once the Thetanuts indexer has picked it up.",
	/** TODO-OWNER: label beside the created option contract. */
	optionLabel: "Option contract",
	/** TODO-OWNER: the cancelled state. */
	cancelledTitle: "Cancelled. Your escrow is refunded.",
	/** TODO-OWNER: the failed state, printed before the server's own reason. */
	failedTitle: "This request failed.",
	/** TODO-OWNER: link to the confirmed transaction. */
	viewOnExplorer: "View on BaseScan",
	/** TODO-OWNER: link to a sent-but-unconfirmed transaction. */
	viewSent: "View the sent transaction on BaseScan",
	/** TODO-OWNER: every label the primary button can carry, one per phase. */
	button: {
		idle: "Sign in wallet",
		preparing: "Checking the request…",
		approving: "Confirm approval…",
		creating: "Confirm request…",
		recording: "Waiting for the request…",
		record: "Record the request",
	},
	/** TODO-OWNER: the requester-only cancel control. */
	cancelButton: "Cancel the request",
	/** TODO-OWNER: shown while the cancel is in the wallet. */
	cancelling: "Confirm cancellation…",
	/** TODO-OWNER: the settle control, offered only once the reveal window has passed. */
	settleButton: "Settle it",
	/** TODO-OWNER: shown while the settlement is in the wallet. */
	settling: "Confirm settlement…",
	/** TODO-OWNER: the manual re-read control. */
	refreshButton: "Check again",
	/** TODO-OWNER: shown while the status is being re-read. */
	checking: "Checking…",
	/** TODO-OWNER: printed when the card has stopped polling on its own. */
	pollingStopped: "This card has stopped checking on its own. Press to check again.",
} as const;

type Phase =
	| "idle"
	| "preparing"
	| "approving"
	| "creating"
	| "recording"
	| "watching"
	| "cancelling"
	| "settling"
	| "checking"
	| "done"
	| "error";

const BUSY: ReadonlySet<Phase> = new Set<Phase>([
	"preparing",
	"approving",
	"creating",
	"recording",
	"cancelling",
	"settling",
	"checking",
]);

/**
 * The wallet, the durable hold and the recorder — shared by the create card and
 * by the small cancel/settle card, so the two cannot drift apart.
 *
 * Primitives rather than an options object: the caller renders a fresh literal
 * every time, and a changing identity would rebuild every callback below on
 * every render.
 */
function useRfqSend(boundAccount: string | undefined, boundChainId: 8453 | undefined) {
	const { address, isConnected, chainId: walletChainId } = useConnection();
	const { switchChain } = useSwitchChain();
	const { mutateAsync: sendTransactionAsync } = useSendTransaction();
	const config = useConfig();

	const [phase, setPhase] = useState<Phase>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
	const [held, setHeld] = useState<HeldRfq | null>(null);

	const chainId = boundChainId ?? BASE_CHAIN_ID;
	const wallet = (boundAccount ?? address ?? null)?.toLowerCase() ?? null;

	/** C#3: written the instant the wallet answers, cleared only when a row exists. */
	const hold = useCallback(
		(next: HeldRfq | null) => {
			setHeld(next);
			const store = rfqHoldStore();
			if (next === null) clearHeldRfq(store, chainId, wallet);
			else writeHeldRfq(store, chainId, wallet, next);
		},
		[chainId, wallet],
	);

	/** Take over a transaction this card did not send. `setHeld`, not `hold`: it is already stored. */
	const adopt = useCallback((found: HeldRfq) => {
		setHeld(found);
		setTxHash(found.txHash as `0x${string}`);
		setPhase("error");
		setMessage(COPY.heldRestored);
	}, []);

	const restored = useRef(false);
	useEffect(() => {
		if (restored.current) return;
		restored.current = true;
		const found = readHeldRfq(rfqHoldStore(), chainId, wallet);
		if (found !== null) adopt(found);
	}, [adopt, chainId, wallet]);

	/**
	 * Is this wallet already holding an unrecorded RFQ transaction? Re-read
	 * immediately before EVERY send: a transcript can hold several mounted cards,
	 * and each one's own `held` says nothing about the others.
	 */
	const anotherIsHeld = useCallback((): boolean => {
		const found = readHeldRfq(rfqHoldStore(), chainId, wallet);
		if (found === null) return false;
		adopt(found);
		return true;
	}, [adopt, chainId, wallet]);

	/** The whole precondition ladder the market ticket uses, in one place. */
	const ready = useCallback((): { ok: true; account: `0x${string}` } | { ok: false; message: string } => {
		if (boundAccount !== undefined && address !== undefined && boundAccount.toLowerCase() !== address.toLowerCase()) {
			return { ok: false, message: COPY.walletChanged };
		}
		const guard = sendGuard({
			isConnected,
			address,
			walletChainId,
			expectedChainId: chainId,
			sessionWallet: boundAccount?.toLowerCase() ?? address?.toLowerCase() ?? null,
		});
		if (!guard.ok) {
			if (guard.action === "switch") switchChain({ chainId });
			return { ok: false, message: guard.message };
		}
		return { ok: true, account: address as `0x${string}` };
	}, [address, boundAccount, chainId, isConnected, switchChain, walletChainId]);

	/** One send. `chainId` and `account` pinned, exactly as the trade card pins them. */
	const broadcast = useCallback(
		async (tx: TxRequest, account: `0x${string}`): Promise<`0x${string}`> =>
			await sendTransactionAsync({
				to: tx.to,
				data: tx.data,
				value: 0n,
				chainId,
				account,
			}),
		[chainId, sendTransactionAsync],
	);

	/** M5: bounded. A receipt that never lands must not leave a disabled button and no sentence. */
	const awaitReceipt = useCallback(
		async (hash: `0x${string}`): Promise<"success" | "failed" | "timeout"> => {
			let receipt: { status: string };
			try {
				receipt = await waitForTransactionReceipt(config, {
					hash,
					chainId,
					timeout: APPROVAL_RECEIPT_TIMEOUT_MS,
				});
			} catch {
				return "timeout";
			}
			return receipt.status === "success" ? "success" : "failed";
		},
		[chainId, config],
	);

	/** The message for a recording call that never reached the server. */
	const recordingThrew = useCallback((error: unknown) => {
		setPhase("error");
		const first = error instanceof Error ? (error.message.split("\n")[0] ?? "") : "";
		setMessage(`${first} ${COPY.recordAgain}`.trim());
	}, []);

	return {
		address,
		phase,
		setPhase,
		message,
		setMessage,
		txHash,
		setTxHash,
		held,
		hold,
		adopt,
		anotherIsHeld,
		ready,
		broadcast,
		awaitReceipt,
		recordingThrew,
	};
}

export function RfqExecution({
	rfq,
	onDone,
}: {
	readonly rfq: PreparedRfqCreate;
	/** Called once with the row id, the moment the server confirms the request is recorded. */
	readonly onDone?: (rfqRequestId: string) => void;
}) {
	const wallet = useRfqSend(rfq.account, rfq.chainId);
	const {
		address,
		phase,
		setPhase,
		message,
		setMessage,
		txHash,
		setTxHash,
		held,
		hold,
		anotherIsHeld,
		ready,
		broadcast,
		awaitReceipt,
		recordingThrew,
	} = wallet;

	/** The figures ON SCREEN. A mismatch REPLACES them before the button can be pressed again. */
	const [shown, setShown] = useState<RfqExpected>(rfq.expected);
	const [rfqRequestId, setRfqRequestId] = useState<string | null>(null);
	const [status, setStatus] = useState<RfqStatusView | null>(null);
	const [polls, setPolls] = useState(0);

	const request = rfqCreateRequestOf(rfq);
	const busy = BUSY.has(phase);

	/** C#5: printed from the SAME decoded value the send is checked against. */
	const allowanceLine =
		rfq.stage === "approve"
			? `${formatBaseUnits(BigInt(rfq.allowance.amount), rfq.allowance.tokenDecimals)} ${rfq.allowance.tokenSymbol}`
			: null;

	const refresh = useCallback(
		async (id: string): Promise<void> => {
			const answer = await getRfqStatusFor({ rfqRequestId: id });
			if (!answer.ok) {
				setMessage(answer.reason);
				return;
			}
			setStatus(answer.status);
		},
		[setMessage],
	);

	/** THE one place a create recording answer is interpreted. */
	const finishRecording = useCallback(
		async (sent: HeldRfq): Promise<void> => {
			setPhase("recording");
			if (sent.kind === "create") {
				const recorded = await recordRfqCreateFor({ token: sent.token, txHash: sent.txHash });
				if (!recorded.ok) {
					// No durable row: the transaction is on chain and unrecorded, so the
					// hold STAYS and the button keeps recording.
					setPhase("error");
					setMessage(`${recorded.reason} ${COPY.recordAgain}`);
					return;
				}
				hold(null);
				if (recorded.status === "failed") {
					setPhase("error");
					setMessage(COPY.reverted);
					return;
				}
				setRfqRequestId(recorded.rfqRequestId);
				onDone?.(recorded.rfqRequestId);
				setPhase("watching");
				setMessage(null);
				await refresh(recorded.rfqRequestId);
				return;
			}
			const record = sent.kind === "cancel" ? recordRfqCancelFor : recordRfqSettleFor;
			const recorded = await record({ token: sent.token, txHash: sent.txHash });
			if (!recorded.ok) {
				setPhase("error");
				setMessage(`${recorded.reason} ${COPY.recordAgain}`);
				return;
			}
			hold(null);
			const id = recorded.rfqRequestId;
			setRfqRequestId(id);
			setPhase("watching");
			setMessage(null);
			await refresh(id);
		},
		[hold, onDone, refresh, setMessage, setPhase],
	);

	const send = useCallback(async () => {
		setMessage(null);

		// The transaction happened: never send a second one. Before every other
		// check, because recording money that has already moved has nothing to do
		// with how old the calldata is.
		if (held !== null) {
			try {
				await finishRecording(held);
			} catch (error) {
				recordingThrew(error);
			}
			return;
		}

		const gate = ready();
		if (!gate.ok) {
			setPhase("error");
			setMessage(gate.message);
			return;
		}
		const account = gate.account;

		/**
		 * The card refuses to broadcast calldata it cannot rebuild. A create that
		 * cannot be re-prepared cannot be checked against the live allowance, the
		 * live deadline arithmetic or the server's own gate.
		 */
		if (request === null) {
			setPhase("error");
			setMessage(COPY.cannotRefresh);
			return;
		}

		let preparedThisSend = false;

		try {
			let step:
				| { stage: "approve"; approve: TxRequest }
				| { stage: "create"; create: TxRequest; token: string; expected: RfqExpected; preparedAt: string } =
				rfq.stage === "approve"
					? { stage: "approve", approve: rfq.approve }
					: {
							stage: "create",
							create: rfq.create,
							token: rfq.token,
							expected: rfq.expected,
							preparedAt: rfq.preparedAt,
						};

			const reprepare = async (): Promise<string | null> => {
				setPhase("preparing");
				preparedThisSend = true;
				const fresh = await prepareRfqCreateFor(request);
				if (!fresh.ok) return fresh.reason;
				if (fresh.stage !== "create") return COPY.approvalNotLanded;
				step = {
					stage: "create",
					create: fresh.create,
					token: fresh.token,
					expected: fresh.expected,
					preparedAt: fresh.preparedAt,
				};
				return null;
			};

			/**
			 * C#5. The approval's BYTES, before anything is signed.
			 *
			 * Two checks, not one. The bytes must match the allowance the server
			 * decoded and this card printed; and that allowance must be EXACTLY the
			 * escrow, granted to the FACTORY that pulls it. An approval that is
			 * exact but points somewhere else is still an approval the user did not
			 * ask for.
			 */
			const approvalIsExact = (data: string): string | null => {
				if (rfq.stage !== "approve") return null;
				const spender = rfq.allowance.spender;
				if (spender.toLowerCase() !== shown.factory.toLowerCase()) return COPY.approvalWrongSpender;
				if (rfq.allowance.amount !== shown.depositBaseUnits) return COPY.allowanceNotEscrow;
				const exact = approvalMatches({ data, expectedSpender: spender, expectedAmount: rfq.allowance.amount });
				return exact.ok ? null : `${exact.reason} ${COPY.approvalNotSent}`;
			};

			if (step.stage === "approve") {
				const refusal = approvalIsExact(step.approve.data);
				if (refusal !== null) {
					setPhase("error");
					setMessage(refusal);
					return;
				}
				if (anotherIsHeld()) return;

				// The SERVER fence before approval gas is spent, not only before the
				// create: the local hold is per browsing context and is empty in a
				// second tab, in a private window and with site data blocked.
				setPhase("preparing");
				preparedThisSend = true;
				const before = await prepareRfqCreateFor(request);
				if (!before.ok) {
					setPhase("error");
					setMessage(before.reason);
					return;
				}
				if (before.stage === "create") {
					// The allowance already covers the escrow: nothing to approve, and
					// no gas spent finding that out on chain.
					step = {
						stage: "create",
						create: before.create,
						token: before.token,
						expected: before.expected,
						preparedAt: before.preparedAt,
					};
				} else {
					const freshRefusal = approvalIsExact(before.approve.data);
					if (freshRefusal !== null) {
						setPhase("error");
						setMessage(freshRefusal);
						return;
					}
					step = { stage: "approve", approve: before.approve };
				}
			}

			if (step.stage === "approve") {
				setPhase("approving");
				const approvalHash = await broadcast(step.approve, account);
				const receipt = await awaitReceipt(approvalHash);
				if (receipt === "timeout") {
					setPhase("error");
					setMessage(COPY.approvalNotConfirmed);
					return;
				}
				if (receipt === "failed") {
					setPhase("error");
					setMessage(COPY.approvalFailed);
					return;
				}
				// C4: the create is built AFTER the allowance is on chain.
				const failed = await reprepare();
				if (failed !== null) {
					setPhase("error");
					setMessage(failed);
					return;
				}
			}

			// C#8, checked after the approval branch so its preparation is not repeated.
			if (step.stage === "create" && fillIsStale(step.preparedAt, Date.now())) {
				const failed = await reprepare();
				if (failed !== null) {
					setPhase("error");
					setMessage(failed);
					return;
				}
			}

			if (anotherIsHeld()) return;

			// The server fence on every send this click has not already prepared.
			if (!preparedThisSend) {
				const failed = await reprepare();
				if (failed !== null) {
					setPhase("error");
					setMessage(failed);
					return;
				}
			}

			if (step.stage !== "create") {
				setPhase("error");
				setMessage(COPY.approvalNotLanded);
				return;
			}

			// Nothing is signed until the figures on this card are the figures being
			// signed for.
			if (!sameRfqEconomics(step.expected, shown)) {
				setShown(step.expected);
				setPhase("idle");
				setMessage(COPY.termsMoved);
				return;
			}

			// C#8: the last age check before the escrow moves.
			if (fillIsStale(step.preparedAt, Date.now())) {
				setPhase("error");
				setMessage(COPY.tooOldToSend);
				return;
			}

			if (anotherIsHeld()) return;
			setPhase("creating");
			const hash = await broadcast(step.create, account);
			setTxHash(hash);
			hold({ token: step.token, txHash: hash, kind: "create" });

			try {
				await finishRecording({ token: step.token, txHash: hash, kind: "create" });
			} catch (error) {
				recordingThrew(error);
			}
		} catch (error) {
			setPhase("error");
			const text = error instanceof Error ? error.message : COPY.transactionFailed;
			setMessage(/rejected|denied|User denied/i.test(text) ? COPY.cancelled : text);
		}
	}, [
		anotherIsHeld,
		awaitReceipt,
		broadcast,
		finishRecording,
		held,
		hold,
		ready,
		recordingThrew,
		request,
		rfq,
		setMessage,
		setPhase,
		setTxHash,
		shown,
	]);

	/**
	 * Cancel and settle: each its own preparation, its own wallet confirmation
	 * and its own recording. Nothing here is automatic — the card sends only what
	 * the user pressed.
	 */
	const act = useCallback(
		async (kind: "cancel" | "settle") => {
			setMessage(null);
			if (rfqRequestId === null) return;
			if (held !== null) {
				try {
					await finishRecording(held);
				} catch (error) {
					recordingThrew(error);
				}
				return;
			}
			const gate = ready();
			if (!gate.ok) {
				setPhase("error");
				setMessage(gate.message);
				return;
			}
			try {
				setPhase(kind === "cancel" ? "cancelling" : "settling");
				const prepared =
					kind === "cancel"
						? await prepareRfqCancelFor({ rfqRequestId })
						: await prepareRfqSettleFor({ rfqRequestId });
				if (!prepared.ok) {
					setPhase("watching");
					setMessage(prepared.reason);
					return;
				}
				const tx: TxRequest = "cancel" in prepared ? prepared.cancel : prepared.settle;
				if (anotherIsHeld()) return;
				const hash = await broadcast(tx, gate.account);
				setTxHash(hash);
				const sent: HeldRfq = { token: prepared.token, txHash: hash, kind, rfqRequestId };
				hold(sent);
				try {
					await finishRecording(sent);
				} catch (error) {
					recordingThrew(error);
				}
			} catch (error) {
				setPhase("watching");
				const text = error instanceof Error ? error.message : COPY.transactionFailed;
				setMessage(/rejected|denied|User denied/i.test(text) ? COPY.cancelled : text);
			}
		},
		[
			anotherIsHeld,
			broadcast,
			finishRecording,
			held,
			hold,
			ready,
			recordingThrew,
			rfqRequestId,
			setMessage,
			setPhase,
			setTxHash,
		],
	);

	const check = useCallback(async () => {
		if (rfqRequestId === null) return;
		setPhase("checking");
		try {
			await refresh(rfqRequestId);
		} finally {
			setPhase("watching");
		}
	}, [refresh, rfqRequestId, setPhase]);

	/**
	 * The watching VIEW is "a recorded request with a status", NOT a phase.
	 * `phase` is transient — cancelling, settling and checking all happen INSIDE
	 * this view — so branching the markup on `phase === "watching"` made the whole
	 * view disappear the moment the user pressed Cancel, and put the create
	 * button back on screen under it.
	 */
	const watching = rfqRequestId !== null && status !== null;
	const terminal = status !== null && (status.status === "settled" || status.status === "cancelled");

	/**
	 * The automatic re-read, bounded by `nextPollDelayMs`: it stops the moment the
	 * request is no longer waiting on anything, and after `RFQ_MAX_POLLS` reads,
	 * so an abandoned tab does not read forever.
	 */
	useEffect(() => {
		if (!watching || busy || rfqRequestId === null) return;
		const delay = nextPollDelayMs(status, polls);
		if (delay === null) return;
		const timer = setTimeout(() => {
			setPolls((count) => count + 1);
			void refresh(rfqRequestId);
		}, delay);
		return () => {
			clearTimeout(timer);
		};
	}, [busy, polls, refresh, rfqRequestId, status, watching]);

	const buttonLabel =
		phase === "preparing"
			? COPY.button.preparing
			: phase === "approving"
				? COPY.button.approving
				: phase === "creating"
					? COPY.button.creating
					: phase === "recording"
						? COPY.button.recording
						: held !== null
							? COPY.button.record
							: COPY.button.idle;

	return (
		<div className="rounded-lg border p-4">
			<p className="font-medium text-sm">{rfq.label ?? COPY.untitled}</p>

			{/*
			 * The terms, inline rather than in a child component: the probe harness
			 * (`@/test/hook-runner`) walks the element tree this function RETURNS and
			 * does not render nested function components, so a child component here
			 * made every printed figure invisible to the tests that exist to prove
			 * the card prints the SERVER's numbers. Measured before it was inlined:
			 * the card's own text was title + notes + button, with no amount in it.
			 */}
			<dl className="mt-3 space-y-1 text-sm">
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">{COPY.deposit}</dt>
					<dd className="num">{`${shown.deposit} USDC`}</dd>
				</div>
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">{COPY.maxLoss}</dt>
					{/* One text child, not a literal "$" beside an expression: the two
					    render identically in a browser and differently to anything that
					    walks the tree, and this figure is the one a reviewer greps for. */}
					<dd className="num">{`$${shown.maxLossUsd}`}</dd>
				</div>
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">{COPY.strikes}</dt>
					{/* W1: the factory's own order is DESCENDING for a put spread. */}
					<dd className="num">{strikesAscending(shown.strikesUsd).join(" / ")}</dd>
				</div>
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">{COPY.contracts}</dt>
					<dd className="num">{shown.numContracts}</dd>
				</div>
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">{COPY.expiry}</dt>
					<dd className="num">{shown.expiryAt}</dd>
				</div>
				<div className="flex justify-between gap-4">
					<dt className="text-muted-foreground">{COPY.offerDeadline}</dt>
					<dd className="num">{shown.offerEndAt}</dd>
				</div>
			</dl>

			{allowanceLine !== null && (
				<div className="mt-3 flex justify-between gap-4 text-sm">
					<span className="text-muted-foreground">
						{COPY.allowanceLabel} <TodoOwner />
					</span>
					<span className="num">{allowanceLine}</span>
				</div>
			)}

			{rfq.stage === "approve" && !watching && (
				<p className="mt-3 text-muted-foreground text-xs">
					{COPY.twoConfirmations} <TodoOwner />
				</p>
			)}

			{!watching && (
				<p className="mt-3 text-muted-foreground text-xs">
					{COPY.escrowNote} <TodoOwner />
				</p>
			)}

			{watching && status !== null ? (
				<div className="mt-4 space-y-3">
					<p className="font-medium text-sm">
						{status.status === "settled"
							? COPY.settledTitle
							: status.status === "cancelled"
								? COPY.cancelledTitle
								: status.status === "failed"
									? COPY.failedTitle
									: COPY.watchingTitle}{" "}
						<TodoOwner />
					</p>
					{/* The server's own sentence, never reworded here. */}
					<p className="text-muted-foreground text-sm">{status.sentence}</p>
					{status.reason && <p className="text-muted-foreground text-sm">{status.reason}</p>}
					{status.quotationId && (
						<div className="flex justify-between gap-4 text-sm">
							<span className="text-muted-foreground">
								{COPY.quotationLabel} <TodoOwner />
							</span>
							<span className="num">{status.quotationId}</span>
						</div>
					)}
					{status.status === "settled" && status.optionAddress && (
						<div className="space-y-1">
							<div className="flex justify-between gap-4 text-sm">
								<span className="text-muted-foreground">
									{COPY.optionLabel} <TodoOwner />
								</span>
								<a
									className="num text-sm underline underline-offset-4"
									href={`https://basescan.org/address/${status.optionAddress}`}
									target="_blank"
									rel="noreferrer"
								>
									{status.optionAddress}
								</a>
							</div>
							<p className="text-muted-foreground text-xs">
								{COPY.settledNote} <TodoOwner />
							</p>
						</div>
					)}
					{!terminal && (
						<div className="flex flex-wrap items-center gap-3">
							{rfqCanCancel(status) && (
								<Button size="sm" variant="outline" onClick={() => void act("cancel")} disabled={busy}>
									{phase === "cancelling" ? COPY.cancelling : COPY.cancelButton}
								</Button>
							)}
							{/* The settle control exists ONLY once the server says the reveal
							    window has passed and a winner exists. */}
							{rfqCanSettle(status) && (
								<Button size="sm" onClick={() => void act("settle")} disabled={busy}>
									{phase === "settling" ? COPY.settling : COPY.settleButton}
								</Button>
							)}
							<Button size="sm" variant="outline" onClick={() => void check()} disabled={busy}>
								{phase === "checking" ? COPY.checking : COPY.refreshButton}
							</Button>
						</div>
					)}
					{nextPollDelayMs(status, polls) === null && !terminal && (
						<p className="text-muted-foreground text-xs">
							{COPY.pollingStopped} <TodoOwner />
						</p>
					)}
				</div>
			) : (
				<div className="mt-4 flex items-center gap-3">
					<Button size="sm" onClick={() => void send()} disabled={busy || !address}>
						{buttonLabel}
					</Button>
					{!address && <span className="text-muted-foreground text-xs">{COPY.connectFirst}</span>}
				</div>
			)}

			{txHash !== null && (
				<a
					className="mt-2 block text-sm underline underline-offset-4"
					href={`https://basescan.org/tx/${txHash}`}
					target="_blank"
					rel="noreferrer"
				>
					{watching ? COPY.viewOnExplorer : COPY.viewSent}
				</a>
			)}

			{message && <p className="agent-msg">{message}</p>}
		</div>
	);
}

/**
 * The small card for a cancel or a settle the AGENT prepared (its own tool
 * output), rather than one started from the watching stage above.
 *
 * Same hook, so the send, the hold and the recorder are one implementation.
 */
export function RfqActionExecution({
	action,
	onDone,
}: {
	readonly action: PreparedRfqAction;
	readonly onDone?: (rfqRequestId: string) => void;
}) {
	const {
		address,
		phase,
		setPhase,
		message,
		setMessage,
		txHash,
		setTxHash,
		held,
		hold,
		anotherIsHeld,
		ready,
		broadcast,
		recordingThrew,
	} = useRfqSend(action.account, action.chainId);
	const [status, setStatus] = useState<RfqStatusView | null>(null);

	const kind: RfqTxKind = action.kind === "rfq_cancel" ? "cancel" : "settle";
	const tx = action.kind === "rfq_cancel" ? action.cancel : action.settle;
	const busy = BUSY.has(phase);

	const finishRecording = useCallback(
		async (sent: HeldRfq): Promise<void> => {
			setPhase("recording");
			const record = sent.kind === "cancel" ? recordRfqCancelFor : recordRfqSettleFor;
			const recorded = await record({ token: sent.token, txHash: sent.txHash });
			if (!recorded.ok) {
				setPhase("error");
				setMessage(`${recorded.reason} ${COPY.recordAgain}`);
				return;
			}
			hold(null);
			setPhase("done");
			setMessage(null);
			onDone?.(recorded.rfqRequestId);
			const answer = await getRfqStatusFor({ rfqRequestId: recorded.rfqRequestId });
			if (answer.ok) setStatus(answer.status);
		},
		[hold, onDone, setMessage, setPhase],
	);

	const send = useCallback(async () => {
		setMessage(null);
		if (held !== null) {
			try {
				await finishRecording(held);
			} catch (error) {
				recordingThrew(error);
			}
			return;
		}
		if (tx === undefined) {
			setPhase("error");
			setMessage(COPY.cannotRefresh);
			return;
		}
		const gate = ready();
		if (!gate.ok) {
			setPhase("error");
			setMessage(gate.message);
			return;
		}
		try {
			if (anotherIsHeld()) return;
			setPhase(kind === "cancel" ? "cancelling" : "settling");
			const hash = await broadcast(tx, gate.account);
			setTxHash(hash);
			const sent: HeldRfq = { token: action.token, txHash: hash, kind, rfqRequestId: action.rfqRequestId };
			hold(sent);
			try {
				await finishRecording(sent);
			} catch (error) {
				recordingThrew(error);
			}
		} catch (error) {
			setPhase("error");
			const text = error instanceof Error ? error.message : COPY.transactionFailed;
			setMessage(/rejected|denied|User denied/i.test(text) ? COPY.cancelled : text);
		}
	}, [
		action.rfqRequestId,
		action.token,
		anotherIsHeld,
		broadcast,
		finishRecording,
		held,
		hold,
		kind,
		ready,
		recordingThrew,
		setMessage,
		setPhase,
		setTxHash,
		tx,
	]);

	const label =
		phase === "recording"
			? COPY.button.recording
			: held !== null
				? COPY.button.record
				: phase === "cancelling"
					? COPY.cancelling
					: phase === "settling"
						? COPY.settling
						: kind === "cancel"
							? COPY.cancelButton
							: COPY.settleButton;

	return (
		<div className="rounded-lg border p-4">
			<p className="font-medium text-sm">{action.label ?? COPY.untitled}</p>
			<div className="mt-3 flex justify-between gap-4 text-sm">
				<span className="text-muted-foreground">
					{COPY.quotationLabel} <TodoOwner />
				</span>
				<span className="num">{action.quotationId ?? action.rfqRequestId}</span>
			</div>
			{status !== null && <p className="mt-3 text-muted-foreground text-sm">{status.sentence}</p>}
			{phase !== "done" && (
				<div className="mt-4 flex items-center gap-3">
					<Button size="sm" onClick={() => void send()} disabled={busy || !address}>
						{label}
					</Button>
					{!address && <span className="text-muted-foreground text-xs">{COPY.connectFirst}</span>}
				</div>
			)}
			{txHash !== null && (
				<a
					className="mt-2 block text-sm underline underline-offset-4"
					href={`https://basescan.org/tx/${txHash}`}
					target="_blank"
					rel="noreferrer"
				>
					{phase === "done" ? COPY.viewOnExplorer : COPY.viewSent}
				</a>
			)}
			{message && <p className="agent-msg">{message}</p>}
		</div>
	);
}
