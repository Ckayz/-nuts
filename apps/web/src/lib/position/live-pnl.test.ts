/// <reference types="bun" />
import { expect, test } from "bun:test";

import type * as Domain from "@/types";
import * as display from "@/lib/display";
import { positionInstrument } from "./instrument";
import { derivePnlAtSpot } from "./pnl";
import type { LivePriceBook } from "./types";
import {
	NO_LIVE_PRICES,
	cardPriceKeys,
	derivationFor,
	linkedPositionCard,
	listRowPnl,
	positionPage,
	rowPriceKeys,
	withCards,
} from "./view";

/**
 * B1 (user-flow re-walk 2026-09-06): every social surface printed
 * "— Live P&L · not available yet" while `/p/<id>` computed the figure for the
 * SAME row, at the same minute, on the same server. Measured before the fix on
 * position `69125d9b-38e3-4280-9119-61ee46fefff4` (a replay of the documented
 * Base fill `0x9c4bb145…828f8c`, which is where the numbers below come from):
 *
 *   /p/<id>                     "−$1.00"   basis "derived"
 *   /u/<handle> positions row   "—"        "Live P&L · not available yet"
 *   /new?link=/p/<id> preview   "—"        "Live P&L · not available yet"
 *
 * The pin is an EQUALITY, not a literal: whatever the risk model says at a given
 * spot, the card, the list row and the position page must all say it.
 */

const ORDER_SNAPSHOT = {
	order: {
		maker: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
		nonce: "66204603414887816953614478114089474291546535720490116488777793285874330342942",
		price: "256458427",
		taker: "0x0000000000000000000000000000000000000000",
		expiry: "1788768000",
		option: "0x96C2c0d1d1aD8Ea8483B8294B802352363b16422",
		isBuyer: true,
		numContracts: "389926",
	},
	version: 1,
	signature: "0x25",
	rawApiData: {
		isCall: false,
		isLong: false,
		strikes: ["234000000000"],
		priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
		collateral: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		implementation: "0x7355EB92dfb0503DB558a70c10843618932ab290",
		extraOptionData: "0x",
		maxCollateralUsable: "10000000000",
		orderExpiryTimestamp: 1788559332,
	},
	makerAddress: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
	availableAmount: "10000000000",
};

const INSTRUMENT = positionInstrument(ORDER_SNAPSHOT);

const QUANTITIES = {
	contracts: "389926",
	contractDecimals: 6,
	premium: "999998",
	premiumDecimals: 6,
	fees: "124999",
	feeDecimals: 6,
	collateral: "0",
	collateralDecimals: 6,
} as const;

const OWNER: Domain.Creator = {
	id: "u1",
	walletAddress: "0xb792296be8202ba2fc5d3276fa184e5b479920e3",
	displayName: null,
	handle: "0xb792296be8202ba2fc5d3276fa184e5b479920e3",
	initials: "B7",
	mockWalletFragment: null,
	sinceLabel: null,
	winRatePct: null,
	thesesCount: null,
	followers: null,
	netPnlUsd: null,
	verifiedPnl30dUsd: null,
	biggestLossUsd: null,
};

const ASSET = INSTRUMENT?.asset ?? "";
const COLLATERAL = INSTRUMENT?.collateralSymbol ?? "";
/** $2,478.37 at 8 decimals — the spot the pre-fix measurement was taken at. */
const SPOT_USD8 = "247837000000";
const PEG_USD8 = "100000000";

/** The book the page resolves once and hands to every builder. */
const BOOK: LivePriceBook = {
	spotUsd8: (asset) => (asset === ASSET ? SPOT_USD8 : null),
	collateralUsdPrice8: (symbol) => (symbol === COLLATERAL ? PEG_USD8 : null),
	feedError: null,
};

