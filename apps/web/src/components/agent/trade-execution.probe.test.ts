/**
 * Component-level probes for the agent's wallet hand-off (lane C confirming
 * pass, findings 2, 3, 4, 5 and 8; lane D's D-C1). Driven through
 * `@/test/hook-runner`, which runs the REAL component function against React's
 * own dispatcher slot — every one of these bugs is in the wiring.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "@/test/hook-runner";
import { calls, HASH, neverLandingReceipt, replies, resetTradeMocks, USDC, WALLET } from "@/test/trade-mocks";
import type { QuoteRaw } from "@/lib/trade/types";
import type { PreparedTrade } from "./trade-execution";

const RAW: QuoteRaw = {
	budget: "5000000",
	numContracts: "10000",
	contractSizeDecimals: 6,
	pricePerContract: "50000000",
	premiumGross: "5000000",
	feeEstimate: "625000",
	collateralPosted: "0",
	debit: "5000000",
	credit: "0",
	makerLiquidity: "100000000",
	collateralDecimals: 6,
	collateralSymbol: "USDC",
	collateralAddress: USDC,
	maxLossUsd8: "500000000",
	maxPayoutUsd8: "1500000000",
	breakEvenUsd8: "250000000000",
	capped: false,
};

function fillTrade(): PreparedTrade {
	return {
		label: "ETH put",
		account: WALLET,
		chainId: 8453,
		structureId: "s1",
		side: "bull",
		budgetInput: "5",
		thesisId: null,
		stage: "fill",
		transactions: { fill: { to: "0x1bdff855d6811728acadc00989e79143a2bdfded", data: "0xFILL" } },
		token: "tok",
		expected: RAW,
		preview: { premium: { amount: "5", token: "USDC" }, contracts: "0.01", maxLossUsd: "5.00" },
		signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
		preparedAt: new Date().toISOString(),
	};
}

let TradeExecution: (props: never) => import("react").ReactElement | null;
beforeAll(async () => {
	({ TradeExecution } = (await import("./trade-execution")) as unknown as { TradeExecution: typeof TradeExecution });
});

function reset(): void {
	resetTradeMocks();
	replies.agentPrepare = async () => ({ ok: false, code: "X", reason: "no" });
}

function primary(h: Mounted) {
	const hit = h.find((e) => typeof e.type === "function" && "size" in (e.props as Record<string, unknown>))[0];
	if (hit === undefined) throw new Error("no primary button");
	return hit;
}

/** The card's button is a `<Button>`; clicking it means calling its onClick. */
function press(h: Mounted): void {
	const button = primary(h);
	if (button.props.disabled === true) throw new Error("button is disabled");
	(button.props.onClick as () => void)();
	h.flush();
}

describe("C#2 (agent): a remount must not send a second fill", () => {
	test("REMOUNT — sends stay 1", async () => {
		reset();
		replies.record = async () => {
			throw new Error("response lost");
		};
		const first = mount(TradeExecution, { trade: fillTrade() });
		press(first);
		await first.settle();
		const afterFirst = { sends: calls.sends.length, label: primary(first).text };

		first.unmount();
		const second = mount(TradeExecution, { trade: fillTrade() });
		await second.settle();
		const label = primary(second).text;
		if (label !== "Record the fill") {
			press(second);
			await second.settle();
		}
		expect({ afterFirst, remount: { sends: calls.sends.length, label } }).toEqual({
			afterFirst: { sends: 1, label: "Record the fill" },
			remount: { sends: 1, label: "Record the fill" },
		});
	});
});

