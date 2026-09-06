/**
 * The RFQ contract this card codes against, and the pure helpers it and its
 * probes share.
 *
 * WHY THIS FILE EXISTS (W3, parallel build). The server path (`lib/rfq/*`) and
 * the agent tools (`lib/agent/rfq-tools.ts`) are W2's, written in another
 * worktree at the same time as this card. The shapes below are W2's brief §1-§3
 * transcribed, so the card compiles and is proven against the CONTRACT rather
 * than against an implementation that does not exist here yet. Where W2's landed
 * code differs, the orchestrator reconciles these declarations — nothing in this
 * file implements server logic, and nothing here is a claim about what the chain
 * does.
 *
 * Two facts from W1's landed package layer (`.research/rfq/report-W1.md`) shape
 * the helpers:
 *   - `expected.depositBaseUnits` is the TOTAL escrow (the calldata's top-level
 *     `reservePrice` argument), while `reservePriceBaseUnits` is PER CONTRACT.
 *     The card prints the total, and calls it the most that can be lost.
 *   - strikes come back in the FACTORY's order, which is DESCENDING for a put
 *     spread. They are displayed ascending, from a sorted COPY.
 */
import type { TxRequest } from "@/lib/trade/types";
import { type FillStore, sessionFillStore } from "@/lib/trade/held-fill";

/** Owner decision 2026-09-06 10:1x: RFQ is BUY puts and put spreads, USDC, ETH/BTC. */
export type RfqUnderlying = "ETH" | "BTC";

/**
 * What the server says this request IS, decoded from the calldata it built
 * (W1's `RfqCreateBuild.expected`, rendered as decimal strings by W2).
 *
 * Every number the card prints comes from here. The model's own words are never
 * a source for a figure on a money card.
 */
export interface RfqExpected {
	/** TOTAL escrow, USDC base units. W1: the top-level `reservePrice` argument. */
	readonly depositBaseUnits: string;
	/** The same escrow as a decimal USDC string. */
	readonly deposit: string;
	/** Factory order — DESCENDING for a put spread. Display through `strikesAscending`. */
	readonly strikesUsd: readonly string[];
	/** Decimal contract count, as the user said it. */
	readonly numContracts: string;
	readonly expiryAt: string;
	readonly offerEndAt: string;
	/** The OptionFactory. The escrow allowance is granted to THIS address. */
	readonly factory: string;
	/** = `deposit`, valued in USD. The escrow is the buyer's whole downside. */
	readonly maxLossUsd: string;
}

/** What an approval's calldata actually does, decoded server-side from its bytes. */
export interface RfqAllowance {
	readonly amount: string;
	readonly spender: string;
	readonly tokenAddress: string;
	readonly tokenSymbol: string;
	readonly tokenDecimals: number;
}

export interface RfqFailure {
	readonly ok: false;
	readonly code: string;
	readonly reason: string;
	readonly needsSignIn?: boolean;
}

export interface RfqPrepareApprove {
	readonly ok: true;
	readonly stage: "approve";
	readonly approve: TxRequest;
	readonly allowance: RfqAllowance;
	readonly expected: RfqExpected;
	readonly note: string;
}

export interface RfqPrepareCreate {
	readonly ok: true;
	readonly stage: "create";
	readonly create: TxRequest;
	/** Opaque, server-signed. Handed back to the recording action unchanged. */
	readonly token: string;
	readonly expected: RfqExpected;
	/** ISO 8601, taken BEFORE the reads that produced the calldata. */
	readonly preparedAt: string;
	readonly note: string;
}

export type RfqPrepareResult = RfqFailure | RfqPrepareApprove | RfqPrepareCreate;

/**
 * What the card must send back to re-prepare. A create is never broadcast from
 * calldata the card cannot rebuild: the allowance may have landed since, and the
 * factory's own deadline arithmetic moves with the clock.
 */
export interface RfqCreateRequest {
	readonly underlying: RfqUnderlying;
	readonly strikesUsd: readonly string[];
	/** Unix seconds or an ISO instant, as the tool accepted it. */
	readonly expiry: number | string;
	readonly numContracts: string;
	readonly reservePricePerContract: string;
	readonly offerDeadlineMinutes?: number;
}

