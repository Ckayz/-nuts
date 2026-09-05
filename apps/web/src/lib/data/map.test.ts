/**
 * `map.ts` over hand-built rows. No database: these pin the row -> domain rules
 * that the integration suite then exercises against real Postgres output.
 *
 * The three post states DB round 7 allows are covered here (text only, tagged
 * market with no structure, structured + backed), together with the guards that
 * keep a `NaN` or negative `entry_premium_usd` off the split bar.
 */
import { describe, expect, test } from "bun:test";
import type { Position as PositionRow, Thesis as ThesisRow, User as UserRow } from "@nuts/db/schema/index";
import { emptyAggregates, mapPosition, mapThesis, sideAmountOrNull, type ThesisAggregates } from "./map";

const AS_OF = new Date("2026-09-05T12:00:00.000Z");
const CREATED = new Date("2026-09-05T10:00:00.000Z");
const EXPIRY = new Date("2026-09-11T08:00:00.000Z");

const user: UserRow = {
	id: "10000000-0000-4000-8000-000000000001",
	walletAddress: "0x00000000000000000000000000000000feed0001",
	displayName: "Alice Probe",
	bio: null,
	avatarUrl: null,
	createdAt: CREATED,
	updatedAt: CREATED,
};

/** Only the columns `map.ts` reads are meaningful; the rest carry schema defaults. */
function thesisRow(overrides: Partial<ThesisRow> = {}): ThesisRow {
	return {
		id: "20000000-0000-4000-8000-000000000001",
		creatorUserId: user.id,
		headline: "Text only post",
		rationale: null,
		direction: null,
		status: "open",
		taggedAsset: null,
		underlyingAsset: null,
		expiryAt: null,
		productType: null,
		isCall: null,
		isLong: null,
		strikes: null,
		strikeDecimals: null,
		collateralAddress: null,
		collateralSymbol: null,
		collateralDecimals: null,
		creatorOrderSnapshot: null,
		creatorPositionId: null,
		createdAt: CREATED,
		publishedAt: CREATED,
		expiredAt: null,
		settledAt: null,
		...overrides,
	};
}

const STRUCTURE: Partial<ThesisRow> = {
	taggedAsset: "BTC",
	underlyingAsset: "BTC",
	direction: "bull",
	expiryAt: EXPIRY,
	productType: "put spread",
	isCall: false,
	isLong: true,
	strikes: ["7800000000000", "7400000000000"],
	strikeDecimals: 8,
	collateralAddress: "0xc",
	collateralSymbol: "USDC",
	collateralDecimals: 6,
	creatorOrderSnapshot: {} as ThesisRow["creatorOrderSnapshot"],
};

function positionRow(overrides: Partial<PositionRow> = {}): PositionRow {
	return {
		id: "30000000-0000-4000-8000-000000000001",
		thesisId: "20000000-0000-4000-8000-000000000001",
		userId: user.id,
		role: "creator",
		side: "back",
		status: "confirmed",
		chainId: 8453,
		walletAddress: user.walletAddress,
		orderId: "o",
		orderHash: null,
		orderSnapshot: {} as PositionRow["orderSnapshot"],
		fillEvent: null,
		indexerPositionId: null,
		txHash: `0x${"1".repeat(64)}`,
		optionAddress: null,
		referrer: null,
		budget: "1000000",
		budgetDecimals: 6,
		contracts: "10000",
		contractDecimals: 6,
		premium: "1",
		premiumDecimals: 6,
		fees: "0",
		feeDecimals: 6,
		collateral: "1",
		collateralDecimals: 6,
		maximumLoss: null,
		maximumLossDecimals: null,
		maximumPayout: null,
		maximumPayoutDecimals: null,
		breakEvenPrices: [],
		breakEvenPriceDecimals: 8,
		estimatedPnl: null,
		estimatedPnlDecimals: null,
		settlementPrice: null,
		settlementPriceDecimals: null,
		payout: null,
		payoutDecimals: null,
		finalPnl: null,
		finalPnlDecimals: null,
		entryPremiumUsd: "250.00",
		entryFeesUsd: null,
		maximumLossUsd: "250.00",
		maximumPayoutUsd: "1150.00",
		breakEvenPricesUsd: ["76750.00"],
		estimatedPnlUsd: "12.50",
		finalPnlUsd: null,
		settlementPriceUsd: null,
		createdAt: CREATED,
		confirmedAt: CREATED,
		indexedAt: null,
		settledAt: null,
		...overrides,
	};
}

