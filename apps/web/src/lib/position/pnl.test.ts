/**
 * Offline tests for the position page's money.
 *
 * Rule for this file: every expected number is re-derived here from raw base
 * units by the formula in the comment above it, and written as a literal. No
 * expectation is copied from a run of the code under test, and none is computed
 * by calling the same helper the assertion is testing — otherwise the test would
 * only prove the code agrees with itself.
 *
 * Units, stated once:
 *   strikes and spot   8-decimal USD base units (SDK `OdetteRawOrderData.strikes`)
 *   contracts          option contract base units; 1e6 for USDC-family collateral
 *                      (`.research/thetanuts/finding-fill-debits.md`)
 *   premium and fees   collateral-token base units; aBasUSDC has 6 decimals
 *                      (SDK chain config, measured: aBasUSDC 0x4e65…c0AB, 6)
 *   every USD result   8-decimal USD, `risk.ts`'s PRICE_SCALE
 */
import { describe, expect, test } from "bun:test";
import {
	positionInstrument,
	riskKindFor,
	structureIdOf,
	type OrderSnapshotLike,
} from "./instrument";
import {
	decimalFromUsd8,
	derivePnlAtSpot,
	derivedRisk,
	resolvePnl,
	usd8FromDecimal,
	usd8FromSpotNumber,
	type DerivationInputs,
} from "./pnl";
import { derivationFor, percentLabel, positionPage } from "./view";
import type { PositionPageDetail } from "./types";
import type * as Domain from "@/types";

// Addresses measured from the installed SDK (`getChainConfigById(8453)` and
// `CHAIN_CONFIGS_BY_ID[8453].optionImplementations`), not from memory.
const PUT_IMPL = "0xf480f636301d50ed570d026254dc5728b746a90f";
const PUT_SPREAD_IMPL = "0xc9767f9a2f1eadc7fdcb7f0057e829d9d760e086";
const PUT_FLY_IMPL = "0x1fe24872ab7c83bba26dc761ce2ea735c9b96175";
const INVERSE_CALL_IMPL = "0x3ceb524cba83d2d4579f5a9f8c0d1f5701dd16fe";
const ABASUSDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";
const BTC_FEED = "0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f";

/** Expiry 2026-09-11T08:00:00Z = 1789113600 seconds since the epoch. */
const EXPIRY_SECONDS = "1789113600";

function snapshot(overrides: Record<string, unknown> = {}): OrderSnapshotLike {
	return {
		order: { expiry: EXPIRY_SECONDS },
		rawApiData: {
			collateral: ABASUSDC,
			priceFeed: BTC_FEED,
			implementation: PUT_IMPL,
			// 78,000 USD at 8 decimals = 78000 * 1e8 = 7_800_000_000_000
			strikes: ["7800000000000"],
			isCall: false,
			// The MAKER's long flag. `isLong: false` means the maker sells, so the
			// taker BUYS (chain-measured; packages/thetanuts/src/side.ts).
			isLong: false,
			orderExpiryTimestamp: 1789113600,
			extraOptionData: "0x",
			maxCollateralUsable: "1000000",
			...overrides,
		},
	};
}

