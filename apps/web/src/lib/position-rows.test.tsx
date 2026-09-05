/**
 * D5. A list row must state its lifecycle and the basis of its number.
 *
 * Portfolio, profile and rail rows used to carry `settled: boolean` alone, so
 * "Open · syncing", "Settlement pending" and "Failed" all rendered identically,
 * and the P&L beside them was printed with no statement of where it came from.
 * An expired position looked exactly like a live one.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { position } from "./display";
import { PositionRows } from "@/components/thesis/position-rows";
import type * as Domain from "@/types";

function row(overrides: Partial<Domain.Position> = {}): Domain.Position {
	return {
		id: "30000000-0000-4000-8000-000000000001",
		thesisId: null,
		userId: "u1",
		role: "standalone",
		side: "back",
		status: "indexed",
		chainId: 8453,
		walletAddress: "0x00000000000000000000000000000000000000aa",
		thesisSlug: null,
		thesisHeadline: null,
		underlyingAsset: "BTC",
		contracts: "0.0126",
		entrySpotPriceUsd: null,
		economics: {
			entryPremiumUsd: "1000",
			entryFeesUsd: null,
			maximumLossUsd: "1000",
			maximumPayoutUsd: "4612",
			breakEvenPricesUsd: [],
			estimatedPnlUsd: "612",
			finalPnlUsd: null,
			settlementPriceUsd: null,
		},
		verification: { transactionHash: null, optionAddress: null, confirmedOnchain: false },
		createdAt: "2026-09-04T17:42:00Z",
		mockTransactionFragment: null,
		...overrides,
	};
}

describe("D5: list rows carry the lifecycle vocabulary", () => {
	test("each status gets its own words, not one shared look", () => {
		const seen = new Map<Domain.PositionStatus, string>();
		for (const status of ["pending", "confirmed", "indexed", "expired", "settled", "failed"] as const) {
			seen.set(status, position(row({ status })).statusLabel);
		}
		expect(seen.get("pending")).toBe("Pending");
		expect(seen.get("confirmed")).toBe("Open · syncing");
		expect(seen.get("indexed")).toBe("Open");
		expect(seen.get("expired")).toBe("Settlement pending");
		expect(seen.get("settled")).toBe("Settled");
		expect(seen.get("failed")).toBe("Failed");
		// Six statuses, five distinct labels (`confirmed` and `indexed` are both
		// open, and the PRD words that difference as "syncing"), so no two
		// lifecycle states outside that pair render alike.
		expect(new Set(seen.values()).size).toBe(6);
	});

	test("an EXPIRED position does not render identically to an open one", () => {
		const open = position(row({ status: "indexed" }));
		const expired = position(row({ status: "expired" }));
		expect(expired.statusLabel).not.toBe(open.statusLabel);
		expect(expired.statusTone).not.toBe(open.statusTone);
		// PRD 14: a finished option shows its recorded result or NOTHING — never
		// the estimate that is still sitting in the row.
		expect(open.livePnlUsd.raw).toBe("612");
		// `amount(null)` renders every field as an em dash: no number at all.
		expect(expired.livePnlUsd.raw).toBe("\u2014");
		expect(expired.livePnlUsd.signed).toBe("\u2014");
		expect(expired.basis).toBe("unavailable");
		expect(expired.pnlBasisLabel).toContain("Settlement pending");
	});

	test("a settled row reads Result and uses the recorded final P&L", () => {
		const settled = position(
			row({ status: "settled", economics: { ...row().economics, finalPnlUsd: "-12.5", estimatedPnlUsd: "999" } }),
		);
		expect(settled.pnlLabel).toBe("Result");
		expect(settled.livePnlUsd.raw).toBe("-12.5");
		expect(settled.basis).toBe("settled");
		expect(position(row()).pnlLabel).toBe("Live P&L");
	});

	test("a failed or pending row shows no number and says why", () => {
		for (const status of ["failed", "pending"] as const) {
			const value = position(row({ status }));
			expect(value.livePnlUsd.raw).toBe("\u2014");
			expect(value.livePnlUsd.signed).toBe("\u2014");
			expect(value.basis).toBe("unavailable");
			expect(value.pnlBasisLabel.length).toBeGreaterThan(0);
		}
		expect(position(row({ status: "failed" })).pnlBasisLabel).toContain("failed");
		expect(position(row({ status: "pending" })).pnlBasisLabel).toContain("not been confirmed");
	});

	test("every row carries a basis sentence, never a bare number", () => {
		for (const status of ["pending", "confirmed", "indexed", "expired", "settled", "failed"] as const) {
			expect(position(row({ status })).pnlBasisLabel).not.toBe("");
		}
	});

	test("the rendered row prints the status chip and the basis", () => {
		const html = renderToStaticMarkup(
			<PositionRows rows={[position(row({ status: "expired" })), position(row({ status: "indexed" }))]} />,
		);
		expect(html).toContain("Settlement pending");
		expect(html).toContain("Open");
		expect(html).toContain("Live P&amp;L");
		// The basis reaches the markup as the number's own title.
		expect(html).toContain("title=");
	});
});
