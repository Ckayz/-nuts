import { describe, expect, test } from "bun:test";
import { env } from "@nuts/env/server";
import { quoteFill, quoteSellFill, takerSide as packageTakerSide } from "@nuts/thetanuts";
import { getLiveMarkets, readClient } from "./live";
import { quoteStructure } from "./quote";
import { measuredTakerSide, takerSideDisagreement } from "./taker-side";
import { formatBaseUnits, formatUsd8 } from "./units";
import { buyContractSizeDecimals, collateralUsdPrice } from "@/lib/thetanuts/orders";
import { loadProductionFill, PRODUCTION_FILLS } from "@/lib/trade/production-fills";

/**
 * Live-book tests. They read Base mainnet over read-only RPC and the public
 * OptionBook feed; no transaction is ever sent and this process holds no key.
 * Every asserted money figure is recomputed from raw base units by the formula
 * in the assertion, never copied from the code under test.
 */

const book = await getLiveMarkets(true);
if ("error" in book) throw new Error(`Order book unavailable: ${book.detail}`);
const structures = book.assets.flatMap((asset) => asset.structures);
console.log(
	`[live book] ${book.fetchedAt.toISOString()} assets=${book.assets.length} structures=${structures.length}`,
);

describe("taker side: the shared package against the chain", () => {
	test("the measured rule is the inverse of packages/thetanuts/src/side.ts, on every live order", async () => {
		let checked = 0;
		let inverted = 0;
		for (const structure of structures) {
			for (const order of [structure.buy, structure.sell]) {
				if (order === null) continue;
				const raw = order.order.rawApiData;
				if (!raw) continue;
				checked++;
				if (packageTakerSide(order.order) !== measuredTakerSide(raw.isLong)) inverted++;
			}
		}
		console.log(`[taker side] live orders checked ${checked}, package disagrees on ${inverted}`);
		expect(checked).toBeGreaterThan(0);
		expect(inverted).toBe(checked);
	});

	test("the two decoded production fills settle it: isLong true means the taker SOLD", async () => {
		for (const expectation of PRODUCTION_FILLS) {
			const fill = await loadProductionFill(expectation.hash);
			const raw = fill.order.rawApiData;
			if (!raw) throw new Error("no raw order");
			// `sellerWasMaker` is the chain's own statement of who took which side.
			expect(fill.takerSide).toBe(expectation.takerSide);
			expect(measuredTakerSide(raw.isLong)).toBe(expectation.takerSide);
			expect(packageTakerSide(fill.order)).not.toBe(expectation.takerSide);
			console.log(
				`[fill ${fill.hash.slice(0, 10)}] isLong=${raw.isLong} sellerWasMaker=${fill.event.sellerWasMaker} ` +
					`chain says taker ${fill.takerSide.toUpperCase()}, package says ${packageTakerSide(fill.order).toUpperCase()}`,
			);
		}
	});

	test("the package contradicts itself: its own verified sell pair fails its own side gate", async () => {
		// `VERIFIED_SELL_PAIRS` was derived from this very transaction, and
		// `quoteSellFill` refuses the order it was derived from.
		const expectation = PRODUCTION_FILLS.find((fill) => fill.takerSide === "sell");
		if (expectation === undefined) throw new Error("no sell fixture");
		const fill = await loadProductionFill(expectation.hash);
		expect(() =>
			quoteSellFill({
				client: readClient(),
				order: fill.order,
				collateralBudget: expectation.takerCollateral,
				referrer: env.THESIS_REFERRER,
				now: fill.blockTimeSeconds - 1,
			}),
		).toThrow(/Sell quotes require a taker-sell order/);
	});

	test("no live structure can be quoted while the two disagree: this app fails closed", () => {
		const codes = new Map<string, number>();
		for (const structure of structures) {
			for (const side of ["bull", "bear"] as const) {
				const order = side === "bull" ? structure.buy : structure.sell;
				if (order === null) continue;
				const quote = quoteStructure({
					client: readClient(),
					market: order,
					side: side === "bull" ? "buy" : "sell",
					budget: 10n ** BigInt(structure.collateralDecimals ?? 6),
					referrer: env.THESIS_REFERRER,
				});
				const code = quote.ok ? "OK" : quote.code;
				codes.set(code, (codes.get(code) ?? 0) + 1);
			}
		}
		console.log("[quote refusals]", Object.fromEntries(codes));
		expect(codes.get("OK") ?? 0).toBe(0);
		expect(codes.size).toBeGreaterThan(0);
	});
});

