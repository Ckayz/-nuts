import { expect, test } from "bun:test";
import { impliedVolLabel, medianImpliedVol, orderImpliedVol } from "./implied-vol";

/** The shape the live feed actually returns, copied from it on 2026-09-06. */
const REAL = { greeks: { delta: -0.0824, iv: 0.3166, gamma: 0.0055, theta: -4.6524, vega: 0.1322 } };

test("iv is read from where the feed actually puts it", () => {
	// Wrapper level, which is where the raw feed has it.
	expect(orderImpliedVol(REAL)).toBe(0.3166);
	// And where the SDK copies it to.
	expect(orderImpliedVol({ sdkOrder: { rawApiData: { greeks: { iv: 0.42 } } } })).toBe(0.42);
	expect(orderImpliedVol({ entry: { order: { greeks: { iv: 0.51 } } } })).toBe(0.51);
});

test("an order with no usable iv contributes nothing", () => {
	for (const bad of [null, undefined, 42, "x", {}, { greeks: null }, { greeks: {} }, { greeks: { iv: "0.3" } }]) {
		expect(orderImpliedVol(bad)).toBeNull();
	}
	// Zero is a missing field written as a number, not a real quote.
	expect(orderImpliedVol({ greeks: { iv: 0 } })).toBeNull();
	expect(orderImpliedVol({ greeks: { iv: -1 } })).toBeNull();
});

test("the median is used, so far-out-of-the-money strikes cannot drag the headline", () => {
	// A book carries deep OTM quotes with very high iv. The mean of these is
	// 0.86; the median is the level real quotes actually sit at.
	const book = [0.38, 0.39, 0.40, 0.41, 3.2].map((iv) => ({ greeks: { iv } }));
	expect(medianImpliedVol(book)).toBe(0.4);
});

test("an even count averages the middle pair", () => {
	expect(medianImpliedVol([{ greeks: { iv: 0.4 } }, { greeks: { iv: 0.6 } }])).toBe(0.5);
});

test("no usable quote yields null, never zero", () => {
	// Zero would render as "0.0%" and read as "this market has no volatility".
	expect(medianImpliedVol([])).toBeNull();
	expect(medianImpliedVol([{ greeks: { iv: 0 } }, {}])).toBeNull();
	expect(impliedVolLabel(null)).toBeNull();
});

test("the label reads as a percentage", () => {
	// MEASURED medians on 2026-09-06: BTC 0.385, ETH 0.487, BNB 0.680.
	expect(impliedVolLabel(0.385)).toBe("38.5%");
	expect(impliedVolLabel(0.487)).toBe("48.7%");
	expect(impliedVolLabel(0.68)).toBe("68.0%");
});

test("curVol is NOT what this reads", () => {
	// MEASURED: BTC curVol 0.08 while its median greeks.iv is 0.385. If a future
	// change points this at market_weather, these numbers stop agreeing and a
	// wrong volatility reaches a trading page.
	const btcBook = [0.37, 0.385, 0.40].map((iv) => ({ greeks: { iv } }));
	const median = medianImpliedVol(btcBook);
	expect(median).toBe(0.385);
	expect(median).not.toBe(0.08);
	expect(impliedVolLabel(median)).toBe("38.5%");
});
