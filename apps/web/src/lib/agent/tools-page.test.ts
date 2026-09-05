/**
 * m6 — the agent contradicted the market page.
 *
 * Measured on the live book 2026-09-06 (fold-final-D §14, re-measured here against
 * a fake book): `searchOptionBookOrders` defaulted `limit` to 6 and returned the
 * first six of 26 matching ETH call spreads. The 2450/2500 spread sat at index 9,
 * quoted and selectable on `/m/eth` at that moment, and the agent told the user it
 * "is not on the Thetanuts orderbook right now".
 *
 * The page cap is the owner's number and is untouched. What these tests pin is that
 * the page ANNOUNCES itself as a page (`truncated`, and a note that says a page is
 * not evidence of absence), and that a named structure can be looked up directly by
 * its strikes instead of being paged for.
 */
import { expect, test, mock, spyOn } from "bun:test";
import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";

mock.module("server-only", () => ({}));
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

const { getOrderSnapshot, rawOrderApi, readClient, isFeedUnavailable } = await import("@/lib/thetanuts/orders");
const { searchOptionBookOrders, normalizeStrikes } = await import("./tools");

const CTX = { toolCallId: "test", messages: [], context: {} };
const FLAT_PRICES = { prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 }, metadata: { lastUpdated: 0, currentTime: 0 } };
/** Base mainnet ETH feed, read from the SDK's own map: buildPriceFeedSymbolMap(8453). */
const ETH_FEED = "0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70";
/** SPREAD, two strikes — the same implementation the existing multi-leg tests use. */
const SPREAD = "0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134";
const A = (digit: string) => `0x${digit.repeat(40)}`;

/** One ETH taker-BUY call spread on the given strikes (1e8 units), unique per index. */
function spread(index: number, lowE8: bigint, highE8: bigint): OrderWithSignature {
	const expiry = BigInt(Math.floor(Date.now() / 1000) + 10_000 + index);
	const collateral = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
	return {
		order: {
			maker: A("1"), taker: A("0"), option: "", isBuyer: true, numContracts: 0n,
			price: 212682750n, expiry, nonce: BigInt(index + 1), optionType: 1,
			strikes: [lowE8, highE8], strikePrice: lowE8,
			collateralToken: collateral, underlyingToken: A("0"), deadline: expiry,
		},
		signature: "0x12", availableAmount: 22000000000n, makerAddress: A("1"),
		rawApiData: {
			collateral, priceFeed: ETH_FEED, implementation: SPREAD,
			strikes: [lowE8.toString(), highE8.toString()], isCall: true, isLong: false,
			orderExpiryTimestamp: Number(expiry), extraOptionData: "0x", maxCollateralUsable: "22000000000",
		},
	};
}

function rawFixture(row: OrderWithSignature) {
	return {
		signature: row.signature,
		order: { ...row.rawApiData, maker: row.order.maker, price: row.order.price.toString(), expiry: Number(row.order.expiry) },
	};
}

function mockBook(rows: unknown[]) {
	const request = spyOn(rawOrderApi, "request").mockResolvedValue({ data: { orders: rows } } as never);
	const data = spyOn(readClient.api, "getMarketData").mockResolvedValue(FLAT_PRICES);
	return () => { request.mockRestore(); data.mockRestore(); };
}

const E8 = (usd: number) => BigInt(usd) * 100_000_000n;

/**
 * The measured book shape: 26 ETH call spreads, the asked-for 2450/2500 at index 9.
 * Every other pair is 2600/2650 upwards, so nothing else can match it.
 */
function book26(): unknown[] {
	const rows: OrderWithSignature[] = [];
	for (let i = 0; i < 26; i += 1) {
		rows.push(i === 9 ? spread(i, E8(2450), E8(2500)) : spread(i, E8(2600 + i * 10), E8(2650 + i * 10)));
	}
	return rows.map(rawFixture);
}

const searched = <T,>(result: T) => {
	if (!result || typeof result !== "object" || !("totalMatched" in result)) {
		throw new Error(`expected a search result, got ${JSON.stringify(result)}`);
	}
	return result as Extract<T, { totalMatched: number; returned: number; truncated: boolean; note?: string; orders: Array<{ strikesUsd: string[] }> }>;
};

test("normalizeStrikes: trailing zeros and leg order do not change a strike set", () => {
	expect(normalizeStrikes(["2450", "2500"])).toBe(normalizeStrikes(["2500.00000000", "2450.0"]));
	expect(normalizeStrikes(["02450"])).toBe(normalizeStrikes(["2450"]));
	// Different strikes stay different: this is exact equality, not a tolerance.
	expect(normalizeStrikes(["2450"])).not.toBe(normalizeStrikes(["2451"]));
	expect(normalizeStrikes(["2450", "2500"])).not.toBe(normalizeStrikes(["2450"]));
	expect(normalizeStrikes(["2450.5"])).not.toBe(normalizeStrikes(["2450"]));
});