describe("taker-BUY money, reproduced from decoded fill 0x9c4bb1…", () => {
	const expectation = PRODUCTION_FILLS.find((fill) => fill.takerSide === "buy");
	if (expectation === undefined) throw new Error("no buy fixture");

	test("premium, fee and the taker's debit come out of raw units exactly", async () => {
		const fill = await loadProductionFill(expectation.hash);
		const price = fill.order.order.price;
		const contracts = expectation.numContracts;

		// premium = numContracts * price / 1e8, floored.
		const premium = (contracts * price) / 100_000_000n;
		expect(premium).toBe(expectation.premium);
		expect(premium).toBe(fill.event.premiumAmount);
		// fee = 12.5% of the premium (the only branch any decoded fill exercises).
		expect((premium * 1250n) / 10000n).toBe(expectation.fee);
		expect((premium * 1250n) / 10000n).toBe(fill.event.feeCollected);
		// The buyer's whole debit IS the premium; the fee is carved out of it.
		expect(expectation.takerDebit).toBe(premium);
		expect(expectation.takerCollateral).toBe(0n);
		// A long option's max loss is the premium, in USD at the 1 USD peg.
		const premiumUsd8 = (premium * 100_000_000n) / 10n ** BigInt(expectation.collateralDecimals);
		expect(collateralUsdPrice(expectation.collateralSymbol)).toBe(1);
		expect(buyContractSizeDecimals(expectation.collateralDecimals)).toBe(expectation.contractSizeDecimals);

		// max payout = strike * contracts / 10**contractSizeDecimals - premium
		const strike = BigInt(fill.order.rawApiData?.strikes[0] ?? "0");
		const scale = 10n ** BigInt(expectation.contractSizeDecimals);
		const maxPayoutUsd8 = (strike * contracts) / scale - premiumUsd8;
		// break-even = strike - premium per contract
		const breakEvenUsd8 = strike - (premiumUsd8 * scale) / contracts;

		// The SDK sizes the same contract count from the budget that buys it.
		// Sizing floors (`contracts = budget * 1e8 / price`) and premium floors
		// again, so the round trip needs the CEILING of the premium: feeding the
		// floored premium back gives one contract unit less, measured here.
		const ceilingBudget = (contracts * price + 99_999_999n) / 100_000_000n;
		const preview = readClient().optionBook.previewFillOrder(fill.order, ceilingBudget, env.THESIS_REFERRER);
		expect(preview.pricePerContract).toBe(price);
		expect(preview.numContracts).toBe(contracts);
		const flooredBack = readClient().optionBook.previewFillOrder(fill.order, premium, env.THESIS_REFERRER);
		expect(flooredBack.numContracts).toBe(contracts - 1n);

		console.log(
			[
				`[buy ${fill.hash}]`,
				`  price/contract   ${price} / 1e8 = ${formatBaseUnits(price, 8)}`,
				`  numContracts     ${contracts} / 1e${expectation.contractSizeDecimals} = ${formatBaseUnits(contracts, expectation.contractSizeDecimals)}`,
				`  premium          ${contracts} * ${price} / 1e8 = ${premium} = ${formatBaseUnits(premium, 6)} USDC   (event ${fill.event.premiumAmount})`,
				`  fee              ${premium} * 1250 / 10000 = ${(premium * 1250n) / 10000n}          (event ${fill.event.feeCollected})`,
				`  taker debit      ${expectation.takerDebit} = ${formatBaseUnits(expectation.takerDebit, 6)} USDC`,
				`  max loss  USD8   ${premiumUsd8} = $${formatUsd8(premiumUsd8)}`,
				`  max payout USD8  ${strike} * ${contracts} / 1e6 - ${premiumUsd8} = ${maxPayoutUsd8} = $${formatUsd8(maxPayoutUsd8)}`,
				`  break-even USD8  ${strike} - ${premiumUsd8} * 1e6 / ${contracts} = ${breakEvenUsd8} = $${formatUsd8(breakEvenUsd8)}`,
				`  budget->size     ceil(${contracts} * ${price} / 1e8) = ${ceilingBudget} -> ${preview.numContracts} contract units`,
			].join("\n"),
		);
	});

	test("the package's buy API refuses this order, because its side rule is inverted", async () => {
		const fill = await loadProductionFill(expectation.hash);
		expect(() =>
			quoteFill({
				client: readClient(),
				order: fill.order,
				budget: expectation.premium,
				referrer: env.THESIS_REFERRER,
				now: fill.blockTimeSeconds - 1,
			}),
		).toThrow(/collateral-funded sell API/);
		expect(takerSideDisagreement(fill.order)).toContain("Trading is blocked");
	});
});

