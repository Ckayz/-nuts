"use server";

/**
 * Server actions for the RFQ card. Every export must stay an async function:
 * Next treats this whole module as a client-callable surface (see
 * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`), so the
 * types live in `./prepare` and only the six thin wrappers live here.
 *
 * Each action is an untrusted entry point. The client sends the request
 * parameters, a row id or a ticket plus a transaction hash — and NOTHING else.
 * The wallet comes from the cookie session, read inside `./prepare`, so a caller
 * can neither escrow from another address nor record against another wallet's
 * row.
 */
import {
	prepareRfqCancel,
	prepareRfqCreate,
	prepareRfqSettle,
	recordRfqCancel,
	recordRfqCreate,
	recordRfqSettle,
	type PrepareRfqCreateInput,
	type RfqCancelResult,
	type RfqPrepareResult,
	type RfqRecordResult,
	type RfqSettleResult,
} from "./prepare";

export async function prepareRfqCreateAction(input: PrepareRfqCreateInput): Promise<RfqPrepareResult> {
	return prepareRfqCreate(input);
}

export async function prepareRfqCancelAction(input: { rfqRequestId: string }): Promise<RfqCancelResult> {
	return prepareRfqCancel(input);
}

export async function prepareRfqSettleAction(input: { rfqRequestId: string }): Promise<RfqSettleResult> {
	return prepareRfqSettle(input);
}

export async function recordRfqCreateAction(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqCreate(input);
}

export async function recordRfqCancelAction(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqCancel(input);
}

export async function recordRfqSettleAction(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqSettle(input);
}
