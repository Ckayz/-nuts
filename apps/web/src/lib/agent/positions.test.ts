/// <reference types="bun" />
/**
 * The agent's two position tools.
 *
 * Three properties are pinned here, and each of them is a defect if it breaks:
 *
 *  1. **The wallet is never a model argument.** Asserted from the tool's own
 *     `inputSchema` and, independently, from the file's source — not from the
 *     doc comment that claims it.
 *  2. **The agent's number IS the portfolio's number.** `positionSummary` is
 *     pinned against `listRowPnl` and `display.position` for the same row and
 *     the same price book. B1 (user-flow re-walk 2026-09-06) was exactly this
 *     class of defect: one surface computed a figure and another said "not
 *     available yet" about the same fill at the same minute.
 *  3. **The at-expiry arithmetic is `risk.ts`'s, exactly.** The long-call cases
 *     below are the payoff identity written out: at the strike a long call is
 *     worth minus its premium, and one premium's worth of intrinsic value above
 *     it, it is worth plus its premium.
 *
 * Nothing here touches the network or the database: `fillDerivationInputs` and
 * `positionSummary` are pure, and the tool cases that run `execute` all return
 * before any read. The database path is `positions.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

import type * as Domain from "@/types";
import * as display from "@/lib/display";
import { positionInstrument } from "@/lib/position/instrument";
import { decimalFromUsd8, derivePnlAtSpot, derivedRisk } from "@/lib/position/pnl";
import type { LivePriceBook } from "@/lib/position/types";
import { listRowPnl } from "@/lib/position/view";
import { createPositionTools, fillDerivationInputs, positionSummary, rfqOptionsFor } from "./positions";

const CTX = { toolCallId: "test", messages: [], context: {} } as never;

/** No session at all: the state a visitor who has not connected is in. */
const anonymous = createPositionTools({ session: null });
const signedIn = createPositionTools({
	session: { userId: "u1", walletAddress: "0xb792296be8202ba2fc5d3276fa184e5b479920e3" },
});

/* ------------------------------------------------------------------ *
 * 1. The wallet is never a model argument.
 * ------------------------------------------------------------------ */

describe("the model cannot name a wallet", () => {
	const shapeOf = (schema: unknown) => Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);

	test("getUserPositions takes only a row limit", () => {
		expect(shapeOf(anonymous.getUserPositions.inputSchema)).toEqual(["limit"]);
	});

	test("whatIfAtExpiry takes a price and a subject, and no address", () => {
		expect(shapeOf(anonymous.whatIfAtExpiry.inputSchema)).toEqual([
			"settlementPriceUsd",
			"positionId",
			"instrumentKey",
			"budget",
		]);
	});

	/**
	 * A second, independent measurement of the same fact: every `inputSchema`
	 * block in the file, read as text, with nothing address-shaped in it. The
	 * schema assertions above would still pass if a future field were called
	 * something the list happened to be updated for; this one fails on the
	 * WORD, which is what a prompt-injected model would have to name.
	 */
	test("no inputSchema in the file mentions a wallet, an address or a user", () => {
		const source = readFileSync(new URL("./positions.ts", import.meta.url), "utf8");
		const blocks = [...source.matchAll(/inputSchema: z\.object\(\{[\s\S]*?\n\t\t\}\)/g)].map((m) => m[0]);
		expect(blocks.length).toBe(2);
		for (const block of blocks) {
			expect(block).not.toMatch(/wallet|address|userId/i);
		}
	});
});

/* ------------------------------------------------------------------ *
 * 2. Signed out, and the refusals that need no read at all.
 * ------------------------------------------------------------------ */

describe("signed out", () => {
	test("getUserPositions says so instead of reading anything", async () => {
		const result = await anonymous.getUserPositions.execute?.({ limit: 10 }, CTX);
		expect(result).toEqual({
			signedIn: false,
			note: expect.stringContaining("not signed in"),
		});
	});

	test("whatIfAtExpiry on a position says so too", async () => {
		const result = (await anonymous.whatIfAtExpiry.execute?.(
			{ settlementPriceUsd: "2500", positionId: "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01" },
			CTX,
		)) as { found: boolean; signedIn?: boolean };
		expect(result.found).toBe(false);
		expect(result.signedIn).toBe(false);
	});
});