describe("C#3 / C#4 (= lane D's D-C1): one recording-result handler", () => {
	/** Sends a fill, then makes the FIRST recording fail so a retry is pending. */
	async function sentAndUnrecorded(): Promise<Mounted> {
		replies.record = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		const h = mount(TradeExecution, { trade: fillTrade() });
		press(h);
		await h.settle();
		expect(calls.sends.length).toBe(1);
		return h;
	}

	test("retry_throw — a rejected retry leaves a USABLE retry control", async () => {
		reset();
		const h = await sentAndUnrecorded();
		replies.record = async () => {
			throw new Error("response lost");
		};
		press(h);
		await h.settle();

		const button = primary(h);
		expect({
			sends: calls.sends.length,
			records: calls.records.length,
			disabled: button.props.disabled === true,
			label: button.text,
			confirmedText: h.text().includes("Confirmed on Base and recorded"),
		}).toEqual({ sends: 1, records: 2, disabled: false, label: "Record the fill", confirmedText: false });
	});

	test("retry_revert — a reverted fill never reads as confirmed", async () => {
		reset();
		const h = await sentAndUnrecorded();
		replies.record = async () => ({ ok: true, status: "failed", positionId: "p1", thesisId: null, txHash: HASH, card: null, settled: null });
		press(h);
		await h.settle();

		expect({
			records: calls.records.length,
			confirmedText: h.text().includes("Confirmed on Base and recorded"),
			says: h.text().includes("reverted on Base"),
		}).toEqual({ records: 2, confirmedText: false, says: true });
	});

	test("the FIRST submit reads a reverted fill the same way", async () => {
		reset();
		replies.record = async () => ({ ok: true, status: "failed", positionId: "p1", thesisId: null, txHash: HASH, card: null, settled: null });
		const h = mount(TradeExecution, { trade: fillTrade() });
		press(h);
		await h.settle();
		expect(h.text().includes("Confirmed on Base and recorded")).toBe(false);
		expect(h.text().includes("reverted on Base")).toBe(true);
	});

	test("a confirmed fill still says so, and releases the hold", async () => {
		reset();
		const h = mount(TradeExecution, { trade: fillTrade() });
		press(h);
		await h.settle();
		expect(h.text()).toContain("Confirmed on Base and recorded");
		expect(h.text()).toContain("Open the position");

		// The durable row released the hold, so a remount is a fresh card.
		h.unmount();
		const again = mount(TradeExecution, { trade: fillTrade() });
		await again.settle();
		expect(primary(again).text).toBe("Sign in wallet");
	});
});

// -------------------------------------------------- finding 5: THE APPROVAL

const word = (hex: string) => hex.padStart(64, "0");
const approveData = (spender: string, amount: bigint) =>
	`0x095ea7b3${word(spender.slice(2).toLowerCase())}${word(amount.toString(16))}`;
const BOOK = "0x1bdff855d6811728acadc00989e79143a2bdfded";

function approveTrade(over: { calldataAmount?: bigint; printedAmount?: string; allowance?: PreparedTrade["allowance"] } = {}): PreparedTrade {
	const printed = over.printedAmount ?? "5000000";
	return {
		...fillTrade(),
		stage: "approve",
		transactions: { approve: { to: USDC, data: approveData(BOOK, over.calldataAmount ?? BigInt(printed)) } },
		token: undefined,
		// C#5: the server now returns the approval leg's own economics, so the
		// card prints and compares THEM rather than the model's preview.
		expected: { ...RAW, debit: printed },
		allowance:
			"allowance" in over
				? over.allowance
				: { amount: printed, spender: BOOK, tokenAddress: USDC, tokenSymbol: "USDC", tokenDecimals: 6 },
	};
}

describe("C#5: the approval card shows what the approval will allow, and cannot send more", () => {
	test("APPROVE_BEFORE_GATE — calldata that allows 20 USDC under a 5 USDC card sends NOTHING", async () => {
		reset();
		const h = mount(TradeExecution, { trade: approveTrade({ calldataAmount: 20_000_000n, printedAmount: "5000000" }) });
		press(h);
		await h.settle();
		expect({ sends: calls.sends, prepares: calls.agentPrepares }).toEqual({ sends: [], prepares: 0 });
		expect(h.text()).toContain("this fill needs exactly 5000000");
	});

	test("the card prints the allowance decoded from the calldata", async () => {
		reset();
		const h = mount(TradeExecution, { trade: approveTrade({ printedAmount: "5000000" }) });
		await h.settle();
		expect(h.text()).toContain("This approval allows");
		expect(h.text()).toContain("5 USDC");
	});

	test("an approval that does not say what it would allow is never sent", async () => {
		reset();
		const h = mount(TradeExecution, { trade: approveTrade({ allowance: undefined }) });
		press(h);
		await h.settle();
		expect(calls.sends).toEqual([]);
		expect(h.text()).toContain("does not say what it would allow");
	});

	test("an exact approval is sent, and the second leg is prepared", async () => {
		reset();
		replies.agentPrepare = async () => ({
			ok: true,
			stage: "fill",
			fill: { to: BOOK as `0x${string}`, data: "0xFILL" as const, value: "0" as const },
			token: "tok2",
			thesisId: null,
			expected: RAW,
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt: new Date().toISOString(),
			note: "",
		});
		const h = mount(TradeExecution, { trade: approveTrade() });
		press(h);
		await h.settle();
		expect(calls.sends.map((s) => s.to)).toEqual([USDC, BOOK]);
		expect(calls.agentPrepares).toBe(1);
	});
});

// -------------------------------------------------- finding 8: STALE CALLDATA

