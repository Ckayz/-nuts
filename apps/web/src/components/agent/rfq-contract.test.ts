/**
 * The pure half of the RFQ card: ordering, the economics comparison, the poll
 * bound and the durable hold.
 *
 * Each of these is a place where being wrong is silent — a spread printed
 * high-strike-first reads as a different trade, a hold written under the FILL
 * key is handed to the wrong recorder, an unbounded poll reads forever from an
 * abandoned tab.
 */
import { describe, expect, test } from "bun:test";
import { heldFillKey } from "@/lib/trade/held-fill";
import {
	clearHeldRfq,
	compareDecimalStrings,
	nextPollDelayMs,
	type PreparedRfqCreate,
	readHeldRfq,
	RFQ_MAX_POLLS,
	RFQ_POLL_MS,
	rfqCanCancel,
	rfqCanSettle,
	rfqCreateRequestOf,
	rfqHoldKey,
	type RfqExpected,
	type RfqStatusView,
	sameRfqEconomics,
	strikesAscending,
	writeHeldRfq,
} from "./rfq-contract";

const EXPECTED: RfqExpected = {
	depositBaseUnits: "5000000",
	deposit: "5",
	strikesUsd: ["2200", "2100"],
	numContracts: "1",
	expiryAt: "2026-09-30T08:00:00Z",
	offerEndAt: "2026-09-06T03:00:00Z",
	factory: "0x8118dad971debffb49b9280047659174128a8b94",
	maxLossUsd: "5",
};

describe("decimal ordering without a float", () => {
	test("orders by magnitude, not lexicographically", () => {
		const cases: Array<[string, string, number]> = [
			["9", "10", -1],
			["10", "9", 1],
			["2100", "2200", -1],
			["2200", "2100", 1],
			["1.5", "1.45", 1],
			["1.45", "1.5", -1],
			["1.50", "1.5", 0],
			["0001", "1", 0],
			["2100.00000000", "2100", 0],
			["0.1", "0.09", 1],
		];
		const got = cases.map(([left, right]) => compareDecimalStrings(left, right));
		console.log("ORDER", JSON.stringify(got));
		expect(got).toEqual(cases.map(([, , want]) => want));
	});

	test("a put spread is displayed ascending, from a copy", () => {
		const factoryOrder = ["2200", "2100"];
		expect(strikesAscending(factoryOrder)).toEqual(["2100", "2200"]);
		// The array the card also compares against is untouched.
		expect(factoryOrder).toEqual(["2200", "2100"]);
		// A vanilla put has one strike and is unchanged.
		expect(strikesAscending(["2100"])).toEqual(["2100"]);
	});
});

describe("sameRfqEconomics", () => {
	test("the same terms match", () => {
		expect(sameRfqEconomics(EXPECTED, { ...EXPECTED })).toBe(true);
		// The factory address is compared case-insensitively: it is an address.
		expect(sameRfqEconomics(EXPECTED, { ...EXPECTED, factory: EXPECTED.factory.toUpperCase() })).toBe(true);
	});

	test("every field that changes what is paid stops the match", () => {
		const changes: Array<Partial<RfqExpected>> = [
			{ depositBaseUnits: "7000000" },
			{ numContracts: "2" },
			{ expiryAt: "2026-10-30T08:00:00Z" },
			{ offerEndAt: "2026-09-06T04:00:00Z" },
			{ factory: "0x1bdff855d6811728acadc00989e79143a2bdfded" },
			{ strikesUsd: ["2200", "2000"] },
			// The ORDER is part of the identity: the factory's own order is what
			// was encoded, so a reordered pair is not the same calldata.
			{ strikesUsd: ["2100", "2200"] },
		];
		const got = changes.map((change) => sameRfqEconomics(EXPECTED, { ...EXPECTED, ...change }));
		console.log("ECONOMICS", JSON.stringify(got));
		expect(got).toEqual(changes.map(() => false));
	});

	test("an absent side never matches", () => {
		expect(sameRfqEconomics(null, EXPECTED)).toBe(false);
		expect(sameRfqEconomics(EXPECTED, null)).toBe(false);
	});
});