describe("whatIfAtExpiry needs exactly one subject", () => {
	test("neither a positionId nor an instrumentKey is refused, with a reason", async () => {
		const result = (await signedIn.whatIfAtExpiry.execute?.({ settlementPriceUsd: "2500" }, CTX)) as {
			found: boolean;
			reason: string;
		};
		expect(result.found).toBe(false);
		expect(result.reason).toContain("exactly one subject");
	});

	test("BOTH is refused as well, rather than one being picked", async () => {
		const result = (await signedIn.whatIfAtExpiry.execute?.(
			{
				settlementPriceUsd: "2500",
				positionId: "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01",
				instrumentKey: "ETH|buy|0x1|C|1|2|0x2",
				budget: "1",
			},
			CTX,
		)) as { found: boolean; reason: string };
		expect(result.found).toBe(false);
		expect(result.reason).toContain("exactly one subject");
	});

	test("a settlement price that is not a positive decimal is refused before anything is read", async () => {
		for (const settlementPriceUsd of ["0", "0.00000000", "0.000000001"]) {
			const result = (await signedIn.whatIfAtExpiry.execute?.(
				{ settlementPriceUsd, instrumentKey: "k", budget: "1" },
				CTX,
			)) as { found: boolean; reason: string };
			expect({ settlementPriceUsd, found: result.found }).toEqual({ settlementPriceUsd, found: false });
			expect(result.reason).toContain("positive decimal");
		}
	});
});

/* ------------------------------------------------------------------ *
 * 3. The equality pin: one fill, one number, three surfaces.
 * ------------------------------------------------------------------ */

/**
 * The fixture is `lib/position/live-pnl.test.ts`'s, which is a replay of the
 * documented Base fill `0x9c4bb145…828f8c` (an ETH 2340 put, taker BUY, 999998
 * USDC premium). Copied rather than imported because a test file is not a
 * fixture module; the property asserted is an EQUALITY between two functions
 * over the same row, so it holds whatever the row is.
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

const ASSET = INSTRUMENT?.asset ?? "";
const COLLATERAL = INSTRUMENT?.collateralSymbol ?? "";
/** $2,478.37 at 8 decimals, the spot the B1 measurement was taken at. */
const SPOT_USD8 = "247837000000";
const PEG_USD8 = "100000000";
const ASOF = new Date("2026-09-06T00:00:00Z");

const BOOK: LivePriceBook = {
	spotUsd8: (asset) => (asset === ASSET ? SPOT_USD8 : null),
	collateralUsdPrice8: (symbol) => (symbol === COLLATERAL ? PEG_USD8 : null),
	feedError: null,
};