/**
 * `requestRfqCreation`'s output: a prepare result plus the tool envelope, which
 * mirrors `requestOptionBookExecution` so the chat can branch on `kind`.
 */
export type PreparedRfqCreate = (RfqPrepareApprove | RfqPrepareCreate) & {
	readonly prepared: true;
	readonly kind: "rfq_create";
	/**
	 * D-5. NULLABLE, because the producer's own type is: `lib/agent/rfq-tools.ts`
	 * builds this envelope with `{ account: session?.walletAddress ?? null }`.
	 * Declaring it `string | undefined` here hid a `null` the card then called
	 * `.toLowerCase()` on.
	 */
	readonly account?: string | null;
	readonly chainId?: 8453;
	readonly label?: string;
	readonly instruction?: string;
	/** The request, so the card can re-prepare. Flat fields are read as a fallback. */
	readonly request?: RfqCreateRequest;
	readonly underlying?: RfqUnderlying;
	readonly strikesUsd?: readonly string[];
	readonly expiry?: number | string;
	readonly numContracts?: string;
	readonly reservePricePerContract?: string;
	readonly offerDeadlineMinutes?: number;
};

/** `requestRfqCancellation` / `requestRfqSettlement`: one prepared transaction. */
export interface PreparedRfqAction {
	readonly prepared: true;
	readonly kind: "rfq_cancel" | "rfq_settle";
	readonly rfqRequestId: string;
	readonly quotationId?: string;
	readonly token: string;
	/** D-5: nullable for the same reason as `PreparedRfqCreate.account`. */
	readonly account?: string | null;
	readonly chainId?: 8453;
	readonly label?: string;
	readonly instruction?: string;
	readonly cancel?: TxRequest;
	readonly settle?: TxRequest;
	readonly bestPrice?: string | null;
}

export type RfqStatusKind =
	/** W2: a row exists from the moment calldata is prepared, before the create mines. */
	| "pending_create"
	| "waiting_for_offers"
	| "reveal_window"
	| "ready_to_settle"
	| "settled"
	| "cancelled"
	| "expired_unfilled"
	| "failed";

export type RfqNextAction = "wait" | "settle" | "cancel" | "none";

/** `lib/rfq/status.ts`'s plain-words answer, as the card renders it. */
export interface RfqStatusView {
	readonly status: RfqStatusKind;
	readonly nextAction: RfqNextAction;
	/** The server's own sentence. Never reworded here. */
	readonly sentence: string;
	readonly quotationId?: string | null;
	readonly optionAddress?: string | null;
	readonly bestPrice?: string | null;
	readonly reason?: string | null;
}

export type RfqPrepareCancelResult =
	| RfqFailure
	| { readonly ok: true; readonly cancel: TxRequest; readonly quotationId: string; readonly token: string };

export type RfqPrepareSettleResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly settle: TxRequest;
			readonly quotationId: string;
			readonly token: string;
			readonly bestPrice: string | null;
		};

export type RfqRecordCreateResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly rfqRequestId: string;
			readonly quotationId?: string | null;
			/** "failed" when the receipt reverted; a durable row exists either way. */
			readonly status?: string;
		};

export type RfqRecordActionResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly rfqRequestId: string;
			readonly status?: string;
			readonly optionAddress?: string | null;
		};

export type RfqStatusResult =
	| RfqFailure
	| { readonly ok: true; readonly rfqRequestId: string; readonly status: RfqStatusView };

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

/**
 * Orders two decimal strings without ever building a float.
 *
 * `Number("2200.00000000")` would be exact today and is still the wrong tool:
 * money crosses this boundary as decimal strings (PRD 10.3), and a comparison
 * that parses one is a place where precision can be lost later without a test
 * noticing. Integer part by length then lexicographically, fraction padded.
 */