/** Same collateral price, no spot: the honest shape when the feed is unreadable. */
const NO_SPOT: LivePriceBook = {
	spotUsd8: () => null,
	collateralUsdPrice8: (symbol) => (symbol === COLLATERAL ? PEG_USD8 : null),
	feedError: "feed down",
};

const ASOF = new Date("2026-09-06T00:00:00Z");

function row(overrides: Partial<Domain.Position> = {}): Domain.Position {
	return {
		id: "69125d9b-38e3-4280-9119-61ee46fefff4",
		thesisId: null,
		userId: "u1",
		role: "standalone",
		side: "back",
		// The status the seeded replay wrote: confirmed on chain, not yet indexed,
		// so NO estimate column exists and the derived figure is the only one.
		status: "confirmed",
		chainId: 8453,
		walletAddress: OWNER.walletAddress,
		thesisSlug: null,
		thesisHeadline: null,
		underlyingAsset: ASSET,
		contracts: "0.389926",
		entrySpotPriceUsd: null,
		economics: {
			entryPremiumUsd: "0.999998",
			entryFeesUsd: "0.124999",
			maximumLossUsd: "0.999998",
			maximumPayoutUsd: null,
			breakEvenPricesUsd: [],
			estimatedPnlUsd: null,
			finalPnlUsd: null,
			settlementPriceUsd: null,
		},
		verification: {
			transactionHash: "0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c",
			optionAddress: null,
			confirmedOnchain: true,
		},
		expiryAt: INSTRUMENT?.expiryAt ?? null,
		instrument: INSTRUMENT,
		quantities: QUANTITIES,
		createdAt: "2026-09-05T12:00:00Z",
		mockTransactionFragment: null,
		...overrides,
	};
}

function pageCard(prices: LivePriceBook) {
	const source = row();
	return positionPage({
		detail: {
			position: source,
			owner: OWNER,
			instrument: INSTRUMENT,
			quantities: QUANTITIES,
			thesis: null,
		},
		spotUsd8: prices.spotUsd8(ASSET),
		collateralUsdPrice8: prices.collateralUsdPrice8(COLLATERAL),
		asOf: ASOF,
	}).card;
}

test("the fixture really is derivable, and the risk model really produces a figure", () => {
	// Guards the whole file: if the snapshot stopped decoding, every equality
	// below would hold vacuously at "—".
	expect(INSTRUMENT).not.toBeNull();
	expect(ASSET).toBe("ETH");
	expect(COLLATERAL).toBe("USDC");
	const derivation = derivationFor(
		{ position: row(), owner: OWNER, instrument: INSTRUMENT, quantities: QUANTITIES, thesis: null },
		PEG_USD8,
	);
	expect(derivation.inputs).not.toBeNull();
	expect(derivePnlAtSpot(derivation.inputs!, SPOT_USD8)).not.toBeNull();
});

test("a list row's live P&L is exactly what the risk model says at that spot", () => {
	const derivation = derivationFor(
		{ position: row(), owner: OWNER, instrument: INSTRUMENT, quantities: QUANTITIES, thesis: null },
		PEG_USD8,
	);
	const expected = derivePnlAtSpot(derivation.inputs!, SPOT_USD8);
	const live = listRowPnl(row(), BOOK);
	expect(live.spotUsd8).toBe(SPOT_USD8);
	expect(live.derivable).toBe(true);
	expect(live.derivedPnlUsd).toBe(expected);

	const view = display.position(row(), ASOF, live);
	expect(view.livePnlUsd.raw).toBe(expected!);
	expect(view.basis).toBe("derived");
	expect(view.pnlBasisLabel).not.toContain("not available yet");
});