function row(overrides: Partial<Domain.Position> = {}): Domain.Position {
	return {
		id: "69125d9b-38e3-4280-9119-61ee46fefff4",
		thesisId: null,
		userId: "u1",
		role: "standalone",
		side: "back",
		status: "confirmed",
		chainId: 8453,
		walletAddress: "0xb792296be8202ba2fc5d3276fa184e5b479920e3",
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

describe("what the agent is told about a position is what the app shows", () => {
	test("the fixture really is derivable, so nothing below holds vacuously", () => {
		expect(INSTRUMENT).not.toBeNull();
		expect(ASSET).toBe("ETH");
		expect(COLLATERAL).toBe("USDC");
		expect(listRowPnl(row(), BOOK).derivedPnlUsd).not.toBeNull();
	});

	test("derivedPnlUsd is EXACTLY listRowPnl's for the same row and price book", () => {
		const summary = positionSummary(row(), BOOK, ASOF);
		const live = listRowPnl(row(), BOOK);
		expect(summary.derivedPnlUsd).toBe(live.derivedPnlUsd);
		// And the same figure the portfolio row prints, through the view layer.
		expect(summary.pnlUsd).toBe(display.position(row(), ASOF, live).livePnlUsd.raw);
		expect(summary.basis).toBe(display.position(row(), ASOF, live).basis);
	});

	test("the instrument is described from the order snapshot, not from the post's side", () => {
		const summary = positionSummary(row(), BOOK, ASOF);
		expect({
			asset: summary.asset,
			side: summary.side,
			optionType: summary.optionType,
			direction: summary.direction,
			strikesUsd: summary.strikesUsd,
			label: summary.label,
			path: summary.path,
		}).toEqual({
			asset: "ETH",
			// The TAKER bought this put. `row().side` is "back" — whose side of a
			// post the fill took — and says nothing about the market.
			side: "buy",
			optionType: "put",
			direction: "bear",
			strikesUsd: ["2340"],
			label: "ETH 2340 put",
			path: "/p/69125d9b-38e3-4280-9119-61ee46fefff4",
		});
	});

	test("the premium is reported in its collateral TOKEN, never as dollars", () => {
		expect(positionSummary(row(), BOOK, ASOF).premium).toEqual({ amount: "0.999998", token: "USDC" });
	});

	test("a settled row shows its recorded result, and the estimate never replaces it", () => {
		const settled = row({
			status: "settled",
			economics: { ...row().economics, finalPnlUsd: "12.5", settlementPriceUsd: "2500" },
		});
		const summary = positionSummary(settled, BOOK, ASOF);
		expect(summary.pnlUsd).toBe("12.5");
		expect(summary.basis).toBe("settled");
		// The derived figure is still carried, and is still a different number.
		expect(summary.derivedPnlUsd).toBe(listRowPnl(settled, BOOK).derivedPnlUsd);
		expect(summary.derivedPnlUsd).not.toBe("12.5");
	});

	test("an unreadable feed gives null with the reason, never a zero", () => {
		const blind: LivePriceBook = {
			spotUsd8: () => null,
			collateralUsdPrice8: (symbol) => (symbol === COLLATERAL ? PEG_USD8 : null),
			feedError: "feed down",
		};
		const summary = positionSummary(row(), blind, ASOF);
		expect(summary.derivedPnlUsd).toBeNull();
		expect(summary.pnlUsd).toBeNull();
		expect(summary.note).toContain("price feed could not be read");
	});

	test("max loss comes from the recorded column, and break-even from the risk model", () => {
		const summary = positionSummary(row(), BOOK, ASOF);
		// `economics.maximumLossUsd` is the column the fill wrote; the page uses
		// it in preference to the derived figure and so does this.
		expect(summary.maxLossUsd).toBe("0.999998");
		// Nothing recorded a payout or a break-even, so both are the risk model's.
		const live = listRowPnl(row(), BOOK);
		expect(live.derivable).toBe(true);
		expect(summary.breakEvenUsd).not.toBeNull();
		expect(summary.maxPayoutUsd).not.toBeNull();
	});
});

/* ------------------------------------------------------------------ *
 * 4. The at-expiry arithmetic, written out.
 * ------------------------------------------------------------------ */

const USDC_FILL = {
	numContracts: "1000000",
	premium: "5000000",
	feeEstimate: "625000",
	collateralDecimals: 6,
	contractSizeDecimals: 6,
} as const;

/** $2,500 and $2,600 as the feed publishes them: 8-decimal integers. */
const K = 250_000_000_000n;
const K_HIGH = 260_000_000_000n;

describe("whatIfAtExpiry's arithmetic is risk.ts's", () => {
	const longCall = fillDerivationInputs({
		takerSide: "buy",
		implementationName: "LINEAR_CALL",
		feedStrikesUsd8: [K.toString()],
		collateralSymbol: "USDC",
		raw: USDC_FILL,
	});

	test("the inputs are built, so the cases below are not vacuous", () => {
		expect(longCall.inputs).not.toBeNull();
		expect(longCall.inputs?.riskKind).toBe("call");
		// 5 USDC at the 1 USD peg, in 8-decimal USD.
		expect(longCall.inputs?.collateralUsdPrice8).toBe("100000000");
	});

	test("a long call settling AT its strike loses exactly the premium", () => {
		expect(derivePnlAtSpot(longCall.inputs!, K.toString())).toBe("-5");
	});

	test("...and one premium's worth of intrinsic value above it, gains exactly the premium", () => {
		// premiumUsd8 = 5000000 * 1e8 / 1e6 = 500000000 ($5). One contract unit,
		// so a $10 move above the strike is $10 of intrinsic value.
		const premiumUsd8 = 500_000_000n;
		const scale = 10n ** BigInt(USDC_FILL.contractSizeDecimals);
		const settlement = K + (2n * premiumUsd8 * scale) / BigInt(USDC_FILL.numContracts);
		expect(decimalFromUsd8(settlement)).toBe("2510");
		expect(derivePnlAtSpot(longCall.inputs!, settlement.toString())).toBe("5");
	});

	test("a long call below its strike loses the premium and no more", () => {
		expect(derivePnlAtSpot(longCall.inputs!, (K - 100_000_000_000n).toString())).toBe("-5");
		expect(derivedRisk(longCall.inputs!)).toEqual({
			maxLossUsd: "5",
			// A long vanilla call is uncapped, and `risk.ts` returns null rather
			// than a number for it.
			maxPayoutUsd: null,
			breakEvenUsd: "2505",
		});
	});

	/**
	 * MUTANT GUARD (brief item: "drop the ascending sort -> spread case RED").
	 *
	 * The book publishes a spread's legs in ITS order, which is not always
	 * ascending, and `risk.ts` `checked()` throws on `strikes[0] >= strikes[1]`.
	 * Without the sort in `fillDerivationInputs` every one of these is null.
	 */
	const descendingSpread = fillDerivationInputs({
		takerSide: "buy",
		implementationName: "CALL_SPREAD",
		feedStrikesUsd8: [K_HIGH.toString(), K.toString()],
		collateralSymbol: "USDC",
		raw: USDC_FILL,
	});

	test("a spread published HIGH leg first is still priced", () => {
		expect(descendingSpread.inputs?.ascendingStrikesUsd8).toEqual([K.toString(), K_HIGH.toString()]);
		// Mid-way through the spread: $50 of intrinsic value, minus the $5 premium.
		expect(derivePnlAtSpot(descendingSpread.inputs!, (255_000_000_000n).toString())).toBe("45");
		expect(derivedRisk(descendingSpread.inputs!)).toEqual({
			maxLossUsd: "5",
			maxPayoutUsd: "95",
			breakEvenUsd: "2505",
		});
	});

	test("a taker who SELLS the same spread has the mirrored payoff", () => {
		const short = fillDerivationInputs({
			takerSide: "sell",
			implementationName: "CALL_SPREAD",
			feedStrikesUsd8: [K.toString(), K_HIGH.toString()],
			collateralSymbol: "USDC",
			raw: USDC_FILL,
		});
		// A seller's premium is NET of the fee: (5000000 - 625000) / 1e6 = $4.375.
		expect(derivedRisk(short.inputs!)?.maxPayoutUsd).toBe("4.375");
		expect(derivePnlAtSpot(short.inputs!, (255_000_000_000n).toString())).toBe("-45.625");
	});
});

describe("a hypothetical fill refuses what it cannot justify, and names the piece", () => {
	test("an unproven contract-size unit", () => {
		const built = fillDerivationInputs({
			takerSide: "buy",
			implementationName: "LINEAR_CALL",
			feedStrikesUsd8: [K.toString()],
			collateralSymbol: "USDC",
			raw: { ...USDC_FILL, contractSizeDecimals: null },
		});
		expect(built.inputs).toBeNull();
		expect(built.reason).toContain("contract units unverified");
	});

	test("a collateral token with no citable USD price", () => {
		for (const collateralSymbol of ["aBasWETH", "cbBTC", null]) {
			const built = fillDerivationInputs({
				takerSide: "buy",
				implementationName: "LINEAR_CALL",
				feedStrikesUsd8: [K.toString()],
				collateralSymbol,
				raw: USDC_FILL,
			});
			expect({ collateralSymbol, inputs: built.inputs }).toEqual({ collateralSymbol, inputs: null });
			expect(built.reason).toContain("Collateral USD valuation unavailable");
		}
	});

	test("a structure the risk model has no payoff for", () => {
		for (const implementationName of ["RANGER", "PHYSICAL_CALL", "INVERSE_CALL", null]) {
			const built = fillDerivationInputs({
				takerSide: "buy",
				implementationName,
				feedStrikesUsd8: [K.toString()],
				collateralSymbol: "USDC",
				raw: USDC_FILL,
			});
			expect({ implementationName, inputs: built.inputs }).toEqual({ implementationName, inputs: null });
			expect(built.reason).toContain("no payoff model");
		}
	});

	test("a leg count the implementation does not have", () => {
		// CALL_SPREAD with one strike, and LINEAR_CALL with two: `riskKindFor`
		// refuses both rather than pricing a mislabelled row.
		expect(
			fillDerivationInputs({
				takerSide: "buy",
				implementationName: "CALL_SPREAD",
				feedStrikesUsd8: [K.toString()],
				collateralSymbol: "USDC",
				raw: USDC_FILL,
			}).inputs,
		).toBeNull();
		expect(
			fillDerivationInputs({
				takerSide: "buy",
				implementationName: "LINEAR_CALL",
				feedStrikesUsd8: [K.toString(), K_HIGH.toString()],
				collateralSymbol: "USDC",
				raw: USDC_FILL,
			}).inputs,
		).toBeNull();
	});
});

/* ------------------------------------------------------------------ *
 * 4. Options an RFQ settled into.
 *
 * They have no `positions` row: an RFQ mints its option at SETTLEMENT, by
 * whoever sends `settleQuotation`, so this app never saw a fill for one. The
 * Thetanuts indexer lists them and that is all that can be said, which is why
 * every figure is absent rather than estimated.
 * ------------------------------------------------------------------ */

describe("rfqOptionsFor", () => {
	/** `StateOption` as the indexer publishes it (`dist/index.d.ts:1101`). */
	const indexed = [
		{
			address: "0x4444444444444444444444444444444444444444",
			quotationId: "4242",
			collateral: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			strikes: ["230000000000"],
			expiry: 1_789_113_600,
			optionType: 3,
		},
	];

	test("maps the indexer's rows and never invents a P&L for one", async () => {
		const { options, note } = await rfqOptionsFor("0x1111111111111111111111111111111111111111", {
			api: { getUserOptionsFromRfq: async () => indexed },
		});
		expect(options).toEqual([
			{
				optionAddress: indexed[0]!.address,
				quotationId: "4242",
				strikesUsd: ["2300"],
				expiryAt: "2026-09-11T08:00:00.000Z",
				optionType: 3,
				collateralAddress: indexed[0]!.collateral,
				basis: "indexer",
				note: expect.stringContaining("no premium, no maximum loss and no profit or loss figure"),
			},
		]);
		expect(String(note)).toContain("minted at settlement");
		// No P&L field of any kind reaches the model for these.
		const text = JSON.stringify(options);
		expect(text).not.toContain("pnl");
		expect(text).not.toContain("maxLoss");
	});

	test("an empty list is an empty list, with no note to repeat", async () => {
		const { options, note } = await rfqOptionsFor("0x1111111111111111111111111111111111111111", {
			api: { getUserOptionsFromRfq: async () => [] },
		});
		expect(options).toEqual([]);
		expect(note).toBeNull();
	});

	/**
	 * "You have none" and "we could not look" are different answers, and only one
	 * of them is ever true. Mutant: `catch { return { options: [], note: null } }`.
	 */
	test("an unreadable indexer returns null, not an empty list", async () => {
		const { options, note } = await rfqOptionsFor("0x1111111111111111111111111111111111111111", {
			api: {
				getUserOptionsFromRfq: async () => {
					throw new Error("indexer down");
				},
			},
		});
		expect(options).toBeNull();
		expect(String(note)).toContain("Do not say they have none");
	});

	test("the answer is bounded", async () => {
		const many = Array.from({ length: 40 }, (_value, index) => ({ ...indexed[0]!, quotationId: String(index) }));
		const { options } = await rfqOptionsFor("0x1111111111111111111111111111111111111111", {
			api: { getUserOptionsFromRfq: async () => many },
		});
		expect(options?.length).toBe(10);
	});
});
