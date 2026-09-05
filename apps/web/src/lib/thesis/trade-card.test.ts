import { expect, test } from "bun:test";
import * as display from "../display";
import type * as Domain from "@/types";
import { attachLinkedPositions, enrichWithTradeLinks, linkedPositionIds } from "./enrich";

const P1 = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01";
const P2 = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f02";

const owner: Domain.Creator = {
	id: "u1", walletAddress: "0x00000000000000000000000000000000000000aa",
	displayName: "merkle_mike", handle: "merkle_mike", initials: "MK",
	mockWalletFragment: null, sinceLabel: null, winRatePct: null, thesesCount: null,
	followers: null, netPnlUsd: null, verifiedPnl30dUsd: null, biggestLossUsd: null,
};

function position(overrides: Partial<Domain.Position> = {}): Domain.Position {
	return {
		id: P1, thesisId: "t1", userId: "u1", role: "creator", side: "back",
		status: "indexed", chainId: 8453, walletAddress: "0x0", thesisSlug: "s",
		thesisHeadline: "h", underlyingAsset: "BTC", contracts: "0.0126",
		entrySpotPriceUsd: null,
		economics: {
			entryPremiumUsd: "1000", entryFeesUsd: null, maximumLossUsd: "1000",
			maximumPayoutUsd: "4612", breakEvenPricesUsd: [], estimatedPnlUsd: "612",
			finalPnlUsd: null, settlementPriceUsd: null,
		},
		verification: { transactionHash: null, optionAddress: null, confirmedOnchain: false },
		createdAt: "2026-09-04T17:42:00Z", mockTransactionFragment: null,
		...overrides,
	};
}

function post(rationale: string | null): Domain.Thesis {
	return {
		id: "t1", slug: "s", creatorUserId: "u1", creator: owner,
		thesis: { id: "t1", headline: "H", rationale, direction: null, status: "open", createdAt: "2026-09-04T17:42:00Z" },
		dataAsOf: "2026-09-04T18:00:00Z", market: null, structure: null, backing: null,
		endingSoon: false, likes: 0, likedByViewer: false, commentCount: 0,
	};
}

test("tradeCard maps an open position: signed P&L, percent of risked, three tiles", () => {
	const card = display.tradeCard({ position: position(), owner });
	expect(card).toMatchObject({
		positionId: P1,
		href: `/p/${P1}`,
		statusLabel: "INDEXED",
		settled: false,
		instrumentLabel: "BTC",
		side: "bull",
		sideLabel: "Bull",
		pnlLabel: "Live P&L",
		pnlPct: { value: "+61.2%", basis: "of risked" },
	});
	expect(card.pnlUsd.signed).toBe("+$612");
	expect(card.pnlUsd.pnlClass).toBe("bull");
	expect(card.stats).toEqual([
		{ label: "Risked", value: "$1,000" },
		{ label: "Premium", value: "$1,000" },
		{ label: "Max payout", value: "$4,612" },
	]);
});

test("a settled position reads its final P&L and says Result", () => {
	const card = display.tradeCard({
		position: position({
			status: "settled",
			economics: { ...position().economics, estimatedPnlUsd: "612", finalPnlUsd: "-250" },
		}),
		owner,
	});
	expect(card.settled).toBe(true);
	expect(card.pnlLabel).toBe("Result");
	expect(card.pnlUsd.signed).toBe("−$250");
	expect(card.pnlUsd.pnlClass).toBe("bear");
	expect(card.pnlPct).toEqual({ value: "−25.0%", basis: "of risked" });
});