describe("positionInstrument", () => {
	test("reads a taker-BUY put out of the stored order", () => {
		const instrument = positionInstrument(snapshot());
		expect(instrument).not.toBeNull();
		expect(instrument?.asset).toBe("BTC");
		expect(instrument?.isCall).toBe(false);
		expect(instrument?.takerSide).toBe("buy");
		expect(instrument?.riskKind).toBe("put");
		expect(instrument?.collateralSymbol).toBe("aBasUSDC");
		expect(instrument?.collateralDecimals).toBe(6);
		expect(instrument?.expiryAt).toBe("2026-09-11T08:00:00.000Z");
	});

	test("isLong true is the maker BUYING, so the taker sells", () => {
		expect(positionInstrument(snapshot({ isLong: true }))?.takerSide).toBe("sell");
	});

	test("keeps the book's strike order for identity and sorts a copy for the risk model", () => {
		// The feed lists a put spread high strike first.
		const instrument = positionInstrument(
			snapshot({ implementation: PUT_SPREAD_IMPL, strikes: ["7800000000000", "7400000000000"] }),
		);
		expect(instrument?.strikesUsd8).toEqual(["7800000000000", "7400000000000"]);
		expect(instrument?.ascendingStrikesUsd8).toEqual(["7400000000000", "7800000000000"]);
		expect(instrument?.riskKind).toBe("put-spread");
	});

	test("the structure id hashes the book's order, matching the market page", () => {
		const instrument = positionInstrument(
			snapshot({ implementation: PUT_SPREAD_IMPL, strikes: ["7800000000000", "7400000000000"] }),
		);
		expect(instrument?.structureId).toBe(
			structureIdOf({
				priceFeed: BTC_FEED,
				implementationAddress: PUT_SPREAD_IMPL,
				collateralAddress: ABASUSDC,
				isCall: false,
				strikes: [7800000000000n, 7400000000000n],
				expiry: 1789113600n,
			}),
		);
		// Sorting the strikes would produce a DIFFERENT id, which would select
		// nothing on the market page. Proven, not assumed.
		expect(instrument?.structureId).not.toBe(
			structureIdOf({
				priceFeed: BTC_FEED,
				implementationAddress: PUT_SPREAD_IMPL,
				collateralAddress: ABASUSDC,
				isCall: false,
				strikes: [7400000000000n, 7800000000000n],
				expiry: 1789113600n,
			}),
		);
	});

	test("refuses a snapshot with no rawApiData, and coerces nothing", () => {
		expect(positionInstrument({ order: { expiry: EXPIRY_SECONDS } })).toBeNull();
		// A string "false" must not become a boolean: it is not described, so it is
		// not described at all.
		expect(positionInstrument(snapshot({ isLong: "false" }))).toBeNull();
		expect(positionInstrument(snapshot({ strikes: [] }))).toBeNull();
		expect(positionInstrument(snapshot({ strikes: ["-1"] }))).toBeNull();
	});

	test("an unknown collateral address yields no symbol rather than a guess", () => {
		const instrument = positionInstrument(
			snapshot({ collateral: "0x0000000000000000000000000000000000000123" }),
		);
		expect(instrument?.collateralSymbol).toBeNull();
		expect(instrument?.collateralDecimals).toBeNull();
	});
});

describe("riskKindFor", () => {
	test("covers exactly the four shapes risk.ts models", () => {
		expect(riskKindFor("PUT", 1, 1)).toBe("put");
		expect(riskKindFor("LINEAR_CALL", 1, 1)).toBe("call");
		expect(riskKindFor("PUT_SPREAD", 2, 2)).toBe("put-spread");
		expect(riskKindFor("CALL_SPREAD", 2, 2)).toBe("call-spread");
	});

	test("refuses everything else, including the inverse call and the flies", () => {
		expect(riskKindFor("INVERSE_CALL", 1, 1)).toBeNull();
		expect(riskKindFor("PHYSICAL_PUT", 1, 1)).toBeNull();
		expect(riskKindFor("PUT_FLY", 3, 3)).toBeNull();
		expect(riskKindFor("IRON_CONDOR", 4, 4)).toBeNull();
		expect(riskKindFor(null, 1, null)).toBeNull();
	});

	test("refuses a name whose SDK strike count disagrees with the order's", () => {
		expect(riskKindFor("PUT", 2, 1)).toBeNull();
		expect(riskKindFor("PUT_SPREAD", 1, 2)).toBeNull();
		// The case only the SDK fence catches: the name and the order agree on one
		// strike, but the chain config declares the implementation takes two. The
		// switch alone would call this a put.
		expect(riskKindFor("PUT", 1, 2)).toBeNull();
		expect(riskKindFor("PUT_SPREAD", 2, 3)).toBeNull();
	});
});

