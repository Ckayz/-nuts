/// <reference types="bun" />
/**
 * D-R3-1 (Astra lane D) + C-1 (Astra lane C), pass 3: ONE definition of the
 * displayed direction and ONE of the lifecycle, on every surface that shows
 * either.
 *
 * Measured on this exact fixture BEFORE the fold (both probes pasted verbatim):
 *
 *   list row vs position page
 *     {"instrument":{"isCall":false,"takerSide":"buy"},"rowSide":"bull",
 *      "rowStatusLabel":"Open · syncing","cardSideLabel":"Bear",
 *      "cardStatusLabel":"Open · syncing"}
 *
 *   post-fill card, same stored row at three statuses
 *     {"confirmed":{"sideLabel":"Bull","statusLabel":"Open · syncing"},
 *      "expired":  {"sideLabel":"Bull","statusLabel":"Open · syncing"},
 *      "settled":  {"sideLabel":"Bull","statusLabel":"Open · syncing"}}
 *
 * The order is the documented Base fill `0x9c4bb145…828f8c`: a BOUGHT PUT, i.e.
 * `isCall: false`, `takerSide: "buy"`, which is BEAR. "Bull" came from
 * `display.ts` mapping the PARTICIPANT's side of a post ("back") and from
 * `record.ts` echoing the ticket's own Bull/Bear button; "Open · syncing" for a
 * settled row came from `record.ts` forcing `confirmed` on every non-failed row.
 *
 * The assertions are EQUALITIES between surfaces, not literals, plus the one
 * literal the option itself fixes (a bought put is bear).
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type * as Domain from "@/types";
import * as display from "@/lib/display";
import { PositionRow } from "@/components/feed/thesis-list";
import { positionInstrument } from "./instrument";
import { linkedPositionCard, positionPage } from "./view";

/** The same snapshot `live-pnl.test.ts` pins, from the same production fill. */
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
} as const;

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

/** Before the option's own expiry, so nothing is rewritten to "expired". */
const ASOF = new Date("2026-09-06T00:00:00Z");