test("the row, the linked card and the position page print the SAME money", () => {
	const page = pageCard(BOOK);
	const card = linkedPositionCard(
		{ position: row(), owner: OWNER, instrument: INSTRUMENT, quantities: QUANTITIES },
		ASOF,
		BOOK,
	);
	const listRow = display.position(row(), ASOF, listRowPnl(row(), BOOK));

	expect(page.pnl.raw).not.toBe("—");
	expect(page.basis).toBe("derived");
	expect(card.pnl.raw).toBe(page.pnl.raw);
	expect(listRow.livePnlUsd.raw).toBe(page.pnl.raw);
	expect(card.pnl.signed2).toBe(page.pnl.signed2);
	expect(listRow.livePnlUsd.signed2).toBe(page.pnl.signed2);
	expect(card.pnlBasisLabel).toBe(page.pnlBasisLabel);
});

test("a post's trade card is priced through withCards, not left at '—'", () => {
	const post: Domain.Thesis = {
		id: "t1",
		slug: "s",
		creatorUserId: "u1",
		creator: OWNER,
		thesis: {
			id: "t1",
			headline: "H",
			rationale: `See /p/${row().id} now`,
			direction: null,
			status: "open",
			createdAt: "2026-09-05T12:00:00Z",
		},
		dataAsOf: "2026-09-06T00:00:00Z",
		market: null,
		structure: null,
		backing: null,
		endingSoon: false,
		likes: 0,
		likedByViewer: false,
		commentCount: 0,
		linkedPositions: [{ position: row(), owner: OWNER, instrument: INSTRUMENT, quantities: QUANTITIES }],
	};

	// The keys a page collects to resolve ONE price book for the whole render.
	expect(cardPriceKeys([post])).toEqual({ assets: ["ETH"], collateralSymbols: ["USDC"] });
	expect(rowPriceKeys([row()])).toEqual({ assets: ["ETH"], collateralSymbols: ["USDC"] });

	const priced = withCards(display.thesis(post), post, ASOF, BOOK);
	expect(priced.tradeCards?.[0]?.pnl.raw).toBe(pageCard(BOOK).pnl.raw);
	expect(priced.tradeCards?.[0]?.basis).toBe("derived");

	// MUTANT GUARD: the pre-B1 call shape (no price book) is the failure the
	// tester photographed, and it must still be distinguishable from the fix.
	const unpriced = withCards(display.thesis(post), post, ASOF);
	expect(unpriced.tradeCards?.[0]?.pnl.raw).toBe("—");
	// "not available yet" is what the reader saw: PNL_BASIS_LABEL.unavailable.
	expect(unpriced.tradeCards?.[0]?.basis).toBe("unavailable");
});

test("an unreadable feed still refuses to invent a price, and says why", () => {
	const live = listRowPnl(row(), NO_SPOT);
	expect(live.derivable).toBe(true);
	expect(live.derivedPnlUsd).toBeNull();
	const view = display.position(row(), ASOF, live);
	expect(view.livePnlUsd.raw).toBe("—");
	// `derivable` is carried so the sentence names the feed, not a missing column.
	expect(view.pnlBasisLabel).toContain("price feed could not be read");

	// And with no book at all, the pre-B1 sentence is unchanged.
	const blind = display.position(row(), ASOF, listRowPnl(row(), NO_LIVE_PRICES));
	expect(blind.livePnlUsd.raw).toBe("—");
});

test("a row that carries no instrument is untouched by the live book", () => {
	const bare = row({ instrument: null, quantities: null, underlyingAsset: "" });
	const live = listRowPnl(bare, BOOK);
	expect(live.derivable).toBe(false);
	expect(live.derivedPnlUsd).toBeNull();
	expect(display.position(bare, ASOF, live).livePnlUsd.raw).toBe("—");
});

test("a settled row keeps its recorded result: no spot estimate may override it", () => {
	const settled = row({
		status: "settled",
		economics: { ...row().economics, finalPnlUsd: "12.5", settlementPriceUsd: "2500" },
	});
	const view = display.position(settled, ASOF, listRowPnl(settled, BOOK));
	expect(view.livePnlUsd.raw).toBe("12.5");
	expect(view.basis).toBe("settled");
});