export function compareDecimalStrings(left: string, right: string): number {
	const split = (value: string): [string, string] => {
		const trimmed = value.trim();
		const at = trimmed.indexOf(".");
		if (at === -1) return [trimmed, ""];
		return [trimmed.slice(0, at), trimmed.slice(at + 1)];
	};
	const [leftWhole, leftFraction] = split(left);
	const [rightWhole, rightFraction] = split(right);
	const l = leftWhole.replace(/^0+(?=\d)/, "");
	const r = rightWhole.replace(/^0+(?=\d)/, "");
	if (l.length !== r.length) return l.length < r.length ? -1 : 1;
	if (l !== r) return l < r ? -1 : 1;
	const width = Math.max(leftFraction.length, rightFraction.length);
	const lf = leftFraction.padEnd(width, "0");
	const rf = rightFraction.padEnd(width, "0");
	if (lf === rf) return 0;
	return lf < rf ? -1 : 1;
}

/**
 * Strikes for DISPLAY, ascending, from a copy.
 *
 * W1 measured the factory's own order and it is DESCENDING for a put spread
 * (`useAscending = isCall || isCondor`, SDK dist/index.js:5887-5890; RFQ 125's
 * calldata carries `["220000000000","210000000000"]`). Sorting the array in
 * place would reorder the object the card also compares against.
 */
export function strikesAscending(strikes: readonly string[]): string[] {
	return [...strikes].sort(compareDecimalStrings);
}

/**
 * Are these the same economics?
 *
 * The card refuses to sign for figures it did not print. Every field that
 * changes what the user pays or receives is compared; `note` and the tool
 * envelope are not economics.
 */
export function sameRfqEconomics(a: RfqExpected | null, b: RfqExpected | null): boolean {
	if (a === null || b === null) return false;
	return (
		a.depositBaseUnits === b.depositBaseUnits &&
		a.numContracts === b.numContracts &&
		a.expiryAt === b.expiryAt &&
		a.offerEndAt === b.offerEndAt &&
		a.factory.toLowerCase() === b.factory.toLowerCase() &&
		a.strikesUsd.join("|") === b.strikesUsd.join("|")
	);
}

/** The request to re-prepare from, read from the tool envelope; null when it is not there. */
export function rfqCreateRequestOf(out: PreparedRfqCreate): RfqCreateRequest | null {
	const nested = out.request;
	if (nested !== undefined) return nested;
	const { underlying, strikesUsd, expiry, numContracts, reservePricePerContract } = out;
	if (
		underlying === undefined ||
		strikesUsd === undefined ||
		expiry === undefined ||
		numContracts === undefined ||
		reservePricePerContract === undefined
	) {
		return null;
	}
	return {
		underlying,
		strikesUsd,
		expiry,
		numContracts,
		reservePricePerContract,
		...(out.offerDeadlineMinutes === undefined ? {} : { offerDeadlineMinutes: out.offerDeadlineMinutes }),
	};
}

/**
 * The states in which the escrow is still with the factory and the requester
 * can take it back.
 *
 * `expired_unfilled` belongs here (D-1). The reveal window has passed with no
 * offer on chain, so nothing can be settled — but the deposit has NOT come back
 * on its own, and `lib/rfq/status.ts:164` answers that state with
 * `nextAction: "cancel"` and a sentence telling the reader that cancelling
 * returns it. Leaving it out left a real escrow with no refund control in the
 * whole UI.
 */
const CANCELLABLE: ReadonlySet<RfqStatusKind> = new Set<RfqStatusKind>([
	"waiting_for_offers",
	"reveal_window",
	"ready_to_settle",
	"expired_unfilled",
]);

/**
 * Cancel is the requester's, and only while the deposit is still escrowed.
 *
 * Two ways in, the server's instruction first: if `lib/rfq/status.ts` asks for
 * a cancel, the card offers one even for a status this file has no opinion
 * about. The set is the second reading, so a status label that arrives with a
 * stale `nextAction` still shows the control while the escrow is out.
 */
export function rfqCanCancel(status: RfqStatusView | null): boolean {
	if (status === null) return false;
	return status.nextAction === "cancel" || CANCELLABLE.has(status.status);
}

