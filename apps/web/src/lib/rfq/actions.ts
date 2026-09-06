"use server";

/**
 * PLACEHOLDER — W2 OWNS THIS FILE.
 *
 * W2 is writing the RFQ server path (`lib/rfq/prepare.ts`, `status.ts`,
 * `limits.ts` and these `"use server"` wrappers) in another worktree at the same
 * time as W3 built the card. Nothing here implements any of it: every function
 * throws, so a build that reaches production without W2's module is loud rather
 * than silently doing nothing. It exists so the card can IMPORT the real
 * specifiers (a mocked module in bun must still resolve) and so `check-types`
 * has the signatures to check the call sites against.
 *
 * The orchestrator replaces this file wholesale with W2's. If W2's landed names
 * differ (`prepareRfqCreate` rather than `prepareRfqCreateFor`, say), the
 * reconciliation is the import list at the top of `components/agent/rfq-execution.tsx`.
 *
 * Every export in a `"use server"` module must be an async function, so the
 * types these signatures use live in `@/components/agent/rfq-contract` for now;
 * W2's file takes them from `./prepare` and `./status` instead.
 */
import type {
	RfqCreateRequest,
	RfqPrepareCancelResult,
	RfqPrepareResult,
	RfqPrepareSettleResult,
	RfqRecordActionResult,
	RfqRecordCreateResult,
	RfqStatusResult,
} from "@/components/agent/rfq-contract";

const NOT_WIRED =
	"The RFQ server path is not wired in this build (W2). No transaction was prepared, sent or recorded.";

export async function prepareRfqCreateFor(_input: RfqCreateRequest): Promise<RfqPrepareResult> {
	throw new Error(NOT_WIRED);
}

export async function prepareRfqCancelFor(_input: { rfqRequestId: string }): Promise<RfqPrepareCancelResult> {
	throw new Error(NOT_WIRED);
}

export async function prepareRfqSettleFor(_input: { rfqRequestId: string }): Promise<RfqPrepareSettleResult> {
	throw new Error(NOT_WIRED);
}

export async function recordRfqCreateFor(_input: { token: string; txHash: string }): Promise<RfqRecordCreateResult> {
	throw new Error(NOT_WIRED);
}

export async function recordRfqCancelFor(_input: { token: string; txHash: string }): Promise<RfqRecordActionResult> {
	throw new Error(NOT_WIRED);
}

export async function recordRfqSettleFor(_input: { token: string; txHash: string }): Promise<RfqRecordActionResult> {
	throw new Error(NOT_WIRED);
}

export async function getRfqStatusFor(_input: { rfqRequestId: string }): Promise<RfqStatusResult> {
	throw new Error(NOT_WIRED);
}
