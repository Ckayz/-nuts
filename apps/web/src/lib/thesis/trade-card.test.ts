import { expect, test } from "bun:test";
import * as display from "../display";
import { backingCard, linkedPositionCard, withCards } from "../position/view";
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

test("linkedPositionCard maps an open position through the ONE card builder", () => {
	const card = linkedPositionCard({ position: position(), owner });
	expect(card).toMatchObject({
		id: P1,
		// Round-1 fold item 7: the chip is the shared vocabulary, never the raw
		// status uppercased ("INDEXED" used to reach users here).
		statusLabel: "Open",
		statusTone: "live",
		instrumentLabel: "BTC",
		side: "bull",
		sideLabel: "Bull",
		pnlLabel: "Live P&L",
		pnlPctLabel: "+61.2% of max loss",
		// Round-1 fold item 10: the date the builder has, not "@owner".
		dateLabel: "4 Sep 2026",
	});
	expect(card.pnl.signed).toBe("+$612");
	expect(card.pnl.pnlClass).toBe("bull");
	// Round-1 fold item 11: ONE tile set, produced by the card builder.
	expect(card.stats).toEqual([
		{ label: "Premium paid", value: "$1,000.00" },
		{ label: "Max loss", value: "$1,000.00" },
		{ label: "Max payout", value: "$4,612.00" },
	]);
});

test("the backing card and a linked card of the same fill agree", () => {
	const backed: Domain.Thesis = {
		...post(null),
		backing: {
			creatorPositionId: P1,
			economics: position().economics,
			verification: { transactionHash: null, optionAddress: null, confirmedOnchain: true },
			pooledUsd: null,
			bull: { pct: 0, count: 0, amountUsd: null, signed: false },
			bear: { pct: 0, count: 0, amountUsd: null, signed: false },
			mock: {
				settledAgoMinutes: null, settledWinner: null, maxPayoutMultiple: null,
				premiumPerContractUsd: null, payoutPerContractUsd: null, transactionFragment: null,
			},
		},
		market: { chainId: 8453, underlyingAsset: "BTC", currentSpotPriceUsd: null, expiryAt: "2026-09-11T08:00:00Z" },
		structure: {
			productType: "put spread", isCall: false, isLong: true,
			strikesUsd: ["78000", "74000"], collateralSymbol: null, contracts: null,
			legs: [],
		},
	};
	const card = backingCard(backed)!;
	const linked = linkedPositionCard({ position: position(), owner });
	expect(card.pnl.signed).toBe(linked.pnl.signed);
	expect(card.stats).toEqual(linked.stats);
	expect(card.statusLabel).toBe("Open");
	// The post knows its structure, so the card carries the mockup's split lines.
	expect(card.instrumentLabel).toBe("BTC put spread");
	expect(card.strikesLabel).toBe("78,000 / 74,000 P");
	expect(card.expiryLabel).toBe("11 Sep");
	expect(card.expiryFullLabel).toBe("11 Sep 26 08:00 UTC");
});

test("a post that links the position that backs it renders ONE card", () => {
	const backed: Domain.Thesis = {
		...post(`my trade: /p/${P1}`),
		backing: {
			creatorPositionId: P1,
			economics: position().economics,
			verification: { transactionHash: null, optionAddress: null, confirmedOnchain: true },
			pooledUsd: null,
			bull: { pct: 0, count: 0, amountUsd: null, signed: false },
			bear: { pct: 0, count: 0, amountUsd: null, signed: false },
			mock: {
				settledAgoMinutes: null, settledWinner: null, maxPayoutMultiple: null,
				premiumPerContractUsd: null, payoutPerContractUsd: null, transactionFragment: null,
			},
		},
		linkedPositions: [
			{ position: position({ id: P1 }), owner },
			{ position: position({ id: P2 }), owner },
		],
	};
	const view = withCards(display.thesis(backed), backed);
	expect(view.backingCard?.id).toBe(P1);
	// P1 is the backing fill and is not drawn twice; P2 is somebody's other trade.
	expect(view.tradeCards?.map((card) => card.id)).toEqual([P2]);
});