/**
 * Settle is offered ONLY when the server says the reveal window has passed and a
 * winner exists. `nextAction` alone is not the test: a status that says "wait"
 * with a stale `ready_to_settle` label would otherwise show the button.
 */
export function rfqCanSettle(status: RfqStatusView | null): boolean {
	return status !== null && status.status === "ready_to_settle" && status.nextAction === "settle";
}

/** TODO-OWNER: how often the card re-reads a live request while it waits. */
export const RFQ_POLL_MS = 20_000;

/**
 * TODO-OWNER: how many times it may do that before it stops on its own.
 *
 * A card can sit in a transcript for hours. 20 s x 30 is ten minutes of polling,
 * after which the user presses the refresh control themselves. The cap is what
 * stops an abandoned tab from reading forever.
 */
export const RFQ_MAX_POLLS = 30;

/**
 * How long until the next automatic read, or null to stop.
 *
 * Pure, so the cap is pinned by a test rather than by a fake clock: null once
 * the request is terminal, and null once `RFQ_MAX_POLLS` reads have happened.
 */
export function nextPollDelayMs(status: RfqStatusView | null, pollsSoFar: number): number | null {
	if (status === null) return null;
	if (pollsSoFar >= RFQ_MAX_POLLS) return null;
	if (status.nextAction !== "wait") return null;
	return RFQ_POLL_MS;
}

/* ------------------------------------------------------------------ *
 * The durable hold: a broadcast RFQ transaction that is not recorded yet
 * ------------------------------------------------------------------ */

export type RfqTxKind = "create" | "cancel" | "settle";

export interface HeldRfq {
	readonly token: string;
	readonly txHash: string;
	readonly kind: RfqTxKind;
	/** The row a cancel or a settle acts on. Absent for a create: the row id is what recording RETURNS. */
	readonly rfqRequestId?: string;
}

/**
 * Its OWN key, never `lib/trade/held-fill.ts`'s.
 *
 * That store holds `{token, txHash}` for a FILL and the trade card records
 * anything it finds there through `recordTrade`. An RFQ creation written into it
 * would be handed to the wrong recorder.
 */
export function rfqHoldKey(chainId: number, wallet: string): string {
	return `thesis.held-rfq.${chainId}.${wallet.toLowerCase()}`;
}

const HEX_TX = /^0x[0-9a-fA-F]{64}$/;
const KINDS: ReadonlySet<string> = new Set<RfqTxKind>(["create", "cancel", "settle"]);

/** Anything that is not a well-formed hold is treated as absent AND removed. */
export function readHeldRfq(store: FillStore | null, chainId: number, wallet: string | null): HeldRfq | null {
	if (store === null || wallet === null) return null;
	const key = rfqHoldKey(chainId, wallet);
	let raw: string | null;
	try {
		raw = store.getItem(key);
	} catch {
		return null;
	}
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
		const { token, txHash, kind, rfqRequestId } = parsed as Record<string, unknown>;
		if (typeof token !== "string" || token === "") throw new Error("no token");
		if (typeof txHash !== "string" || !HEX_TX.test(txHash)) throw new Error("no hash");
		if (typeof kind !== "string" || !KINDS.has(kind)) throw new Error("no kind");
		return {
			token,
			txHash,
			kind: kind as RfqTxKind,
			...(typeof rfqRequestId === "string" && rfqRequestId !== "" ? { rfqRequestId } : {}),
		};
	} catch {
		clearHeldRfq(store, chainId, wallet);
		return null;
	}
}

export function writeHeldRfq(store: FillStore | null, chainId: number, wallet: string | null, held: HeldRfq): void {
	if (store === null || wallet === null) return;
	try {
		store.setItem(rfqHoldKey(chainId, wallet), JSON.stringify(held));
	} catch {
		// A store that refuses writes must not take the card down. The server's
		// own row is the fence that holds when this one is unavailable.
	}
}

export function clearHeldRfq(store: FillStore | null, chainId: number, wallet: string | null): void {
	if (store === null || wallet === null) return;
	try {
		store.removeItem(rfqHoldKey(chainId, wallet));
	} catch {
		// Same reason as above.
	}
}

export { sessionFillStore as rfqHoldStore };