describe("usd8 conversions", () => {
	test("scales a decimal to 8 places and truncates below them", () => {
		expect(usd8FromDecimal("78000")).toBe("7800000000000");
		expect(usd8FromDecimal("0.05")).toBe("5000000");
		// A ninth decimal is dropped, never rounded up into money that is not there.
		expect(usd8FromDecimal("1.234567891")).toBe("123456789");
		expect(usd8FromDecimal("-1.5")).toBe("-150000000");
		expect(usd8FromDecimal("NaN")).toBeNull();
	});

	test("a spot price arrives as a double and is refused when it is not a price", () => {
		expect(usd8FromSpotNumber(74000)).toBe("7400000000000");
		expect(usd8FromSpotNumber(0)).toBeNull();
		expect(usd8FromSpotNumber(Number.NaN)).toBeNull();
		expect(usd8FromSpotNumber(-1)).toBeNull();
	});

	test("8-decimal integers come back as decimals", () => {
		expect(decimalFromUsd8(3995000000n)).toBe("39.95");
		expect(decimalFromUsd8(-3995625000n)).toBe("-39.95625");
	});
});

/**
 * FIXTURE A — taker BUY of a 78,000 BTC put, 0.01 contracts, 0.05 aBasUSDC paid.
 *
 * numContracts 10000 in 1e6 units = 0.01 contracts.
 * premium 50000 aBasUSDC base units (6 decimals) = 0.05 aBasUSDC.
 * aBasUSDC is valued at the 1 USD peg, so collateralUsdPrice8 = 100000000.
 * premiumUsd8 = 50000 * 100000000 / 10^6 = 5000000  ($0.05)
 */
const BUY_PUT: DerivationInputs = {
	riskKind: "put",
	takerSide: "buy",
	ascendingStrikesUsd8: ["7800000000000"],
	contracts: "10000",
	contractDecimals: 6,
	premiumBaseUnits: "50000",
	premiumDecimals: 6,
	feeBaseUnits: "0",
	feeDecimals: 6,
	collateralUsdPrice8: "100000000",
};

/**
 * FIXTURE B — the same option, taker SELL. The seller receives the premium less
 * the protocol fee, which is what risk.ts wants as the net premium.
 * fee 6250 base units = 12.5% of 50000.
 * netPremiumUsd8 = (50000 - 6250) * 100000000 / 10^6 = 4375000  ($0.04375)
 */
const SELL_PUT: DerivationInputs = { ...BUY_PUT, takerSide: "sell", feeBaseUnits: "6250" };

/** Spot 74,000 USD at 8 decimals. */
const SPOT_74K = "7400000000000";

describe("derivePnlAtSpot — fixture A, long put", () => {
	test("P&L at a 74,000 spot", () => {
		// intrinsic per contract unit = strike - spot = 7800000000000 - 7400000000000
		//                             = 400000000000
		// gross = 400000000000 * 10000 / 10^6 = 4000000000
		// long  = gross - premiumUsd8 = 4000000000 - 5000000 = 3995000000
		// as USD = 3995000000 / 1e8 = 39.95
		expect(derivePnlAtSpot(BUY_PUT, SPOT_74K)).toBe("39.95");
	});

	test("above the strike the buyer loses exactly the premium", () => {
		// spot 80,000 -> intrinsic 0 -> long = 0 - 5000000 = -5000000 = -0.05
		expect(derivePnlAtSpot(BUY_PUT, "8000000000000")).toBe("-0.05");
	});

	test("max loss, max payout and break-even", () => {
		const risk = derivedRisk(BUY_PUT);
		// maxLoss(long) = premiumUsd8 = 5000000 = 0.05
		expect(risk?.maxLossUsd).toBe("0.05");
		// maxPayout(long put) = strike * contracts / 10^6 - premiumUsd8
		//                     = 7800000000000 * 10000 / 1000000 - 5000000
		//                     = 78000000000 - 5000000 = 77995000000 = 779.95
		expect(risk?.maxPayoutUsd).toBe("779.95");
		// breakEven(put) = strike - premiumUsd8 * 10^6 / contracts
		//                = 7800000000000 - 5000000 * 1000000 / 10000
		//                = 7800000000000 - 500000000 = 7799500000000 = 77995
		expect(risk?.breakEvenUsd).toBe("77995");
	});
});