function aggregates(overrides: Partial<ThesisAggregates> = {}): ThesisAggregates {
	return { ...emptyAggregates, ...overrides };
}

describe("post states", () => {
	test("text only: no market, no structure, no backing", () => {
		const mapped = mapThesis({
			thesis: thesisRow(),
			creator: user,
			creatorPosition: null,
			aggregates: aggregates(),
			dataAsOf: AS_OF,
		});
		expect(mapped.market).toBeNull();
		expect(mapped.structure).toBeNull();
		expect(mapped.backing).toBeNull();
		expect(mapped.thesis.direction).toBeNull();
		expect(mapped.thesis.headline).toBe("Text only post");
	});

	test("tagged market with no structure: market only, expiry null", () => {
		const mapped = mapThesis({
			thesis: thesisRow({ taggedAsset: "ETH" }),
			creator: user,
			creatorPosition: null,
			aggregates: aggregates(),
			dataAsOf: AS_OF,
		});
		expect(mapped.market).toEqual({
			chainId: 8453,
			underlyingAsset: "ETH",
			currentSpotPriceUsd: null,
			expiryAt: null,
		});
		expect(mapped.structure).toBeNull();
		expect(mapped.backing).toBeNull();
	});

	test("structured but unbacked: structure without contracts, no backing", () => {
		const mapped = mapThesis({
			thesis: thesisRow(STRUCTURE),
			creator: user,
			creatorPosition: null,
			aggregates: aggregates(),
			dataAsOf: AS_OF,
		});
		expect(mapped.market?.expiryAt).toBe(EXPIRY.toISOString());
		expect(mapped.structure?.strikesUsd).toEqual(["78000", "74000"]);
		expect(mapped.structure?.legs).toEqual([
			{ strikeUsd: "78000", isCall: false, isLong: true },
			{ strikeUsd: "74000", isCall: false, isLong: true },
		]);
		expect(mapped.structure?.contracts).toBeNull();
		expect(mapped.backing).toBeNull();
	});

	test("backed: backing carries the creator's economics and the split", () => {
		const position = positionRow();
		const mapped = mapThesis({
			thesis: thesisRow({ ...STRUCTURE, creatorPositionId: position.id }),
			creator: user,
			creatorPosition: position,
			aggregates: aggregates({
				backCount: 3,
				counterCount: 1,
				backAmountUsd: "750.00",
				counterAmountUsd: "250.00",
			}),
			dataAsOf: AS_OF,
		});
		expect(mapped.backing?.creatorPositionId).toBe(position.id);
		expect(mapped.backing?.economics.maximumPayoutUsd).toBe("1150.00");
		expect(mapped.backing?.pooledUsd).toBe("1000");
		expect(mapped.backing?.bull.pct).toBe(75);
		expect(mapped.backing?.bear.pct).toBe(25);
		expect(mapped.structure?.contracts).toBe("0.01");
	});

	test("a linked position that was not fetched leaves backing null", () => {
		const mapped = mapThesis({
			thesis: thesisRow({ ...STRUCTURE, creatorPositionId: positionRow().id }),
			creator: user,
			creatorPosition: null,
			aggregates: aggregates(),
			dataAsOf: AS_OF,
		});
		expect(mapped.backing).toBeNull();
	});
});