test("a settled position reads its final P&L and says Result", () => {
	const card = linkedPositionCard({
		position: position({
			status: "settled",
			economics: { ...position().economics, estimatedPnlUsd: "612", finalPnlUsd: "-250" },
		}),
		owner,
	});
	expect(card.statusLabel).toBe("Settled");
	expect(card.statusTone).toBe("settled");
	expect(card.pnlLabel).toBe("Result");
	expect(card.pnl.signed).toBe("−$250");
	expect(card.pnl.pnlClass).toBe("bear");
	expect(card.pnlPctLabel).toBe("−25.0% of max loss");
	// PRD 14: a settled row never promotes the estimate into the result.
	expect(card.basis).toBe("settled");
});

test("missing figures render as em dashes and no percent, never as zero", () => {
	const card = linkedPositionCard({
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
	expect(card.pnl.signed).toBe("—");
	expect(card.pnlPctLabel).toBeNull();
	expect(card.sideLabel).toBe("Bear");
	expect(card.side).toBe("bear");
	expect(card.stats.map((stat: { value: string }) => stat.value)).toEqual(["—", "—", "—"]);
});

test("a zero risked base yields no percent rather than a division", () => {
	const card = linkedPositionCard({
		position: position({ economics: { ...position().economics, maximumLossUsd: "0" } }),
		owner,
	});
	expect(card.pnlPctLabel).toBeNull();
	expect(card.pnl.signed).toBe("+$612");
});

test("a zero P&L is signless", () => {
	const card = linkedPositionCard({
		position: position({ economics: { ...position().economics, estimatedPnlUsd: "0" } }),
		owner,
	});
	expect(card.pnlPctLabel).toBe("0.0% of max loss");
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
	expect(withCards(display.thesis(attached!), attached!).tradeCards).toEqual([]);
});

test("cards follow the order the text links them, not the lookup order", async () => {
	const lookup = async () =>
		new Map([
			[P1, { position: position({ id: P1 }), owner }],
			[P2, { position: position({ id: P2 }), owner }],
		]);
	const [enriched] = await enrichWithTradeLinks([post(`/p/${P2} then /p/${P1}`)], lookup);
	expect(enriched?.linkedPositions?.map((entry) => entry.position.id)).toEqual([P2, P1]);
	expect(withCards(display.thesis(enriched!), enriched!).tradeCards?.map((card) => card.id)).toEqual([P2, P1]);
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
	const source = post(null);
	const view = withCards(display.thesis(source), source);
	expect(view.noteTokens).toBeUndefined();
	expect(view.tradeCards).toEqual([]);
	expect(view.backingCard).toBeNull();
});

test("an absolute link only unfurls when the origin is supplied", () => {
	const text = `https://thesis.fun/p/${P1}`;
	expect(withCards(display.thesis(post(text)), post(text)).tradeCards).toEqual([]);
	expect(linkedPositionIds([post(text)])).toEqual([]);
	expect(linkedPositionIds([post(text)], "https://thesis.fun")).toEqual([P1]);
});

test("headline-only same-origin links unfurl; foreign headline URLs do not", async () => {
	const origin = "https://thesis.fun";
	const base = post(null);
	const headline = { ...base, thesis: { ...base.thesis, headline: `${origin}/p/${P1}` } };
	expect(linkedPositionIds([headline], origin)).toEqual([P1]);
	const resolved = new Map([[P1, { position: position(), owner }]]);
	const [enriched] = await enrichWithTradeLinks([headline], async () => resolved, origin);
	expect(enriched?.linkedPositions?.map(row => row.position.id)).toEqual([P1]);
	expect(linkedPositionIds([{ ...headline, thesis: { ...headline.thesis, headline: `https://foreign.example/p/${P1}` } }], origin)).toEqual([]);
});

test("headline and rationale share one deduplicated card cap", () => {
	const ids = Array.from({ length: 6 }, (_, i) => `9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f0${i}`);
	const base = post(ids.map(id => `/p/${id}`).join(" "));
	const row = { ...base, thesis: { ...base.thesis, headline: `/p/${ids[0]} /p/${ids[1]}` } };
	expect(linkedPositionIds([row])).toEqual(ids.slice(0, 4));
});