function row(overrides: Partial<Domain.Position> = {}): Domain.Position {
	return {
		id: "69125d9b-38e3-4280-9119-61ee46fefff4",
		thesisId: null,
		userId: "u1",
		// "back" is the PARTICIPANT's side of a post; the direction below must
		// not be read off it. This is the exact field the bug read.
		side: "back",
		role: "standalone",
		status: "confirmed",
		chainId: 8453,
		walletAddress: OWNER.walletAddress,
		thesisSlug: null,
		thesisHeadline: null,
		underlyingAsset: INSTRUMENT?.asset ?? "",
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

test("the fixture really is a bought put, so 'bear' below is not vacuous", () => {
	expect(INSTRUMENT).not.toBeNull();
	expect({ isCall: INSTRUMENT?.isCall, takerSide: INSTRUMENT?.takerSide }).toEqual({
		isCall: false,
		takerSide: "buy",
	});
});

/**
 * The four surfaces, side by side. `sideLabel` and `statusLabel` must be one
 * value each; a surface that derives its own is what this test exists to catch.
 */
test("row, page card, linked card and post-fill card state ONE direction and ONE lifecycle", () => {
	const source = row();
	const rowView = display.position(source, ASOF);
	const pageCard = positionPage({
		detail: { position: source, owner: OWNER, instrument: INSTRUMENT, quantities: QUANTITIES, thesis: null },
		spotUsd8: null,
		collateralUsdPrice8: "100000000",
		asOf: ASOF,
	}).card;
	const linked = linkedPositionCard(
		{ position: source, owner: OWNER, instrument: INSTRUMENT, quantities: QUANTITIES },
		ASOF,
	);
	const fill = postFillCard("confirmed");

	const table = [
		{ surface: "list row", sideLabel: rowView.sideLabel, statusLabel: rowView.statusLabel },
		{ surface: "page card", sideLabel: pageCard.sideLabel, statusLabel: pageCard.statusLabel },
		{ surface: "linked card", sideLabel: linked.sideLabel, statusLabel: linked.statusLabel },
		{ surface: "post-fill card", sideLabel: fill.sideLabel, statusLabel: fill.statusLabel },
	];
	expect(table).toEqual([
		{ surface: "list row", sideLabel: "Bear", statusLabel: "Open · syncing" },
		{ surface: "page card", sideLabel: "Bear", statusLabel: "Open · syncing" },
		{ surface: "linked card", sideLabel: "Bear", statusLabel: "Open · syncing" },
		{ surface: "post-fill card", sideLabel: "Bear", statusLabel: "Open · syncing" },
	]);

	// And the RENDERED row, which is what the reader sees: it used to read
	// "ETH position Bull · $1 risked · Open · syncing".
	const html = renderToStaticMarkup(<PositionRow position={rowView} />);
	expect(html).toContain("Bear");
	expect(html).not.toContain("Bull");
});

/**
 * C-1's own half: the post-fill dialog is shown right after a fill, and it used
 * to say "Open · syncing" about a row whose option had already expired or
 * settled.
 */
test("the post-fill card carries the row's lifecycle, not a constant", () => {
	expect([
		postFillCard("expired").statusLabel,
		postFillCard("settled").statusLabel,
		postFillCard("failed").statusLabel,
	]).toEqual(["Settlement pending", "Settled", "Failed"]);
});

/**
 * `lib/trade/record.ts` is `server-only` and reads `users` through `@nuts/db`,
 * which is constructed eagerly from `DATABASE_URL`. `mock.module` would do it —
 * but Bun's module mocks LEAK ACROSS TEST FILES in one run (measured: a mock in
 * `x1-mock.test.ts` was still installed in `x2-real.test.ts`), and the live
 * integration suites in this repo need the real `@nuts/db`. So the card is built
 * in a CHILD process, the same isolation `lib/page-data.wiring.test.ts` uses.
 *
 * Only the database read is stubbed. `fillCard`, `pnlCard`, the snapshot decode
 * and the lifecycle rule are all production code.
 */
function postFillCard(status: string): { sideLabel: string | null; statusLabel: string } {
	const script = `
		import { plugin } from "bun";
		plugin({ name: "one-direction-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
			build.module("@nuts/db", () => ({ exports: {
				db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
			}, loader: "object" }));
		}});
		const SNAPSHOT = ${JSON.stringify(ORDER_SNAPSHOT)};
		const { fillCard } = await import("@/lib/trade/record");
		const card = await fillCard(
			{
				v: 1, userId: "u1", wallet: ${JSON.stringify(OWNER.walletAddress)}, chainId: 8453,
				structureId: "s1", instrumentLabel: "ETH physical put 2,340 P",
				// The ticket says BULL on purpose: the button the user pressed is
				// not the direction of the option that was filled.
				side: "bull", taker: "buy", thesisId: null, role: "standalone", positionSide: "back",
				optionBook: "0x1bDff855d6811728acaDC00989e79143a2bdfDed", budget: "1000000",
				collateralAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				collateralSymbol: "USDC", collateralDecimals: 6, contractSizeDecimals: 6,
				expectedContracts: "389926", expectedPremium: "999998", expectedFee: "124999",
				expectedCollateral: "0", maxLossUsd8: null, maxPayoutUsd8: null, breakEvenUsd8: null,
				orderSnapshot: SNAPSHOT, issuedAt: 1788000000,
			},
			{
				id: "69125d9b-38e3-4280-9119-61ee46fefff4", thesisId: null, userId: "u1",
				role: "standalone", side: "back", status: ${JSON.stringify(status)}, chainId: 8453,
				walletAddress: ${JSON.stringify(OWNER.walletAddress)}, orderId: "o1", orderHash: null,
				orderSnapshot: SNAPSHOT, fillEvent: null, indexerPositionId: null,
				txHash: "0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c",
				ticketHash: null, failureReason: ${status === "failed" ? '"transaction_reverted"' : "null"},
				optionAddress: null, referrer: null, budget: "1000000", budgetDecimals: 6,
				contracts: "389926", contractDecimals: 6, premium: "999998", premiumDecimals: 6,
				fees: "124999", feeDecimals: 6, collateral: "0", collateralDecimals: 6,
				maximumLoss: "999998", maximumLossDecimals: 6, maximumPayout: null, maximumPayoutDecimals: null,
				breakEvenPrices: [], breakEvenPriceDecimals: 8, estimatedPnl: null, estimatedPnlDecimals: null,
				settlementPrice: null, settlementPriceDecimals: null, payout: null, payoutDecimals: null,
				finalPnl: null, finalPnlDecimals: null, entryPremiumUsd: "0.999998", entryFeesUsd: "0.124999",
				maximumLossUsd: "0.999998", maximumPayoutUsd: null, breakEvenPricesUsd: [],
				estimatedPnlUsd: null, finalPnlUsd: null, settlementPriceUsd: null,
				createdAt: new Date("2026-09-05T12:00:00Z"), confirmedAt: new Date("2026-09-05T12:00:00Z"),
				indexedAt: null, settledAt: null,
			},
			{ spotUsd8: () => null, collateralUsdPrice8: () => "100000000", feedError: null },
		);
		console.log("RESULT:" + JSON.stringify({ sideLabel: card.sideLabel, statusLabel: card.statusLabel }));
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: {
			...process.env,
			DATABASE_URL: "",
			DIRECT_DATABASE_URL: "",
			SKIP_ENV_VALIDATION: "1",
			SESSION_SECRET: "0123456789012345678901234567890123",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("RESULT:".length));
}