describe("taker-SELL money, reproduced from decoded fill 0xdf3323…", () => {
	const expectation = PRODUCTION_FILLS.find((fill) => fill.takerSide === "sell");
	if (expectation === undefined) throw new Error("no sell fixture");

	test("collateral, premium and fee come out of raw units exactly", async () => {
		const fill = await loadProductionFill(expectation.hash);
		const raw = fill.order.rawApiData;
		if (!raw) throw new Error("no raw order");
		const strike = BigInt(raw.strikes[0] ?? "0");
		const contracts = expectation.numContracts;
		const price = fill.order.order.price;

		// seller collateral = strike * contracts / 1e8 — the measured transfer.
		const collateral = (strike * contracts) / 100_000_000n;
		expect(collateral).toBe(expectation.takerCollateral);
		expect(collateral).toBe(expectation.takerDebit);
		// The SDK's own bigint helper agrees, at the decimals the package pins.
		const fromSdk = readClient().utils.calculateCollateral({
			type: "put",
			strikes: [strike],
			numContracts: contracts,
			priceDecimals: 8,
			sizeDecimals: expectation.contractSizeDecimals,
			collateralDecimals: expectation.collateralDecimals,
		});
		expect(fromSdk).toBe(collateral);
		// premium and fee, same formulas as the buy side.
		const premium = (contracts * price) / 100_000_000n;
		expect(premium).toBe(expectation.premium);
		expect(premium).toBe(fill.event.premiumAmount);
		const fee = (premium * 1250n) / 10000n;
		expect(fee).toBe(expectation.fee);
		expect(fee).toBe(fill.event.feeCollected);
		// The seller keeps premium minus fee, and their loss reaches the collateral.
		const net = premium - fee;
		const maxLoss = collateral - net;
		const usd8 = (value: bigint) => (value * 100_000_000n) / 10n ** BigInt(expectation.collateralDecimals);

		console.log(
			[
				`[sell ${fill.hash}]`,
				`  strike           ${strike} / 1e8 = ${formatBaseUnits(strike, 8)}`,
				`  numContracts     ${contracts} / 1e6 = ${formatBaseUnits(contracts, 6)}`,
				`  collateral       ${strike} * ${contracts} / 1e8 = ${collateral} = ${formatBaseUnits(collateral, 6)} aBasUSDC  (SDK helper ${fromSdk})`,
				`  premium gross    ${contracts} * ${price} / 1e8 = ${premium}                    (event ${fill.event.premiumAmount})`,
				`  fee              ${premium} * 1250 / 10000 = ${fee}                            (event ${fill.event.feeCollected})`,
				`  premium net      ${premium} - ${fee} = ${net} = ${formatBaseUnits(net, 6)} aBasUSDC`,
				`  max loss         ${collateral} - ${net} = ${maxLoss} = $${formatUsd8(usd8(maxLoss))}`,
				`  max payout       ${net} = $${formatUsd8(usd8(net))}`,
			].join("\n"),
		);
		expect(maxLoss).toBe(22000000n - (21268n - 2658n));
	});
});