describe("derivePnlAtSpot — fixture B, short put", () => {
	test("P&L at a 74,000 spot is the buyer's, mirrored around the net premium", () => {
		// short = premiumUsd8 - gross = 4375000 - 4000000000 = -3995625000
		//       = -39.95625
		expect(derivePnlAtSpot(SELL_PUT, SPOT_74K)).toBe("-39.95625");
	});

	test("above the strike the seller keeps exactly the net premium", () => {
		expect(derivePnlAtSpot(SELL_PUT, "8000000000000")).toBe("0.04375");
	});

	test("max loss is the collateral less the premium received", () => {
		const risk = derivedRisk(SELL_PUT);
		// maxLoss(short put) = strike * contracts / 10^6 - premiumUsd8
		//                    = 78000000000 - 4375000 = 77995625000 = 779.95625
		expect(risk?.maxLossUsd).toBe("779.95625");
		// maxPayout(short) = premiumUsd8 = 4375000 = 0.04375
		expect(risk?.maxPayoutUsd).toBe("0.04375");
		// breakEven(put) = 7800000000000 - 4375000 * 1000000 / 10000
		//                = 7800000000000 - 437500000 = 7799562500000 = 77995.625
		expect(risk?.breakEvenUsd).toBe("77995.625");
	});

	test("a fee larger than the premium received is a disagreement, not a number", () => {
		expect(derivePnlAtSpot({ ...SELL_PUT, feeBaseUnits: "60000" }, SPOT_74K)).toBeNull();
	});

	test("a malformed raw amount returns null instead of throwing out of the page", () => {
		// `riskParams` runs before the try/catch that wraps the risk model, so an
		// unparseable base-unit string must be refused by the shape check, not by
		// a BigInt() that would take the whole render down with it.
		for (const bad of [
			{ collateralUsdPrice8: "abc" },
			{ premiumBaseUnits: "1.5" },
			{ contracts: "-1" },
			{ feeBaseUnits: "" },
			{ ascendingStrikesUsd8: ["oops"] },
		]) {
			expect(derivePnlAtSpot({ ...SELL_PUT, ...bad }, SPOT_74K)).toBeNull();
			expect(derivedRisk({ ...SELL_PUT, ...bad })).toBeNull();
		}
	});
});

describe("FIXTURE C — an unsupported structure is unavailable, never a number", () => {
	function detailWith(instrumentSnapshot: OrderSnapshotLike): PositionPageDetail {
		return {
			position: domainPosition({}),
			owner: OWNER,
			instrument: positionInstrument(instrumentSnapshot),
			quantities: {
				contracts: "10000",
				contractDecimals: 6,
				premium: "50000",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "780000000",
				collateralDecimals: 6,
			},
			thesis: null,
		};
	}

	test("a put butterfly has no payoff model, and the reason says so", () => {
		const result = derivationFor(
			detailWith(
				snapshot({
					implementation: PUT_FLY_IMPL,
					strikes: ["7800000000000", "7600000000000", "7400000000000"],
				}),
			),
			"100000000",
		);
		expect(result.inputs).toBeNull();
		expect(result.inputs === null ? result.reason : "").toContain("put fly");
		expect(result.inputs === null ? result.reason : "").toContain("no payoff model");
	});

	test("an inverse call is refused too", () => {
		const result = derivationFor(detailWith(snapshot({ implementation: INVERSE_CALL_IMPL, isCall: true })), "100000000");
		expect(result.inputs).toBeNull();
	});

	test("an unpriceable collateral token is refused by name", () => {
		const result = derivationFor(detailWith(snapshot()), null);
		expect(result.inputs).toBeNull();
		expect(result.inputs === null ? result.reason : "").toContain("aBasUSDC");
	});

	test("a fixture with no order snapshot is refused", () => {
		const result = derivationFor(
			{ ...detailWith(snapshot()), instrument: null },
			"100000000",
		);
		expect(result.inputs).toBeNull();
		expect(result.inputs === null ? result.reason : "").toContain("does not describe its instrument");
	});
});

