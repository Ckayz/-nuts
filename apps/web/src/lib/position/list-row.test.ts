/**
 * D5 (lane D confirming pass). A list row and the position card must agree.
 *
 * The reviewer's fixture: a `confirmed` row whose option expired on
 * 2026-09-01, rendered on 2026-09-05. Before this round:
 *   row  {"status":"Open · syncing","pnl":"+$612","basis":"estimate"}
 *   card {"status":"Settlement pending","pnl":"—","basis":"unavailable"}
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PNL_BASIS_SHORT, position as positionRow } from "@/lib/display";
import { pnlCardFor } from "./view";
import { PositionRow } from "@/components/feed/thesis-list";
import { PositionRows } from "@/components/thesis/position-rows";
import type * as Domain from "@/types";

const OWNER: Domain.Creator = {
	id: "11110000-0000-4000-8000-000000000001",
	walletAddress: "0x00000000000000000000000000000000feed1001",
	displayName: "Alice Probe",
	handle: "alice_probe",
	initials: "AP",
	mockWalletFragment: null,
	sinceLabel: "since Sep 26",
	winRatePct: null,
	thesesCount: null,
	followers: null,
	netPnlUsd: null,
	verifiedPnl30dUsd: null,
	biggestLossUsd: null,
};

const ASOF = new Date("2026-09-05T12:00:00.000Z");
const EXPIRED = "2026-09-01T08:00:00.000Z";
const LIVE = "2026-09-25T08:00:00.000Z";

function domainPosition(over: Partial<Domain.Position> = {}): Domain.Position {
	return {
		id: "33330000-0000-4000-8000-000000000001",
		thesisId: null,
		userId: OWNER.id,
		role: "standalone",
		side: "back",
		status: "confirmed",
		chainId: 8453,
		walletAddress: OWNER.walletAddress,
		thesisSlug: null,
		thesisHeadline: null,
		underlyingAsset: "BTC",
		contracts: "0.0126",
		entrySpotPriceUsd: null,
		economics: {
			entryPremiumUsd: "1000",
			entryFeesUsd: null,
			maximumLossUsd: "1000",
			maximumPayoutUsd: "5000",
			breakEvenPricesUsd: ["74000"],
			estimatedPnlUsd: "612",
			finalPnlUsd: null,
			settlementPriceUsd: null,
		} as unknown as Domain.Position["economics"],
		verification: { transactionHash: `0x${"ab".repeat(32)}`, optionAddress: null, confirmedOnchain: true },
		expiryAt: EXPIRED,
		createdAt: "2026-08-20T05:12:00.000Z",
		mockTransactionFragment: null,
		...over,
	} as Domain.Position;
}

/** The card the position page and every share surface build. */
function card(value: Domain.Position) {
	return pnlCardFor({
		detail: { position: value, owner: OWNER, instrument: null, quantities: null, thesis: null },
		spotUsd8: null,
		collateralUsdPrice8: null,
		asOf: ASOF,
	});
}

describe("D5: the row and the card resolve one lifecycle and one P&L", () => {
	test("the reviewer's fixture — an expired option agrees in both places", () => {
		const value = domainPosition();
		const row = positionRow(value, ASOF);
		const shown = card(value);

		expect({ status: row.statusLabel, pnl: row.livePnlUsd.signed, basis: row.basis }).toEqual({
			status: "Settlement pending",
			pnl: "—",
			basis: "unavailable",
		});
		expect(row.statusLabel).toBe(shown.statusLabel);
		expect(row.basis).toBe(shown.basis);
		expect(row.livePnlUsd.signed).toBe(shown.pnl.signed);
		expect(row.pnlBasisLabel).toBe(shown.pnlBasisLabel);
	});

	test("a live option still shows its recorded estimate, and still agrees", () => {
		const value = domainPosition({ expiryAt: LIVE });
		const row = positionRow(value, ASOF);
		const shown = card(value);
		expect(row.basis).toBe("estimate");
		expect(row.livePnlUsd.signed).toBe("+$612");
		expect(row.statusLabel).toBe(shown.statusLabel);
		expect(row.livePnlUsd.signed).toBe(shown.pnl.signed);
	});

	test("an undecodable snapshot leaves the stored status alone, in both places", () => {
		const value = domainPosition({ expiryAt: null });
		const row = positionRow(value, ASOF);
		expect(row.statusLabel).toBe("Open · syncing");
		expect(row.statusLabel).toBe(card(value).statusLabel);
	});

	test("a quantity-unproven fill reads the same in a row as on its page (C#9)", () => {
		const value = domainPosition({ status: "failed", failureReason: "fill_quantity_unproven" });
		const row = positionRow(value, ASOF);
		expect(row.statusLabel).toBe("Not tracked yet");
		expect(row.pnlBasisLabel).toContain("Your fill is on chain");
		expect(row.statusLabel).toBe(card(value).statusLabel);
	});
});

describe("D5: the status and the basis are VISIBLE, not hover-only", () => {
	const row = positionRow(domainPosition(), ASOF);

	test("the feed / portfolio row prints both", () => {
		const html = renderToStaticMarkup(PositionRow({ position: row }));
		expect(html).toContain("Settlement pending");
		expect(html).toContain(PNL_BASIS_SHORT.unavailable);
	});

	test("the thread / profile rows print the basis, not only a title attribute", () => {
		const html = renderToStaticMarkup(PositionRows({ rows: [row] }));
		expect(html).toContain("Settlement pending");
		const withoutTitles = html.replace(/title="[^"]*"/g, "");
		expect(withoutTitles).toContain(PNL_BASIS_SHORT.unavailable);
	});
});