describe("likes", () => {
	test("count and viewer flag come from the aggregates", () => {
		const mapped = mapThesis({
			thesis: thesisRow(),
			creator: user,
			creatorPosition: null,
			aggregates: aggregates({ likeCount: 7, likedByViewer: true, commentCount: 2 }),
			dataAsOf: AS_OF,
		});
		expect(mapped.likes).toBe(7);
		expect(mapped.likedByViewer).toBe(true);
		expect(mapped.commentCount).toBe(2);
	});
});

describe("side totals never reach BigInt with a bad value", () => {
	test.each([
		["NaN", null],
		["-500.00", null],
		["1e5", null],
		["+3", null],
		[" 12.50 ", "12.50"],
		["0", "0"],
		["7920.25", "7920.25"],
	])("sideAmountOrNull(%p) -> %p", (input, expected) => {
		expect(sideAmountOrNull(input as string)).toBe(expected as string | null);
	});

	test("sideAmountOrNull(null) is null", () => {
		expect(sideAmountOrNull(null)).toBeNull();
	});

	test.each([["NaN"], ["-500.00"]])(
		"a %s total degrades to unavailable instead of throwing or drawing a negative bar",
		(bad) => {
			const position = positionRow();
			const mapped = mapThesis({
				thesis: thesisRow({ ...STRUCTURE, creatorPositionId: position.id }),
				creator: user,
				creatorPosition: position,
				aggregates: aggregates({
					backCount: 1,
					counterCount: 1,
					backAmountUsd: bad,
					counterAmountUsd: "250.00",
				}),
				dataAsOf: AS_OF,
			});
			expect(mapped.backing?.bull.amountUsd).toBeNull();
			expect(mapped.backing?.bull.pct).toBe(0);
			expect(mapped.backing?.bear.pct).toBe(0);
			expect(mapped.backing?.pooledUsd).toBeNull();
		},
	);

	test("an all-zero split reports 0% Bull and 100% Bear, never a negative width", () => {
		const position = positionRow();
		const mapped = mapThesis({
			thesis: thesisRow({ ...STRUCTURE, creatorPositionId: position.id }),
			creator: user,
			creatorPosition: position,
			aggregates: aggregates({ backCount: 1, counterCount: 1 }),
			dataAsOf: AS_OF,
		});
		expect(mapped.backing?.bull.pct).toBe(0);
		expect(mapped.backing?.bear.pct).toBe(100);
	});
});

describe("mapPosition", () => {
	test("keeps the Back/Counter side the row carries", () => {
		const back = mapPosition({
			position: positionRow({ side: "back" }),
			thesis: { id: "20000000-0000-4000-8000-000000000001", headline: "h", underlyingAsset: "BTC", taggedAsset: "BTC" },
		});
		const counter = mapPosition({
			position: positionRow({ side: "counter" }),
			thesis: { id: "20000000-0000-4000-8000-000000000001", headline: "h", underlyingAsset: "BTC", taggedAsset: "BTC" },
		});
		expect(back.side).toBe("back");
		expect(counter.side).toBe("counter");
	});

	test("refuses a row that is not on Base mainnet", () => {
		expect(() =>
			mapPosition({
				position: positionRow({ chainId: 1 }),
				thesis: { id: "20000000-0000-4000-8000-000000000001", headline: "h", underlyingAsset: "BTC", taggedAsset: "BTC" },
			}),
		).toThrow(/not on Base mainnet/);
	});

	test("a NaN USD column becomes null, not a thrown render", () => {
		const mapped = mapPosition({
			position: positionRow({ estimatedPnlUsd: "NaN", maximumLossUsd: "NaN" }),
			thesis: { id: "20000000-0000-4000-8000-000000000001", headline: "h", underlyingAsset: "BTC", taggedAsset: "BTC" },
		});
		expect(mapped.economics.estimatedPnlUsd).toBeNull();
		expect(mapped.economics.maximumLossUsd).toBeNull();
	});
});
