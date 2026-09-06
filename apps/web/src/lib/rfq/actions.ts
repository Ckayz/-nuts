"use server";

/**
 * Server actions for the RFQ card. Every export must stay an async function:
 * Next treats this whole module as a client-callable surface (see
 * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`), so the
 * types live in `./prepare` and only the seven thin wrappers live here.
 *
 * Each action is an untrusted entry point. The client sends the request
 * parameters, a row id or a ticket plus a transaction hash — and NOTHING else.
 * The wallet comes from the cookie session, read inside `./prepare`, so a caller
 * can neither escrow from another address nor read or record against another
 * wallet's row.
 *
 * THE NAMES ARE THE CARD'S. `components/agent/rfq-execution.tsx` imports
 * `prepareRfqCreateFor`, `prepareRfqCancelFor`, `prepareRfqSettleFor`,
 * `recordRfqCreateFor`, `recordRfqCancelFor`, `recordRfqSettleFor` and
 * `getRfqStatusFor` from here, so those are the names. `./prepare` exports
 * functions with the same `…For` names that take the SESSION as their first
 * argument — the seam a test drives. The two are deliberately distinguished by
 * their arity: an action never accepts a session, and the server-side function
 * never reads a cookie.
 */
import {
	prepareRfqCancel,
	prepareRfqCreate,
	prepareRfqSettle,
	recordRfqCancel,
	recordRfqCreate,
	recordRfqSettle,
	rfqStatus,
	type PrepareRfqCreateInput,
	type RfqCancelResult,
	type RfqPrepareResult,
	type RfqRecordResult,
	type RfqSettleResult,
	type RfqStatusResult,
} from "./prepare";

export async function prepareRfqCreateFor(input: PrepareRfqCreateInput): Promise<RfqPrepareResult> {
	return prepareRfqCreate(input);
}

export async function prepareRfqCancelFor(input: { rfqRequestId: string }): Promise<RfqCancelResult> {
	return prepareRfqCancel(input);
}

export async function prepareRfqSettleFor(input: { rfqRequestId: string }): Promise<RfqSettleResult> {
	return prepareRfqSettle(input);
}

export async function recordRfqCreateFor(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqCreate(input);
}

export async function recordRfqCancelFor(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqCancel(input);
}

export async function recordRfqSettleFor(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqSettle(input);
}

/** Polled by the card while a request is live. Read-only. */
export async function getRfqStatusFor(input: { rfqRequestId: string }): Promise<RfqStatusResult> {
	return rfqStatus(input);
}