describe("resolvePnl — which number a status is allowed to show", () => {
	const base = {
		finalPnlUsd: null,
		estimatedPnlUsd: null,
		settlementPriceUsd: null,
		derivation: BUY_PUT,
		spotUsd8: SPOT_74K,
		unavailableReason: "no reason given",
	} as const;

	test("a settled row shows only its recorded final P&L", () => {
		const result = resolvePnl({
			...base,
			status: "settled",
			finalPnlUsd: "-12.5",
			settlementPriceUsd: "80000",
		});
		expect(result).toEqual({
			pnlUsd: "-12.5",
			basis: "settled",
			detail: "Final P&L recorded at settlement, settled at $80000.",
		});
	});

	test("a settled row with no final P&L never falls through to the estimate (PRD 14)", () => {
		const result = resolvePnl({ ...base, status: "settled", estimatedPnlUsd: "999" });
		expect(result.pnlUsd).toBeNull();
		expect(result.basis).toBe("unavailable");
		expect(result.detail).toContain("Settlement pending");
	});

	test("an expired row shows settlement pending, not a derived figure", () => {
		const result = resolvePnl({ ...base, status: "expired" });
		expect(result.pnlUsd).toBeNull();
		expect(result.detail).toContain("Settlement pending");
	});

	test("a failed transaction is not a position", () => {
		expect(resolvePnl({ ...base, status: "failed" })).toEqual({
			pnlUsd: null,
			basis: "unavailable",
			detail: "This transaction failed, so there is no position.",
		});
	});

	test("a pending fill has no P&L", () => {
		expect(resolvePnl({ ...base, status: "pending" }).pnlUsd).toBeNull();
	});

	test("a recorded estimate beats the derivation", () => {
		const result = resolvePnl({ ...base, status: "indexed", estimatedPnlUsd: "7" });
		expect(result).toEqual({
			pnlUsd: "7",
			basis: "estimate",
			detail: "Estimated P&L recorded with the fill.",
		});
	});

	test("confirmed but not indexed says so (PRD 13)", () => {
		expect(resolvePnl({ ...base, status: "confirmed", estimatedPnlUsd: "7" }).detail).toContain(
			"indexer has not synced",
		);
	});

	test("with no recorded estimate it derives, and says what the number is", () => {
		const result = resolvePnl({ ...base, status: "indexed" });
		expect(result.pnlUsd).toBe("39.95");
		expect(result.basis).toBe("derived");
		expect(result.detail).toContain("if it settled at the current spot of $74000");
		expect(result.detail).toContain("not a mark-to-market value");
	});

	test("no spot means no number, with the feed named as the reason", () => {
		const result = resolvePnl({ ...base, status: "indexed", spotUsd8: null });
		expect(result.pnlUsd).toBeNull();
		expect(result.detail).toContain("price feed could not be read");
	});

	test("an unmodellable structure reports its own reason verbatim", () => {
		const result = resolvePnl({
			...base,
			status: "indexed",
			derivation: null,
			unavailableReason: "No P&L: put fly has no payoff model.",
		});
		expect(result.detail).toBe("No P&L: put fly has no payoff model.");
	});
});

describe("percentLabel", () => {
	test("exact decimal ratios, rounded half-up at one place", () => {
		expect(percentLabel("96", "250")).toBe("+38.4%");
		expect(percentLabel("-12", "80")).toBe("−15.0%");
		expect(percentLabel("0", "250")).toBe("0.0%");
		// 1/3 = 33.333..% -> 33.3
		expect(percentLabel("1", "3")).toBe("+33.3%");
		// 0.125/1 = 12.5% exactly
		expect(percentLabel("0.125", "1")).toBe("+12.5%");
		// half-up: 1.25/10 = 12.5 -> 12.5; 0.1275/1 = 12.75% -> 12.8
		expect(percentLabel("0.1275", "1")).toBe("+12.8%");
	});

	test("a zero denominator has no percentage", () => {
		expect(percentLabel("5", "0")).toBeNull();
		expect(percentLabel("5", "0.00")).toBeNull();
	});
});

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

