/**
 * D-n2 (lane D confirming pass). ONE status, ONE chip class.
 *
 * The three list rows built the class by hand as `chip ${statusTone}` — which
 * emits `chip settled`, a class `index.css` does not define (it defines only
 * `.chip` and `.chip.flat`), so a settled row fell back to the plain ACCENT
 * chip while `PnlCard` drew the same settled position with `chip flat`. The
 * reviewer measured:
 *
 *   ROW  ["<span class=\"chip settled\">Settled"]
 *   CARD ["<span class=\"chip flat\">Settled"]
 *
 * These assert the RENDERED class from each surface, not the source: the bug
 * was a template string that looked right.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PositionRow } from "@/components/feed/thesis-list";
import { PositionRows } from "@/components/thesis/position-rows";
import { PnlCard } from "@/components/position/pnl-card";
import { linkedPositionCard } from "@/lib/position/view";
import { position as toView } from "@/lib/display";
import type * as Domain from "@/types";

const owner: Domain.Creator = {
	id: "u1", walletAddress: "0x00000000000000000000000000000000000000aa",
	displayName: "merkle_mike", handle: "merkle_mike", initials: "MK",
	mockWalletFragment: null, sinceLabel: null, winRatePct: null, thesesCount: null,
	followers: null, netPnlUsd: null, verifiedPnl30dUsd: null, biggestLossUsd: null,
};

function row(status: Domain.PositionStatus): Domain.Position {
	return {
		id: "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01", thesisId: null, userId: "u1",
		role: "standalone", side: "back", status, chainId: 8453,
		walletAddress: "0x00000000000000000000000000000000000000aa",
		thesisSlug: null, thesisHeadline: "h", underlyingAsset: "BTC",
		contracts: "0.0126", entrySpotPriceUsd: null,
		economics: {
			entryPremiumUsd: "1000", entryFeesUsd: null, maximumLossUsd: "1000",
			maximumPayoutUsd: "4612", breakEvenPricesUsd: [],
			estimatedPnlUsd: "612", finalPnlUsd: "-12.5", settlementPriceUsd: null,
		},
		verification: { transactionHash: null, optionAddress: null, confirmedOnchain: false },
		createdAt: "2026-09-04T17:42:00Z", mockTransactionFragment: null,
	};
}

/** Every `class="chip …"` in a fragment of markup, in document order. */
function chips(html: string): string[] {
	return [...html.matchAll(/class="(chip[^"]*)"/g)].map((match) => match[1] ?? "");
}

for (const status of ["settled", "indexed", "expired"] as const) {
	test(`D-n2: a ${status} position renders the SAME chip class in the list and on the card`, () => {
		const view = toView(row(status));
		const card = linkedPositionCard({ position: row(status), owner });
		expect(card.statusLabel).toBe(view.statusLabel);

		const feedRow = chips(renderToStaticMarkup(<PositionRow position={view} />));
		const listRows = chips(renderToStaticMarkup(<PositionRows rows={[view]} />));
		const compact = chips(renderToStaticMarkup(<PnlCard card={card} compact />));
		const share = chips(renderToStaticMarkup(<PnlCard card={card} />));

		expect(feedRow).toHaveLength(1);
		expect(listRows).toHaveLength(1);
		expect(compact).toHaveLength(1);
		expect(share).toHaveLength(1);
		expect(new Set([...feedRow, ...listRows, ...compact, ...share]).size).toBe(1);
	});
}

test("D-n2: the class is one the stylesheet actually defines", async () => {
	const css = await Bun.file(new URL("../../index.css", import.meta.url)).text();
	const settled = chips(renderToStaticMarkup(<PositionRow position={toView(row("settled"))} />))[0];
	const open = chips(renderToStaticMarkup(<PositionRow position={toView(row("indexed"))} />))[0];
	// The mockup's two chips, and nothing invented beside them.
	expect(settled).toBe("chip flat");
	expect(open).toBe("chip");
	expect(css).toContain(".chip.flat{");
	// The bug's fingerprint: a class nobody styles.
	expect(css).not.toContain(".chip.settled");
	for (const emitted of [settled ?? "", open ?? ""]) {
		for (const token of emitted.split(" ").slice(1)) {
			expect(css, `.chip.${token} is not defined`).toContain(`.chip.${token}{`);
		}
	}
});