describe("C#8: fill calldata is never broadcast past PRD 14's 30-second window", () => {
	/** The reviewer's probe: 31 seconds elapsed, maker signature still valid. */
	function staleTrade(): PreparedTrade {
		return {
			...fillTrade(),
			// Valid for another 90 s — a DIFFERENT clock from the fetch age.
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt: new Date(Date.now() - 31_000).toISOString(),
		};
	}

	test("STALE_FILL — the stale calldata is never the thing that is sent", async () => {
		reset();
		replies.agentPrepare = async () => ({
			ok: true,
			stage: "fill",
			fill: { to: BOOK as `0x${string}`, data: "0xFRESH" as const, value: "0" as const },
			token: "tok2",
			thesisId: null,
			expected: RAW,
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt: new Date().toISOString(),
			note: "",
		});
		const h = mount(TradeExecution, { trade: staleTrade() });
		press(h);
		await h.settle();
		expect({ prepares: calls.agentPrepares, sends: calls.sends.map((s) => s.data) }).toEqual({
			prepares: 1,
			sends: ["0xFRESH"],
		});
		// And the fill was recorded with the FRESH ticket, not the stale one.
		expect(calls.records.map((r) => r.token)).toEqual(["tok2"]);
	});

	test("a stale fill whose refresh fails sends nothing", async () => {
		reset();
		replies.agentPrepare = async () => ({ ok: false, code: "STRUCTURE_GONE", reason: "That structure is no longer on the book." });
		const h = mount(TradeExecution, { trade: staleTrade() });
		press(h);
		await h.settle();
		expect({ prepares: calls.agentPrepares, sends: calls.sends }).toEqual({ prepares: 1, sends: [] });
		expect(h.text()).toContain("no longer on the book");
	});

	test("a refresh that is ITSELF stale is not sent either", async () => {
		reset();
		replies.agentPrepare = async () => ({
			ok: true,
			stage: "fill",
			fill: { to: BOOK as `0x${string}`, data: "0xFRESH" as const, value: "0" as const },
			token: "tok2",
			thesisId: null,
			expected: RAW,
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt: new Date(Date.now() - 60_000).toISOString(),
			note: "",
		});
		const h = mount(TradeExecution, { trade: staleTrade() });
		press(h);
		await h.settle();
		expect(calls.sends).toEqual([]);
		expect(h.text()).toContain("could not be refreshed");
	});

	test("a refreshed fill whose economics moved stops and asks again", async () => {
		reset();
		replies.agentPrepare = async () => ({
			ok: true,
			stage: "fill",
			fill: { to: BOOK as `0x${string}`, data: "0xFRESH" as const, value: "0" as const },
			token: "tok2",
			thesisId: null,
			expected: { ...RAW, debit: "9000000", maxLossUsd8: "900000000" },
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt: new Date().toISOString(),
			note: "",
		});
		const h = mount(TradeExecution, { trade: staleTrade() });
		press(h);
		await h.settle();
		expect(calls.sends).toEqual([]);
		expect(h.text()).toContain("The price moved while this was prepared");
		// C4-r2: the card now prints the server's figures, so the next click
		// authorises what is on screen.
		expect(h.text()).toContain("9 USDC");
	});

	test("a fresh fill is sent without a re-preparation", async () => {
		reset();
		const h = mount(TradeExecution, { trade: fillTrade() });
		press(h);
		await h.settle();
		expect({ prepares: calls.agentPrepares, sends: calls.sends.map((s) => s.data) }).toEqual({
			prepares: 0,
			sends: ["0xFILL"],
		});
	});
});

/**
 * C-R1 (confirming round, MAJOR). `agent-chat.tsx:300` renders one
 * `TradeExecution` per prepared tool result, so a transcript holds SEVERAL
 * mounted cards. Each read the wallet's hold once at mount and then checked
 * only its own `sent`:
 *
 *   AFTER_FIRST  {"sends":1,"held":1,"a":"Record the fill","b":"Sign in wallet"}
 *   AFTER_SECOND {"sends":2,"prepares":0,"records":2}
 *   NO_STORAGE_REMOUNT {"sends":2,"records":2}
 */