test("m6: a 6-of-26 page says it is a page, and the denied spread is not in it", async () => {
	const restore = mockBook(book26());
	try {
		const snapshot = await getOrderSnapshot(true);
		if (isFeedUnavailable(snapshot)) throw new Error(`unexpected ${snapshot.error}`);
		const index = snapshot.orders.findIndex((o) => o.strikesUsd.join("/") === "2450/2500");
		console.log("M6_BOOK", JSON.stringify({ total: snapshot.orders.length, indexOfAsked: index }));
		expect(snapshot.orders).toHaveLength(26);
		expect(index).toBe(9);

		const page = searched(await searchOptionBookOrders.execute!(
			{ limit: 6, asset: "ETH", direction: "call", kind: "multi_leg" }, CTX,
		));
		console.log("M6_PAGE", JSON.stringify({ totalMatched: page.totalMatched, returned: page.returned, truncated: page.truncated, note: page.note }));
		expect(page.totalMatched).toBe(26);
		expect(page.returned).toBe(6);
		// The bug's shape: the asked structure really is absent from the six shown.
		expect(page.orders.some((o) => o.strikesUsd.join("/") === "2450/2500")).toBe(false);
		// ...so the result has to say, in the result itself, that this proves nothing.
		expect(page.truncated).toBe(true);
		expect(String(page.note)).toContain("one page");
		expect(String(page.note)).toContain("6 of 26");
	} finally { restore(); }
});

test("m6: the named structure is looked up directly, whatever page it would have been on", async () => {
	const restore = mockBook(book26());
	try {
		const snapshot = await getOrderSnapshot(true);
		if (isFeedUnavailable(snapshot)) throw new Error(`unexpected ${snapshot.error}`);
		const exact = searched(await searchOptionBookOrders.execute!(
			{ limit: 6, asset: "ETH", direction: "call", kind: "multi_leg", strikesUsd: ["2450", "2500"] }, CTX,
		));
		console.log("M6_EXACT", JSON.stringify({ totalMatched: exact.totalMatched, returned: exact.returned, truncated: exact.truncated, strikes: exact.orders.map(o => o.strikesUsd) }));
		expect(exact.totalMatched).toBe(1);
		expect(exact.returned).toBe(1);
		expect(exact.truncated).toBe(false);
		expect(exact.note).toBeUndefined();
		expect(exact.orders[0]!.strikesUsd).toEqual(["2450", "2500"]);

		// The user types the legs in the other order, with trailing zeros: same instrument.
		const loose = searched(await searchOptionBookOrders.execute!(
			{ limit: 6, asset: "ETH", strikesUsd: ["2500.00", "2450"] }, CTX,
		));
		expect(loose.totalMatched).toBe(1);
		expect(loose.orders[0]!.strikesUsd).toEqual(["2450", "2500"]);

		// A structure the book really does not have is the plain "nothing matches" note,
		// not the truncation note: the whole matching set was searched.
		const none = searched(await searchOptionBookOrders.execute!(
			{ limit: 6, asset: "ETH", strikesUsd: ["9999"] }, CTX,
		));
		console.log("M6_ABSENT", JSON.stringify({ totalMatched: none.totalMatched, truncated: none.truncated, note: none.note }));
		expect(none.totalMatched).toBe(0);
		expect(none.truncated).toBe(false);
		expect(String(none.note)).toContain("Nothing on the book");
	} finally { restore(); }
});

test("m6: an exact lookup over an adapter page that could not cover the book refuses to call it absence", async () => {
	// 201 rows: `searchOrders` is asked for 200 by the tool, so the page it hands back is
	// SHORTER than the matching set and the strike filter below ran on a partial book.
	// The asked strikes are on the row the page cannot reach.
	const rows: OrderWithSignature[] = [];
	for (let i = 0; i < 200; i += 1) rows.push(spread(i, E8(3000 + i), E8(3050 + i)));
	rows.push(spread(200, E8(2450), E8(2500)));
	const restore = mockBook(rows.map(rawFixture));
	try {
		const snapshot = await getOrderSnapshot(true);
		if (isFeedUnavailable(snapshot)) throw new Error(`unexpected ${snapshot.error}`);
		expect(snapshot.orders).toHaveLength(201);
		const miss = searched(await searchOptionBookOrders.execute!(
			{ limit: 6, asset: "ETH", strikesUsd: ["2450", "2500"] }, CTX,
		));
		console.log("M6_PARTIAL", JSON.stringify({ totalMatched: miss.totalMatched, truncated: miss.truncated, note: miss.note }));
		expect(miss.totalMatched).toBe(0);
		// Fail closed: zero hits in a partial page is an unknown, never a "no".
		expect(miss.truncated).toBe(true);
		expect(String(miss.note)).toContain("NOT evidence");
	} finally { restore(); }
});

test("m6: the tool description and the system prompt both forbid inferring absence from a page", async () => {
	const { SYSTEM_PROMPT } = await import("./prompt");
	const description = String(searchOptionBookOrders.description);
	expect(description).toContain("truncated");
	expect(description).toContain("proves nothing about absence");
	expect(description).toContain("strikesUsd");
	expect(SYSTEM_PROMPT).toContain("truncated: true");
	expect(SYSTEM_PROMPT).toContain("NEVER evidence that an instrument is missing from the book");
});