test("missing figures render as em dashes and no percent, never as zero", () => {
	const card = display.tradeCard({
		position: position({
			side: "counter",
			economics: {
				entryPremiumUsd: null, entryFeesUsd: null, maximumLossUsd: null,
				maximumPayoutUsd: null, breakEvenPricesUsd: [], estimatedPnlUsd: null,
				finalPnlUsd: null, settlementPriceUsd: null,
			},
		}),
		owner,
	});
	expect(card.pnlUsd.signed).toBe("—");
	expect(card.pnlPct).toBeNull();
	expect(card.sideLabel).toBe("Bear");
	expect(card.side).toBe("bear");
	expect(card.stats.map((stat) => stat.value)).toEqual(["—", "—", "—"]);
});

test("a zero risked base yields no percent rather than a division", () => {
	const card = display.tradeCard({
		position: position({ economics: { ...position().economics, maximumLossUsd: "0" } }),
		owner,
	});
	expect(card.pnlPct).toBeNull();
	expect(card.pnlUsd.signed).toBe("+$612");
});

test("a zero P&L is signless", () => {
	const card = display.tradeCard({
		position: position({ economics: { ...position().economics, estimatedPnlUsd: "0" } }),
		owner,
	});
	expect(card.pnlPct).toEqual({ value: "0.0%", basis: "of risked" });
});

test("linkedPositionIds collects across posts, in order, without duplicates", () => {
	expect(linkedPositionIds([post(`a /p/${P2}`), post(null), post(`b /p/${P1}, /p/${P2}`)])).toEqual([P2, P1]);
});

test("attachLinkedPositions returns new objects and never mutates the input", () => {
	const original = post(`/p/${P1}`);
	const frozen = JSON.stringify(original);
	const [attached] = attachLinkedPositions([original], new Map([[P1, { position: position(), owner }]]));
	expect(attached?.linkedPositions).toHaveLength(1);
	expect(attached).not.toBe(original);
	expect(JSON.stringify(original)).toBe(frozen);
	expect(original.linkedPositions).toBeUndefined();
});

test("an unresolved link yields no card and leaves the post untouched", () => {
	const original = post(`/p/${P1}`);
	const [attached] = attachLinkedPositions([original], new Map());
	expect(attached).toBe(original);
	expect(display.thesis(attached!).tradeCards).toEqual([]);
});

test("cards follow the order the text links them, not the lookup order", async () => {
	const lookup = async () =>
		new Map([
			[P1, { position: position({ id: P1 }), owner }],
			[P2, { position: position({ id: P2 }), owner }],
		]);
	const [enriched] = await enrichWithTradeLinks([post(`/p/${P2} then /p/${P1}`)], lookup);
	expect(enriched?.linkedPositions?.map((entry) => entry.position.id)).toEqual([P2, P1]);
	expect(display.thesis(enriched!).tradeCards?.map((card) => card.positionId)).toEqual([P2, P1]);
});

test("a post with no links never calls the lookup", async () => {
	let calls = 0;
	await enrichWithTradeLinks([post("plain opinion"), post(null)], async () => {
		calls += 1;
		return new Map();
	});
	expect(calls).toBe(0);
});

test("display.thesis turns the rationale into tokens with a clickable link", () => {
	const view = display.thesis(post(`filled /p/${P1} today`));
	expect(view.noteTokens?.filter((token) => token.kind === "link")).toEqual([
		{ kind: "link", label: `/p/${P1}`, href: `/p/${P1}`, positionId: P1 },
	]);
	expect(view.noteTokens?.map((t) => (t.kind === "text" ? t.value : t.label)).join("")).toBe(
		`filled /p/${P1} today`,
	);
});

test("a post with no rationale carries no tokens and no cards", () => {
	const view = display.thesis(post(null));
	expect(view.noteTokens).toBeUndefined();
	expect(view.tradeCards).toEqual([]);
});

test("an absolute link only unfurls when the origin is supplied", () => {
	const text = `https://thesis.fun/p/${P1}`;
	expect(display.thesis(post(text)).tradeCards).toEqual([]);
	expect(linkedPositionIds([post(text)])).toEqual([]);
	expect(linkedPositionIds([post(text)], "https://thesis.fun")).toEqual([P1]);
});