describe("the request the card re-prepares from", () => {
	const envelope = { prepared: true, kind: "rfq_create", ok: true, stage: "create" } as const;

	test("a nested request is used as it stands", () => {
		const request = {
			underlying: "ETH" as const,
			strikesUsd: ["2200", "2100"],
			expiry: 1_790_000_000,
			numContracts: "1",
			reservePricePerContract: "5",
			offerDeadlineMinutes: 60,
		};
		expect(rfqCreateRequestOf({ ...envelope, request } as unknown as PreparedRfqCreate)).toEqual(request);
	});

	test("flat fields are read as a fallback, so either tool shape works", () => {
		const flat = {
			...envelope,
			underlying: "BTC" as const,
			strikesUsd: ["90000"],
			expiry: "2026-09-30T08:00:00Z",
			numContracts: "0.5",
			reservePricePerContract: "12",
		};
		expect(rfqCreateRequestOf(flat as unknown as PreparedRfqCreate)).toEqual({
			underlying: "BTC",
			strikesUsd: ["90000"],
			expiry: "2026-09-30T08:00:00Z",
			numContracts: "0.5",
			reservePricePerContract: "12",
		});
	});

	test("an incomplete envelope is null — the card refuses to send what it cannot rebuild", () => {
		expect(rfqCreateRequestOf({ ...envelope } as unknown as PreparedRfqCreate)).toBeNull();
		expect(
			rfqCreateRequestOf({
				...envelope,
				underlying: "ETH",
				strikesUsd: ["2100"],
				expiry: 1,
				numContracts: "1",
			} as unknown as PreparedRfqCreate),
		).toBeNull();
	});
});

describe("which controls a status earns", () => {
	const view = (over: Partial<RfqStatusView>): RfqStatusView => ({
		status: "waiting_for_offers",
		nextAction: "wait",
		sentence: "",
		...over,
	});

	test("cancel while the quotation is live, never after", () => {
		const live: RfqStatusView["status"][] = ["waiting_for_offers", "reveal_window", "ready_to_settle"];
		const over: RfqStatusView["status"][] = ["settled", "cancelled", "expired_unfilled", "failed"];
		expect(live.map((status) => rfqCanCancel(view({ status })))).toEqual(live.map(() => true));
		expect(over.map((status) => rfqCanCancel(view({ status })))).toEqual(over.map(() => false));
		expect(rfqCanCancel(null)).toBe(false);
	});

	test("settle ONLY when the server says ready AND asks for it", () => {
		expect(rfqCanSettle(view({ status: "ready_to_settle", nextAction: "settle" }))).toBe(true);
		// Every near miss is false: a label without the instruction, the instruction
		// without the label, the reveal window still open, and no status at all.
		const misses = [
			view({ status: "ready_to_settle", nextAction: "wait" }),
			view({ status: "reveal_window", nextAction: "settle" }),
			view({ status: "waiting_for_offers", nextAction: "wait" }),
			view({ status: "settled", nextAction: "none" }),
		];
		console.log("SETTLE_GATE", JSON.stringify(misses.map(rfqCanSettle)));
		expect(misses.map(rfqCanSettle)).toEqual([false, false, false, false]);
		expect(rfqCanSettle(null)).toBe(false);
	});
});

