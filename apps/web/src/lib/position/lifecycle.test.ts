/**
 * C-R4 (lane C confirming pass, MAJOR). Which `positions.failure_reason` gets
 * which sentence, over EVERY literal `lib/trade/record.ts` can write.
 *
 * Measured before the fix, with the real `resolvePnl`:
 *
 *   fill_quantity_unproven             -> Your fill is on chain, but the contract count …
 *   filled_order_differs_from_prepared -> This transaction failed, so there is no position.
 *   debit_differs_from_prepared        -> This transaction failed, so there is no position.
 *
 * The last two are written at `record.ts:274` and `:288`, both AFTER
 * `receipt.status === "success"` and after `matchFillEvent` bound this wallet as
 * the taker of the prepared order — the money moved. Telling that holder the
 * transaction failed is a false statement about their own funds.
 *
 * The literals are re-derived from `record.ts` on every run, so a new refusal
 * reason cannot be added without a decision being made here about what it says.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	failedButOnChain,
	FILL_ON_CHAIN_UNPROVEN,
	onChainRefusalDetail,
	ON_CHAIN_REFUSAL_REASONS,
	resolvePnl,
	type PnlInputs,
} from "./lifecycle";

const REVERTED_SENTENCE = "This transaction failed, so there is no position.";

/**
 * Every reason literal `record.ts` writes into `positions.failure_reason`, and
 * the sentence it must produce. `null` is the "reverted" family: a row whose
 * reason was lost (the `markFailed` annotation is best-effort by design) must
 * fail CLOSED into the reverted sentence rather than claim a position exists.
 */
const EXPECTED: Record<string, "on-chain" | "reverted"> = {
	transaction_reverted: "reverted",
	no_matching_order_filled: "reverted",
	fill_quantity_unproven: "on-chain",
	filled_order_differs_from_prepared: "on-chain",
	debit_differs_from_prepared: "on-chain",
	// The row this marks belongs to a wallet that CLAIMED the hash and was then
	// proven not to be its taker (`record.ts:590`), so its own money did not move
	// in that transaction.
	superseded_by_onchain_taker: "reverted",
};

const base: Omit<PnlInputs, "status" | "failureReason"> = {
	finalPnlUsd: null,
	estimatedPnlUsd: null,
	settlementPriceUsd: null,
	derivable: false,
	derivedPnlUsd: null,
	spotUsd8: null,
	unavailableReason: "no model",
	expiryAt: null,
	asOf: "2026-09-06T00:00:00.000Z",
};

/** Every string literal `record.ts` stores as a failure reason. */
function reasonsInRecordSource(): string[] {
	const source = readFileSync(new URL("../trade/record.ts", import.meta.url), "utf8");
	const found = new Set<string>();
	for (const match of source.matchAll(/markFailed\([^,]+,[^,]+,\s*"([a-z_]+)"\s*\)/g)) {
		if (match[1] !== undefined) found.add(match[1]);
	}
	for (const match of source.matchAll(/failureReason:\s*"([a-z_]+)"/g)) {
		if (match[1] !== undefined) found.add(match[1]);
	}
	return [...found].sort();
}

describe("C-R4: every failure reason record.ts writes has a decided sentence", () => {
	test("the literal list has not grown or shrunk", () => {
		expect(reasonsInRecordSource()).toEqual(Object.keys(EXPECTED).sort());
	});

	test("each reason gets the right sentence and the right chip family", () => {
		const rows = Object.entries(EXPECTED).map(([reason, family]) => {
			const resolved = resolvePnl({ ...base, status: "failed", failureReason: reason });
			return {
				reason,
				onChain: failedButOnChain("failed", reason),
				reverted: resolved.detail === REVERTED_SENTENCE,
				detail: resolved.detail,
				family,
			};
		});
		for (const row of rows) {
			expect({ reason: row.reason, onChain: row.onChain, reverted: row.reverted }).toEqual({
				reason: row.reason,
				onChain: row.family === "on-chain",
				reverted: row.family === "reverted",
			});
			if (row.family === "on-chain") {
				expect(row.detail).toBe(onChainRefusalDetail(row.reason));
				expect(row.detail.startsWith("Your fill is on chain")).toBe(true);
			}
		}
	});

	test("a lost reason and an unknown reason both fail CLOSED to the reverted sentence", () => {
		for (const reason of [null, undefined, "", "something_new_nobody_decided"]) {
			const resolved = resolvePnl({ ...base, status: "failed", failureReason: reason });
			expect({ reason, detail: resolved.detail, onChain: failedButOnChain("failed", reason) }).toEqual({
				reason,
				detail: REVERTED_SENTENCE,
				onChain: false,
			});
		}
	});

	test("the quantity case keeps its own sentence; the two economics refusals share a sibling", () => {
		expect(onChainRefusalDetail(FILL_ON_CHAIN_UNPROVEN)).toContain("contract count could not be proven");
		expect(onChainRefusalDetail("filled_order_differs_from_prepared")).toBe(
			onChainRefusalDetail("debit_differs_from_prepared"),
		);
		expect(onChainRefusalDetail("filled_order_differs_from_prepared")).not.toBe(
			onChainRefusalDetail(FILL_ON_CHAIN_UNPROVEN),
		);
	});

	test("no non-`failed` status is ever treated as an on-chain refusal", () => {
		for (const status of ["pending", "confirmed", "indexed", "expired", "settled"] as const) {
			for (const reason of ON_CHAIN_REFUSAL_REASONS) {
				expect(failedButOnChain(status, reason)).toBe(false);
			}
		}
	});
});

describe("C-R4: the ONE set is what the whole view layer reads", () => {
	test("positionStatusDisplay gives every on-chain refusal the same chip, and reverts a different one", async () => {
		const { positionStatusDisplay, FILL_UNPROVEN_DISPLAY } = await import("@/lib/display");
		for (const [reason, family] of Object.entries(EXPECTED)) {
			const chip = positionStatusDisplay("failed", reason);
			expect({ reason, label: chip.label }).toEqual({
				reason,
				label: family === "on-chain" ? FILL_UNPROVEN_DISPLAY.label : "Failed",
			});
		}
	});

	test("a portfolio/feed row resolves the same sentence the position page does", async () => {
		const display = await import("@/lib/display");
		for (const reason of ON_CHAIN_REFUSAL_REASONS) {
			const row = display.position({
				id: "p1",
				thesisSlug: null,
				thesisHeadline: null,
				underlyingAsset: "ETH",
				side: "back",
				status: "failed",
				failureReason: reason,
				contracts: "1",
				entrySpotPriceUsd: null,
				expiryAt: null,
				economics: {
					finalPnlUsd: null,
					estimatedPnlUsd: null,
					settlementPriceUsd: null,
					maximumLossUsd: "5",
				},
				verification: { transactionHash: null },
			} as never);
			expect({ reason, basis: row.pnlBasisLabel, label: row.statusLabel }).toEqual({
				reason,
				basis: onChainRefusalDetail(reason),
				label: "Not tracked yet",
			});
		}
	});
});