describe("C-R1: a second mounted card must not send a second fill", () => {
	/**
	 * `prepareTradeFor`'s own rule, modelled: while the wallet holds a `pending`
	 * row (written by `recordTrade`), preparation is refused with
	 * `UNRECORDED_FILL` (`lib/trade/prepare.ts:84`).
	 */
	function serverWithUnrecordedFence(): void {
		replies.agentPrepare = async () => {
			if (calls.records.length > 0) {
				return { ok: false, code: "UNRECORDED_FILL", reason: "Your last fill is not recorded yet." };
			}
			return {
				ok: true,
				stage: "fill",
				fill: { to: BOOK as `0x${string}`, data: "0xFRESH" as const, value: "0" as const },
				token: "tok2",
				thesisId: null,
				expected: RAW,
				signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
				preparedAt: new Date().toISOString(),
				note: "",
			};
		};
	}

	test("AFTER_SECOND — two mounted cards, the first fill unrecorded", async () => {
		reset();
		replies.record = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		const a = mount(TradeExecution, { trade: fillTrade() });
		const b = mount(TradeExecution, { trade: fillTrade() });

		press(a);
		await a.settle();
		const afterFirst = { sends: calls.sends.length, records: calls.records.length, a: primary(a).text };

		press(b);
		await b.settle();

		expect({
			afterFirst,
			afterSecond: { sends: calls.sends.length, prepares: calls.agentPrepares, records: calls.records.length },
			// The second card now offers to RECORD the first card's fill.
			bLabel: primary(b).text,
			bSaysHeld: b.text().includes("is not recorded yet"),
		}).toEqual({
			afterFirst: { sends: 1, records: 1, a: "Record the fill" },
			afterSecond: { sends: 1, prepares: 0, records: 1 },
			bLabel: "Record the fill",
			bSaysHeld: true,
		});

		// Pressing the adopted card RECORDS the first card's fill; it never sends.
		press(b);
		await b.settle();
		expect({ sends: calls.sends.length, records: calls.records.length }).toEqual({ sends: 1, records: 2 });
		expect(calls.records.every((r) => r.txHash === HASH)).toBe(true);
	});

	test("an APPROVAL is refused too while a fill is held", async () => {
		reset();
		replies.record = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		// Mounted BEFORE the fill, so its mount-time restore finds nothing: only
		// the pre-send re-read can stop it.
		const b = mount(TradeExecution, { trade: approveTrade() });
		const a = mount(TradeExecution, { trade: fillTrade() });
		press(a);
		await a.settle();
		expect(calls.sends.length).toBe(1);

		press(b);
		await b.settle();
		expect({ sends: calls.sends.length, label: primary(b).text }).toEqual({ sends: 1, label: "Record the fill" });
	});

	test("NO_STORAGE_REMOUNT — with no store, the SERVER fence stops the second fill", async () => {
		reset();
		serverWithUnrecordedFence();
		replies.record = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		const real = (globalThis as { sessionStorage?: unknown }).sessionStorage;
		(globalThis as { sessionStorage?: unknown }).sessionStorage = undefined;
		try {
			const first = mount(TradeExecution, { trade: fillTrade() });
			press(first);
			await first.settle();
			// The card had to re-prepare before sending, because nothing local can
			// see another surface's fill when there is no store.
			const afterFirst = { sends: calls.sends.map((s) => s.data), prepares: calls.agentPrepares };

			first.unmount();
			const second = mount(TradeExecution, { trade: fillTrade() });
			press(second);
			await second.settle();

			expect({
				afterFirst,
				afterSecond: { sends: calls.sends.length, prepares: calls.agentPrepares },
				refused: second.text().includes("not recorded yet"),
			}).toEqual({
				afterFirst: { sends: ["0xFRESH"], prepares: 1 },
				afterSecond: { sends: 1, prepares: 2 },
				refused: true,
			});
		} finally {
			(globalThis as { sessionStorage?: unknown }).sessionStorage = real;
		}
	});

	test("with a working store a fresh card still sends without an extra round trip", async () => {
		reset();
		const h = mount(TradeExecution, { trade: fillTrade() });
		press(h);
		await h.settle();
		expect({ prepares: calls.agentPrepares, sends: calls.sends.map((s) => s.data) }).toEqual({
			prepares: 0,
			sends: ["0xFILL"],
		});
	});
});

/**
 * M5. The agent card carried the same unbounded approval wait as the market
 * ticket. Reproduced with the same harness:
 *   AGENT_STUCK {"label":"Confirm approval\u2026","disabled":true}
 */
describe("M5: the agent card stops waiting for an approval and says so", () => {
	test("a receipt that never arrives ends in a usable card with one sentence", async () => {
		reset();
		neverLandingReceipt();
		const h = mount(TradeExecution, { trade: approveTrade() });
		press(h);
		await h.settle();
		const button = primary(h);
		expect({
			disabled: button.props.disabled === true,
			sends: calls.sends.length,
			prepares: calls.agentPrepares,
			says: h.text().includes("has not confirmed on Base yet"),
			claimsFailure: h.text().includes("did not succeed"),
		}).toEqual({ disabled: false, sends: 1, prepares: 0, says: true, claimsFailure: false });
	});

	test("a REVERTED approval still reads as a failure", async () => {
		reset();
		replies.receiptStatus = "reverted";
		const h = mount(TradeExecution, { trade: approveTrade() });
		press(h);
		await h.settle();
		expect(h.text()).toContain("The approval did not succeed on Base");
		expect(calls.sends.length).toBe(1);
	});
});
