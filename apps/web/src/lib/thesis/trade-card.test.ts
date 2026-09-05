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

/**
 * C8. A linked card used to be built with `instrument: null`, which routes the
 * card builder down its BUYER branch: a taker-SELL fill printed "Premium paid"
 * next to the premium it RECEIVED, and the asset came from the post's tag
 * rather than from the order that was filled.
 */
test("C8: a SELLER's linked card locks collateral instead of paying a premium", () => {
	const seller = linkedPositionCard({
		position: position({ underlyingAsset: "" }),
		owner,
		instrument: {
			asset: "ETH",
			isCall: false,
			// isLong true on the maker -> the TAKER SELLS (chain-verified rule).
			takerSide: "sell",
			strikesUsd8: ["230000000000"],
			ascendingStrikesUsd8: ["230000000000"],
			expiryAt: "2026-12-31T08:00:00.000Z",
			implementationName: "PUT",
			structureId: "0123456789abcdef",
			collateralAddress: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
			collateralSymbol: "aBasUSDC",
			collateralDecimals: 6,
			riskKind: "put",
		},
		quantities: {
			contracts: "500",
			contractDecimals: 6,
			premium: "9009",
			premiumDecimals: 6,
			fees: "737",
			feeDecimals: 6,
			collateral: "1150000",
			collateralDecimals: 6,
		},
	}, new Date("2026-09-05T08:00:00Z"), "100000000");

	// The seller's own tile, not the buyer's.
	expect(seller.stats[0]?.label).toBe("Collateral locked");
	expect(seller.stats[0]?.label).not.toBe("Premium paid");
	// $1.15 of collateral: 1,150,000 base units at 6 decimals, valued at 1 USD.
	expect(seller.stats[0]?.value).toBe("$1.15");
	// The asset comes from the ORDER's price feed, not from the post's tag: the
	// position row above carries no underlying asset at all.
	expect(seller.instrumentLabel).toContain("ETH");

	// The same fill with no instrument is the pre-fold behaviour, and it is wrong.
	const blind = linkedPositionCard({ position: position({ underlyingAsset: "" }), owner });
	expect(blind.stats[0]?.label).toBe("Premium paid");
	expect(blind.instrumentLabel).not.toContain("ETH");
});

test("C8: a BUYER's linked card still pays a premium", () => {
	const buyer = linkedPositionCard({
		position: position(),
		owner,
		instrument: {
			asset: "BTC",
			isCall: false,
			takerSide: "buy",
			strikesUsd8: ["7400000000000"],
			ascendingStrikesUsd8: ["7400000000000"],
			expiryAt: "2026-12-31T08:00:00.000Z",
			implementationName: "PUT",
			structureId: "0123456789abcdef",
			collateralAddress: "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
			collateralSymbol: "aBasUSDC",
			collateralDecimals: 6,
			riskKind: "put",
		},
		quantities: {
			contracts: "389926",
			contractDecimals: 6,
			premium: "999998",
			premiumDecimals: 6,
			fees: "124999",
			feeDecimals: 6,
			collateral: "0",
			collateralDecimals: 6,
		},
	}, new Date("2026-09-05T08:00:00Z"), "100000000");
	expect(buyer.stats[0]?.label).toBe("Premium paid");
	expect(buyer.instrumentLabel).toContain("BTC");
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
