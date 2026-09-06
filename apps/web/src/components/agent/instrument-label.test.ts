/**
 * T-2 / T-5 (Opus user-flow tester): what an approval card is allowed to say
 * about the thing being approved.
 *
 * The fence that matters is the FIRST test: the collateral map in
 * `instrument-label.ts` is a copy of the SDK's `chainConfig.tokens`, and a copy
 * rots. It is read back from the SDK here, so a token added, renamed or moved
 * fails this file rather than mislabelling a currency on a money card.
 *
 * The decoder itself is proven against a key built by the REAL `instrumentKey`,
 * not against a string typed from the grammar in a comment.
 */
import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

import { createReadClient } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";

import { instrumentKey } from "@/lib/thetanuts/instrument";
import type { TradeableOrder } from "@/lib/thetanuts/types";
import {
	COLLATERAL_SYMBOLS,
	collateralSymbol,
	decimalFromScaled,
	describeInstrumentKey,
	formatUtcIso,
	formatUtcSeconds,
	strikeUsd,
} from "./instrument-label";

test("the collateral map IS the SDK's own token map on Base", () => {
	// No network: `chainConfig` is a static table (SDK dist/index.js:24-64).
	const client = createReadClient({ rpcUrl: "http://127.0.0.1:1", referrer: env.THESIS_REFERRER });
	const fromSdk = Object.fromEntries(
		Object.values(client.chainConfig.tokens as Record<string, { address: string; symbol: string }>).map((token) => [
			token.address.toLowerCase(),
			token.symbol,
		]),
	);
	console.log("SDK_TOKENS", JSON.stringify(fromSdk));
	expect(COLLATERAL_SYMBOLS).toEqual(fromSdk);
});

test("an address the map does not name gets NO symbol", () => {
	expect(collateralSymbol("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe("USDC");
	// Checksummed, lowercase and padded-with-spaces all resolve the same way.
	expect(collateralSymbol("  0x4e65fe4dba92790696d040ac24aa414708f5c0ab ")).toBe("aBasUSDC");
	for (const wrong of ["0x0000000000000000000000000000000000000001", "", "USDC", "constructor", null, undefined]) {
		expect(collateralSymbol(wrong as string | null), String(wrong)).toBeNull();
	}
});

test("a scaled integer becomes a decimal with no float in between", () => {
	// The book's own scale, `lib/thetanuts/orders.ts:62`.
	expect(strikeUsd("220000000000")).toBe("2200");
	expect(strikeUsd("254000000000")).toBe("2540");
	expect(strikeUsd("9058000")).toBe("0.09058");
	expect(decimalFromScaled("1", 8)).toBe("0.00000001");
	expect(decimalFromScaled("100000000", 8)).toBe("1");
	expect(decimalFromScaled("2540", 0)).toBe("2540");
	for (const bad of ["", "-1", "2.5", "abc", "1e8"]) expect(decimalFromScaled(bad, 8), bad).toBeNull();
});

test("an instant reads the same on the server and in a browser", () => {
	// Built by hand rather than through `Intl`, which differs by ICU build and
	// would be a hydration mismatch on an approval card.
	expect(formatUtcIso("2026-09-18T00:00:00Z")).toBe("18 Sep 2026, 00:00 UTC");
	expect(formatUtcIso("2026-09-30T08:00:00Z")).toBe("30 Sep 2026, 08:00 UTC");
	// 1790000000 is 2026-09-21T14:13:20.000Z (measured with `new Date(...).toISOString()`).
	expect(formatUtcSeconds(1_790_000_000)).toBe("21 Sep 2026, 14:13 UTC");
	for (const bad of ["", "not a date", null, undefined]) expect(formatUtcIso(bad), String(bad)).toBeNull();
	expect(formatUtcSeconds(Number.NaN)).toBeNull();
});

/**
 * A `TradeableOrder` as `instrumentKey` reads it — only the seven fields it
 * touches, so the key under test is built by the REAL function.
 */
function order(over: Partial<{ asset: string | null; side: "buy" | "sell" }> = {}): TradeableOrder {
	return {
		asset: over.asset === undefined ? "ETH" : over.asset,
		side: over.side ?? "buy",
		entry: {
			order: {
				collateral: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
				isCall: true,
				strikes: ["254000000000"],
				expiry: 1_757_232_000,
				implementation: "0x6aD53DD058bea004829cCf58a282C21a7Df02DcA",
			},
		},
	} as unknown as TradeableOrder;
}

test("T-2: the key the tool carries decodes into what the user is approving", () => {
	const key = instrumentKey(order());
	console.log("KEY", key);
	const described = describeInstrumentKey(key);
	console.log("DESCRIBED", JSON.stringify(described));
	expect(described).toEqual({
		asset: "ETH",
		side: "buy",
		right: "call",
		strikesUsd: ["2540"],
		expiryAt: "07 Sep 2025, 08:00 UTC",
		collateralSymbol: "USDC",
	});
});

test("a spread keeps both strikes, and an unknown asset is null rather than '?'", () => {
	const spread = describeInstrumentKey("ETH|buy|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913|P|245000000000/250000000000|1757232000|0x6ad53dd058bea004829ccf58a282c21a7df02dca");
	console.log("SPREAD", JSON.stringify(spread));
	expect(spread?.strikesUsd).toEqual(["2450", "2500"]);
	expect(spread?.right).toBe("put");
	expect(describeInstrumentKey(instrumentKey(order({ asset: null })))?.asset).toBeNull();
});

test("anything that is not one of our keys describes nothing", () => {
	for (const bad of ["", "ETH", "ETH|buy", "a|b|c|d|e|f|g|h", null, undefined]) {
		expect(describeInstrumentKey(bad as string | null), String(bad)).toBeNull();
	}
	// Seven fields, but the fields themselves are junk: each unreadable part is
	// null on its own rather than making the whole description a guess.
	const junk = describeInstrumentKey("?|neither|0xdead|X|nope|later|0x1");
	console.log("JUNK", JSON.stringify(junk));
	expect(junk).toEqual({
		asset: null,
		side: null,
		right: null,
		strikesUsd: [],
		expiryAt: null,
		collateralSymbol: null,
	});
});