function domainPosition(overrides: Partial<Domain.Position>): Domain.Position {
	return {
		id: "33330000-0000-4000-8000-000000000001",
		thesisId: null,
		userId: OWNER.id,
		role: "standalone",
		side: "back",
		status: "indexed",
		chainId: 8453,
		walletAddress: "0x00000000000000000000000000000000feed1001",
		thesisSlug: null,
		thesisHeadline: null,
		underlyingAsset: "BTC",
		contracts: "0.01",
		entrySpotPriceUsd: null,
		economics: {
			entryPremiumUsd: null,
			entryFeesUsd: null,
			maximumLossUsd: null,
			maximumPayoutUsd: null,
			breakEvenPricesUsd: [],
			estimatedPnlUsd: null,
			finalPnlUsd: null,
			settlementPriceUsd: null,
		},
		verification: { transactionHash: null, optionAddress: null, confirmedOnchain: false },
		createdAt: "2026-09-05T05:12:00.000Z",
		mockTransactionFragment: null,
		...overrides,
	};
}

function detail(overrides: Partial<PositionPageDetail> = {}): PositionPageDetail {
	return {
		position: domainPosition({}),
		owner: OWNER,
		instrument: positionInstrument(snapshot()),
		quantities: {
			contracts: "10000",
			contractDecimals: 6,
			premium: "50000",
			premiumDecimals: 6,
			fees: "0",
			feeDecimals: 6,
			collateral: "780000000",
			collateralDecimals: 6,
		},
		thesis: null,
		...overrides,
	};
}