describe("the poll is bounded", () => {
	const waiting: RfqStatusView = { status: "waiting_for_offers", nextAction: "wait", sentence: "" };

	test("it reads while the request waits, and stops at the cap", () => {
		expect(nextPollDelayMs(waiting, 0)).toBe(RFQ_POLL_MS);
		expect(nextPollDelayMs(waiting, RFQ_MAX_POLLS - 1)).toBe(RFQ_POLL_MS);
		expect(nextPollDelayMs(waiting, RFQ_MAX_POLLS)).toBeNull();
		expect(nextPollDelayMs(waiting, RFQ_MAX_POLLS + 1)).toBeNull();
	});

	test("it stops the moment the request is not waiting on anything", () => {
		for (const nextAction of ["settle", "cancel", "none"] as const) {
			expect(nextPollDelayMs({ ...waiting, nextAction }, 0), nextAction).toBeNull();
		}
		expect(nextPollDelayMs(null, 0)).toBeNull();
	});
});

describe("the durable hold", () => {
	function store() {
		const map = new Map<string, string>();
		return {
			map,
			getItem: (key: string) => map.get(key) ?? null,
			setItem: (key: string, value: string) => {
				map.set(key, value);
			},
			removeItem: (key: string) => {
				map.delete(key);
			},
		};
	}
	const WALLET = "0x00000000000000000000000000000000000000A1";
	const HASH = `0x${"1".repeat(64)}`;

	test("it is NOT the fill hold — a create must never reach `recordTrade`", () => {
		expect(rfqHoldKey(8453, WALLET)).not.toBe(heldFillKey(8453, WALLET));
		// Keyed by chain and wallet, lowercase, like the fill hold.
		expect(rfqHoldKey(8453, WALLET)).toBe(rfqHoldKey(8453, WALLET.toLowerCase()));
	});

	test("a hold round-trips and clears", () => {
		const s = store();
		writeHeldRfq(s, 8453, WALLET, { token: "tok", txHash: HASH, kind: "create" });
		expect(readHeldRfq(s, 8453, WALLET)).toEqual({ token: "tok", txHash: HASH, kind: "create" });
		clearHeldRfq(s, 8453, WALLET);
		expect(readHeldRfq(s, 8453, WALLET)).toBeNull();
	});

	test("a cancel keeps the row it acts on", () => {
		const s = store();
		writeHeldRfq(s, 8453, WALLET, { token: "tok", txHash: HASH, kind: "cancel", rfqRequestId: "row-1" });
		expect(readHeldRfq(s, 8453, WALLET)?.rfqRequestId).toBe("row-1");
	});

	test("anything malformed is absent AND removed, never an argument to a recorder", () => {
		const bad = [
			"not json",
			JSON.stringify({ token: "tok", txHash: HASH }),
			JSON.stringify({ token: "tok", txHash: "0xdeadbeef", kind: "create" }),
			JSON.stringify({ token: "", txHash: HASH, kind: "create" }),
			JSON.stringify({ token: "tok", txHash: HASH, kind: "fill" }),
			JSON.stringify(["tok", HASH]),
		];
		const results = bad.map((raw) => {
			const s = store();
			s.setItem(rfqHoldKey(8453, WALLET), raw);
			const read = readHeldRfq(s, 8453, WALLET);
			return { read, left: s.map.size };
		});
		console.log("MALFORMED", JSON.stringify(results));
		expect(results).toEqual(bad.map(() => ({ read: null, left: 0 })));
	});

	test("no store and no wallet are survivable, not crashes", () => {
		expect(readHeldRfq(null, 8453, WALLET)).toBeNull();
		expect(readHeldRfq(store(), 8453, null)).toBeNull();
		writeHeldRfq(null, 8453, WALLET, { token: "t", txHash: HASH, kind: "create" });
		clearHeldRfq(null, 8453, WALLET);
		const throwing = {
			getItem: () => {
				throw new Error("site data blocked");
			},
			setItem: () => {
				throw new Error("site data blocked");
			},
			removeItem: () => {
				throw new Error("site data blocked");
			},
		};
		expect(readHeldRfq(throwing, 8453, WALLET)).toBeNull();
		writeHeldRfq(throwing, 8453, WALLET, { token: "t", txHash: HASH, kind: "create" });
		clearHeldRfq(throwing, 8453, WALLET);
	});
});