describe("positionPage", () => {
	const asOf = new Date("2026-09-05T06:00:00.000Z");

	test("a derived card prints numbers that reproduce from the raw units", () => {
		const page = positionPage({
			detail: detail(),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf,
		});
		// 3995000000 / 1e8 = 39.95 exactly; the hero figure keeps the cents.
		expect(page.card.pnl.signed2).toBe("+$39.95");
		expect(page.card.pnl.signed).toBe("+$40");
		expect(page.card.basis).toBe("derived");
		// Round-1 fold item 9: the mockup splits the instrument into a title, a
		// strikes sub-line and an expiry chip; the card carries the three apart.
		expect(page.card.instrumentLabel).toBe("BTC put");
		expect(page.card.strikesLabel).toBe("78,000 P");
		expect(page.card.expiryLabel).toBe("11 Sep");
		expect(page.card.expiryFullLabel).toBe("11 Sep 26 08:00 UTC");
		// Premium paid: entryPremiumUsd is null on this row, so it is valued from
		// 50000 aBasUSDC base units at the 1 USD peg = 0.05.
		expect(page.card.stats[0]).toEqual({ label: "Premium paid", value: "$0.05" });
		expect(page.card.stats[1]).toEqual({ label: "Max loss", value: "$0.05" });
		expect(page.card.stats[2]).toEqual({ label: "Max payout", value: "$779.95" });
		// 39.95 / 0.05 = 799 -> +79900.0%
		expect(page.card.pnlPctLabel).toBe("+79900.0% of max loss");
		expect(page.facts.find((fact) => fact.label === "Break-even")?.value).toBe("$77,995.00");
		expect(page.facts.find((fact) => fact.label === "Direction")?.value).toBe(
			"Long the structure (bought)",
		);
	});

	test("the seller's card locks collateral instead of paying a premium", () => {
		const page = positionPage({
			detail: detail({ instrument: positionInstrument(snapshot({ isLong: true })) }),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf,
		});
		// collateral 780000000 base units of a 6-decimal token at the 1 USD peg = 780
		expect(page.card.stats[0]).toEqual({ label: "Collateral locked", value: "$780.00" });
		// This detail records fees "0", so the seller's net premium is the whole
		// 50000 base units = 5000000 USD8:
		//   short = premiumUsd8 - gross = 5000000 - 4000000000 = -3995000000
		//         = -39.95
		expect(page.card.pnl.signed2).toBe("−$39.95");
		expect(page.card.stats[1].value).toBe("$779.95");
	});

	test("recorded economics beat the derivation", () => {
		const page = positionPage({
			detail: detail({
				position: domainPosition({
					economics: {
						entryPremiumUsd: "250",
						entryFeesUsd: "3.13",
						maximumLossUsd: "250",
						maximumPayoutUsd: "725",
						breakEvenPricesUsd: ["77000"],
						estimatedPnlUsd: "96",
						finalPnlUsd: null,
						settlementPriceUsd: null,
					},
				}),
			}),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf,
		});
		expect(page.card.pnl.signed2).toBe("+$96.00");
		expect(page.card.basis).toBe("estimate");
		expect(page.card.stats).toEqual([
			{ label: "Premium paid", value: "$250.00" },
			{ label: "Max loss", value: "$250.00" },
			{ label: "Max payout", value: "$725.00" },
		]);
		// 96 / 250 = 38.4%
		expect(page.card.pnlPctLabel).toBe("+38.4% of max loss");
	});

	test("statuses map to the chips the PRD words", () => {
		const page = (status: Domain.PositionStatus) =>
			positionPage({
				detail: detail({ position: domainPosition({ status }) }),
				spotUsd8: SPOT_74K,
				collateralUsdPrice8: "100000000",
				asOf,
			}).card;
		expect(page("indexed").statusLabel).toBe("Open");
		expect(page("confirmed").statusLabel).toBe("Open · syncing");
		expect(page("expired").statusLabel).toBe("Settlement pending");
		expect(page("failed").statusLabel).toBe("Failed");
		expect(page("failed").pnl.signed2).toBe("—");
		expect(page("failed").pnlPctLabel).toBeNull();
	});

	test("a settled row reads Result, never Live P&L", () => {
		const card = positionPage({
			detail: detail({
				position: domainPosition({
					status: "settled",
					economics: {
						entryPremiumUsd: "250",
						entryFeesUsd: null,
						maximumLossUsd: "250",
						maximumPayoutUsd: "725",
						breakEvenPricesUsd: [],
						estimatedPnlUsd: "96",
						finalPnlUsd: "-250",
						settlementPriceUsd: "80000",
					},
				}),
			}),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf,
		}).card;
		expect(card.pnlLabel).toBe("Result");
		expect(card.pnl.signed2).toBe("−$250.00");
		expect(card.basis).toBe("settled");
	});

	test("a live option offers the structure link; an expired one does not", () => {
		const live = positionPage({
			detail: detail(),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf,
		});
		expect(live.structureId).toMatch(/^[0-9a-f]{16}$/);
		expect(live.marketSlug).toBe("btc");
		const after = positionPage({
			detail: detail(),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf: new Date("2026-09-12T00:00:00.000Z"),
		});
		expect(after.structureId).toBeNull();
	});

	test("a fixture with no instrument still renders, with the reason said out loud", () => {
		const page = positionPage({
			detail: detail({ instrument: null, quantities: null }),
			spotUsd8: null,
			collateralUsdPrice8: null,
			asOf,
		});
		expect(page.card.pnl.signed2).toBe("—");
		expect(page.card.pnlBasisLabel).toContain("does not describe its instrument");
		expect(page.card.instrumentLabel).toBe("BTC");
		expect(page.structureId).toBeNull();
		expect(page.card.stats.every((stat) => stat.value === "—")).toBe(true);
	});

	test("the verified badge follows the receipt, never the transaction link", () => {
		const unconfirmed = positionPage({
			detail: detail({
				position: domainPosition({
					verification: { transactionHash: "0x" + "ab".repeat(32), optionAddress: null, confirmedOnchain: false },
				}),
			}),
			spotUsd8: SPOT_74K,
			collateralUsdPrice8: "100000000",
			asOf,
		}).card;
		expect(unconfirmed.tx?.href).toContain("https://basescan.org/tx/0x");
		expect(unconfirmed.verified).toBe(false);
	});
});
