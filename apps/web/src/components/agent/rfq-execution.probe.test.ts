/**
 * Component-level probes for the RFQ wallet hand-off.
 *
 * Driven through `@/test/hook-runner`, which runs the REAL component function
 * against React's own dispatcher slot: every fence this file asserts lives in
 * the wiring, not in an extracted pure function, and `trade-execution.probe.test.ts`
 * exists because testing the pure parts proved nothing about the money path.
 *
 * The wagmi mock and the `calls`/`replies` object come from `@/test/trade-mocks`
 * on purpose — `mock.module` in bun is process-wide, so a second registration of
 * "wagmi" in this file would decide what the OTHER probe file sees.
 *
 * Nothing here reaches a chain, a model or a database.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { mount, type Found, type Mounted } from "@/test/hook-runner";
import { calls, HASH, replies, resetTradeMocks, USDC, WALLET } from "@/test/trade-mocks";
import type {
	PreparedRfqAction,
	PreparedRfqCreate,
	RfqExpected,
	RfqPrepareResult,
	RfqStatusView,
} from "./rfq-contract";

/** OptionFactory on Base, measured by W1 from `chainConfig.contracts.optionFactory`. */
const FACTORY = "0x8118dad971debffb49b9280047659174128a8b94";
const OTHER = "0x1bdff855d6811728acadc00989e79143a2bdfded";
const CREATE_DATA = "0xC0FFEE01" as const;
const FRESH_DATA = "0xC0FFEE02" as const;

/** ERC-20 `approve(address,uint256)` calldata, built the way the server builds it. */
function approveData(spender: string, amount: bigint): `0x${string}` {
	const word = (hex: string) => hex.padStart(64, "0");
	return `0x095ea7b3${word(spender.toLowerCase().replace(/^0x/, ""))}${word(amount.toString(16))}`;
}

const EXPECTED: RfqExpected = {
	depositBaseUnits: "5000000",
	deposit: "5",
	// The FACTORY's order for a put spread is DESCENDING (W1, RFQ 125's calldata).
	strikesUsd: ["2200", "2100"],
	numContracts: "1",
	expiryAt: "2026-09-30T08:00:00Z",
	offerEndAt: "2026-09-06T03:00:00Z",
	factory: FACTORY,
	maxLossUsd: "5",
};

const REQUEST = {
	underlying: "ETH" as const,
	strikesUsd: ["2200", "2100"],
	expiry: 1_790_000_000,
	numContracts: "1",
	reservePricePerContract: "5",
	offerDeadlineMinutes: 60,
};

/** What the tool hands the chat once the server already has the allowance. */
function createStage(overrides: Partial<PreparedRfqCreate> = {}): PreparedRfqCreate {
	return {
		prepared: true,
		kind: "rfq_create",
		account: WALLET,
		chainId: 8453,
		label: "ETH 2100/2200 put spread",
		request: REQUEST,
		ok: true,
		stage: "create",
		create: { to: FACTORY as `0x${string}`, data: CREATE_DATA, value: "0" },
		token: "tok",
		expected: EXPECTED,
		preparedAt: new Date().toISOString(),
		note: "",
		...overrides,
	} as PreparedRfqCreate;
}

/** And what it hands the chat when USDC still has to be approved to the factory. */
function approveStage(overrides: Record<string, unknown> = {}): PreparedRfqCreate {
	return {
		prepared: true,
		kind: "rfq_create",
		account: WALLET,
		chainId: 8453,
		label: "ETH 2100/2200 put spread",
		request: REQUEST,
		ok: true,
		stage: "approve",
		approve: { to: USDC as `0x${string}`, data: approveData(FACTORY, 5_000_000n), value: "0" },
		allowance: {
			amount: "5000000",
			spender: FACTORY,
			tokenAddress: USDC,
			tokenSymbol: "USDC",
			tokenDecimals: 6,
		},
		expected: EXPECTED,
		note: "",
		...overrides,
	} as unknown as PreparedRfqCreate;
}

const status = (over: Partial<RfqStatusView> = {}): RfqStatusView => ({
	status: "waiting_for_offers",
	nextAction: "wait",
	sentence: "Market makers have until the deadline to answer.",
	quotationId: "125",
	...over,
});

/** Every RFQ server action, counted and answerable per test. */
const rfq = {
	prepares: [] as unknown[],
	cancels: [] as unknown[],
	settles: [] as unknown[],
	records: [] as Array<{ token: string; txHash: string; kind: string }>,
	statusReads: 0,
	prepareCreate: (async () => {
		throw new Error("prepareRfqCreateFor not stubbed");
	}) as (input: unknown) => Promise<RfqPrepareResult>,
	prepareCancel: (async () => ({ ok: true, cancel: { to: FACTORY, data: "0xCA0001", value: "0" }, quotationId: "125", token: "cancel-tok" })) as (
		input: unknown,
	) => Promise<Record<string, unknown>>,
	prepareSettle: (async () => ({ ok: true, settle: { to: FACTORY, data: "0x5E0001", value: "0" }, quotationId: "125", token: "settle-tok", bestPrice: "4.2" })) as (
		input: unknown,
	) => Promise<Record<string, unknown>>,
	recordCreate: (async () => ({ ok: true, rfqRequestId: "row-1", quotationId: "125" })) as (
		input: unknown,
	) => Promise<Record<string, unknown>>,
	recordAction: (async () => ({ ok: true, rfqRequestId: "row-1" })) as (input: unknown) => Promise<Record<string, unknown>>,
	status: (async () => ({ ok: true, rfqRequestId: "row-1", status: status() })) as (
		input: unknown,
	) => Promise<Record<string, unknown>>,
};

mock.module("@/lib/rfq/actions", () => ({
	prepareRfqCreateFor: (input: unknown) => {
		rfq.prepares.push(input);
		return rfq.prepareCreate(input);
	},
	prepareRfqCancelFor: (input: unknown) => {
		rfq.cancels.push(input);
		return rfq.prepareCancel(input);
	},
	prepareRfqSettleFor: (input: unknown) => {
		rfq.settles.push(input);
		return rfq.prepareSettle(input);
	},
	recordRfqCreateFor: (input: { token: string; txHash: string }) => {
		rfq.records.push({ ...input, kind: "create" });
		return rfq.recordCreate(input);
	},
	recordRfqCancelFor: (input: { token: string; txHash: string }) => {
		rfq.records.push({ ...input, kind: "cancel" });
		return rfq.recordAction(input);
	},
	recordRfqSettleFor: (input: { token: string; txHash: string }) => {
		rfq.records.push({ ...input, kind: "settle" });
		return rfq.recordAction(input);
	},
	getRfqStatusFor: (input: unknown) => {
		rfq.statusReads += 1;
		return rfq.status(input);
	},
}));

let RfqExecution: (props: never) => import("react").ReactElement | null;
let RfqActionExecution: (props: never) => import("react").ReactElement | null;
beforeAll(async () => {
	({ RfqExecution, RfqActionExecution } = (await import("./rfq-execution")) as unknown as {
		RfqExecution: typeof RfqExecution;
		RfqActionExecution: typeof RfqActionExecution;
	});
});

function reset(): void {
	resetTradeMocks();
	rfq.prepares = [];
	rfq.cancels = [];
	rfq.settles = [];
	rfq.records = [];
	rfq.statusReads = 0;
	rfq.prepareCreate = async () => ({
		ok: true,
		stage: "create",
		create: { to: FACTORY as `0x${string}`, data: FRESH_DATA, value: "0" },
		token: "tok",
		expected: EXPECTED,
		preparedAt: new Date().toISOString(),
		note: "",
	});
	rfq.prepareCancel = async () => ({
		ok: true,
		cancel: { to: FACTORY, data: "0xCA0001", value: "0" },
		quotationId: "125",
		token: "cancel-tok",
	});
	rfq.prepareSettle = async () => ({
		ok: true,
		settle: { to: FACTORY, data: "0x5E0001", value: "0" },
		quotationId: "125",
		token: "settle-tok",
		bestPrice: "4.2",
	});
	rfq.recordCreate = async () => ({ ok: true, rfqRequestId: "row-1", quotationId: "125" });
	rfq.recordAction = async () => ({ ok: true, rfqRequestId: "row-1" });
	rfq.status = async () => ({ ok: true, rfqRequestId: "row-1", status: status() });
}

/** The card's controls are `<Button>`s, which carry a `size` prop. */
function controls(h: Mounted): Found[] {
	return h.find((element) => typeof element.type === "function" && "size" in (element.props as Record<string, unknown>));
}

function control(h: Mounted, label: string | RegExp): Found | undefined {
	const match = (value: string) => (typeof label === "string" ? value === label : label.test(value));
	return controls(h).find((element) => match(element.text));
}

function press(h: Mounted, label?: string | RegExp): void {
	const button = label === undefined ? controls(h)[0] : control(h, label);
	if (button === undefined) throw new Error(`no control ${String(label)} in ${controls(h).map((c) => c.text).join(" | ")}`);
	if (button.props.disabled === true) throw new Error(`"${button.text}" is disabled`);
	(button.props.onClick as () => void)();
	h.flush();
}

describe("the card prints what the SERVER decoded, never the model's words", () => {
	test("terms come from `expected`, with the strikes read ascending", async () => {
		reset();
		const h = mount(RfqExecution, { rfq: createStage() });
		await h.settle();
		const text = h.text();
		console.log("TERMS", JSON.stringify(text.slice(0, 260)));
		expect(text).toContain("5 USDC");
		expect(text).toContain("$5");
		// W1: the factory's own order is DESCENDING; the card reads up.
		expect(text).toContain("2100 / 2200");
		expect(text).not.toContain("2200 / 2100");
		expect(text).toContain("2026-09-30T08:00:00Z");
		expect(text).toContain("2026-09-06T03:00:00Z");
		h.unmount();
	});

	test("the approve stage prints the allowance decoded from the bytes", async () => {
		reset();
		const h = mount(RfqExecution, { rfq: approveStage() });
		await h.settle();
		expect(h.text()).toContain("5 USDC");
		expect(h.text()).toContain("This approval allows");
		h.unmount();
	});
});

describe("C#5: an approval whose bytes are not the escrow is not sent", () => {
	test("calldata that allows a different amount", async () => {
		reset();
		const h = mount(RfqExecution, {
			rfq: approveStage({
				approve: { to: USDC, data: approveData(FACTORY, 20_000_000n), value: "0" },
			}),
		});
		press(h);
		await h.settle();
		console.log("MISMATCHED_AMOUNT", JSON.stringify({ sends: calls.sends.length, prepares: rfq.prepares.length, text: h.text().slice(-200) }));
		expect(calls.sends.length).toBe(0);
		expect(rfq.prepares.length).toBe(0);
		expect(h.text()).toContain("Nothing was sent.");
		h.unmount();
	});

	test("calldata that names a spender other than the factory", async () => {
		reset();
		const h = mount(RfqExecution, {
			rfq: approveStage({
				approve: { to: USDC, data: approveData(OTHER, 5_000_000n), value: "0" },
				allowance: { amount: "5000000", spender: OTHER, tokenAddress: USDC, tokenSymbol: "USDC", tokenDecimals: 6 },
			}),
		});
		press(h);
		await h.settle();
		console.log("WRONG_SPENDER", JSON.stringify({ sends: calls.sends.length }));
		expect(calls.sends.length).toBe(0);
		expect(h.text()).toContain("other than the one that holds the escrow");
		h.unmount();
	});

	test("a decoded allowance that is not the escrow on screen", async () => {
		reset();
		const h = mount(RfqExecution, {
			rfq: approveStage({
				approve: { to: USDC, data: approveData(FACTORY, 9_000_000n), value: "0" },
				allowance: { amount: "9000000", spender: FACTORY, tokenAddress: USDC, tokenSymbol: "USDC", tokenDecimals: 6 },
			}),
		});
		press(h);
		await h.settle();
		console.log("NOT_THE_ESCROW", JSON.stringify({ sends: calls.sends.length }));
		expect(calls.sends.length).toBe(0);
		expect(h.text()).toContain("not for the escrow shown above");
		h.unmount();
	});
});

describe("C4: the create is built AFTER the allowance is on chain", () => {
	test("approve -> receipt -> re-prepare -> create -> record", async () => {
		reset();
		let approvals = 0;
		rfq.prepareCreate = async () => {
			approvals += 1;
			// The server still wants an approval the first time it is asked.
			if (approvals === 1) {
				return {
					ok: true,
					stage: "approve",
					approve: { to: USDC as `0x${string}`, data: approveData(FACTORY, 5_000_000n), value: "0" },
					allowance: { amount: "5000000", spender: FACTORY, tokenAddress: USDC, tokenSymbol: "USDC", tokenDecimals: 6 },
					expected: EXPECTED,
					note: "",
				};
			}
			return {
				ok: true,
				stage: "create",
				create: { to: FACTORY as `0x${string}`, data: FRESH_DATA, value: "0" },
				token: "tok2",
				expected: EXPECTED,
				preparedAt: new Date().toISOString(),
				note: "",
			};
		};
		const h = mount(RfqExecution, { rfq: approveStage() });
		press(h);
		await h.settle();
		const sent = calls.sends.map((s) => s.data);
		console.log("APPROVE_THEN_CREATE", JSON.stringify({ sent, prepares: rfq.prepares.length, records: rfq.records }));
		expect(sent.length).toBe(2);
		expect(sent[0]?.startsWith("0x095ea7b3")).toBe(true);
		// The create sent is the one prepared AFTER the approval, never the one
		// the card was mounted with.
		expect(sent[1]).toBe(FRESH_DATA);
		expect(rfq.prepares.length).toBe(2);
		expect(rfq.records).toEqual([{ token: "tok2", txHash: HASH, kind: "create" }]);
		h.unmount();
	});

	test("an approval that never mines says so, and sends nothing else", async () => {
		reset();
		replies.receipt = async (params) => {
			if (params.timeout === undefined) return await new Promise<never>(() => {});
			throw new Error("Timed out");
		};
		rfq.prepareCreate = async () => ({
			ok: true,
			stage: "approve",
			approve: { to: USDC as `0x${string}`, data: approveData(FACTORY, 5_000_000n), value: "0" },
			allowance: { amount: "5000000", spender: FACTORY, tokenAddress: USDC, tokenSymbol: "USDC", tokenDecimals: 6 },
			expected: EXPECTED,
			note: "",
		});
		const h = mount(RfqExecution, { rfq: approveStage() });
		press(h);
		await h.settle();
		console.log("APPROVAL_TIMEOUT", JSON.stringify({ sends: calls.sends.length, text: h.text().slice(-160) }));
		expect(calls.sends.length).toBe(1);
		expect(h.text()).toContain("has not confirmed on Base yet");
		expect(controls(h)[0]?.props.disabled).toBe(false);
		h.unmount();
	});
});

describe("C#8: calldata past PRD 14's window is refreshed, never sent", () => {
	test("a stale create is re-prepared and the FRESH bytes are what leave", async () => {
		reset();
		const h = mount(RfqExecution, {
			rfq: createStage({ preparedAt: new Date(Date.now() - 40_000).toISOString() }),
		});
		press(h);
		await h.settle();
		console.log("STALE", JSON.stringify({ sent: calls.sends.map((s) => s.data), prepares: rfq.prepares.length }));
		expect(calls.sends.map((s) => s.data)).toEqual([FRESH_DATA]);
		expect(rfq.prepares.length).toBe(1);
		h.unmount();
	});

	test("a re-preparation that is itself stale stops the send", async () => {
		reset();
		rfq.prepareCreate = async () => ({
			ok: true,
			stage: "create",
			create: { to: FACTORY as `0x${string}`, data: FRESH_DATA, value: "0" },
			token: "tok",
			expected: EXPECTED,
			preparedAt: new Date(Date.now() - 45_000).toISOString(),
			note: "",
		});
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		console.log("STALE_TWICE", JSON.stringify({ sends: calls.sends.length, text: h.text().slice(-200) }));
		expect(calls.sends.length).toBe(0);
		expect(h.text()).toContain("30 seconds");
		h.unmount();
	});
});

describe("C5: the figures signed for are the figures on screen", () => {
	test("changed terms replace the display and stop the send", async () => {
		reset();
		const moved: RfqExpected = { ...EXPECTED, depositBaseUnits: "7000000", deposit: "7", maxLossUsd: "7" };
		rfq.prepareCreate = async () => ({
			ok: true,
			stage: "create",
			create: { to: FACTORY as `0x${string}`, data: FRESH_DATA, value: "0" },
			token: "tok",
			expected: moved,
			preparedAt: new Date().toISOString(),
			note: "",
		});
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		console.log("TERMS_MOVED", JSON.stringify({ sends: calls.sends.length, shows7: h.text().includes("7 USDC") }));
		expect(calls.sends.length).toBe(0);
		expect(h.text()).toContain("7 USDC");
		expect(h.text()).toContain("figures above have been replaced");
		// And the second press signs for what is now on screen.
		press(h);
		await h.settle();
		expect(calls.sends.length).toBe(1);
		h.unmount();
	});
});

describe("C#3: a sent request is never forgotten and never re-sent", () => {
	test("a recording failure leaves a RECORD button that records", async () => {
		reset();
		rfq.recordCreate = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		console.log("RECORD_FAILED", JSON.stringify({ sends: calls.sends.length, label: controls(h)[0]?.text }));
		expect(calls.sends.length).toBe(1);
		expect(controls(h)[0]?.text).toBe("Record the request");

		rfq.recordCreate = async () => ({ ok: true, rfqRequestId: "row-1", quotationId: "125" });
		press(h);
		await h.settle();
		console.log("RECORD_RETRY", JSON.stringify({ sends: calls.sends.length, records: rfq.records.length, text: h.text().slice(0, 120) }));
		expect(calls.sends.length).toBe(1);
		expect(rfq.records.length).toBe(2);
		expect(h.text()).toContain("Your request is live");
		h.unmount();
	});

	test("a rejected recording call leaves a USABLE retry", async () => {
		reset();
		rfq.recordCreate = async () => {
			throw new Error("response lost");
		};
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		expect(calls.sends.length).toBe(1);
		expect(controls(h)[0]?.props.disabled).toBe(false);
		expect(controls(h)[0]?.text).toBe("Record the request");
		h.unmount();
	});

	test("a second card adopts the held request instead of sending another", async () => {
		reset();
		rfq.recordCreate = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		const first = mount(RfqExecution, { rfq: createStage() });
		press(first);
		await first.settle();
		expect(calls.sends.length).toBe(1);
		first.unmount();

		const second = mount(RfqExecution, { rfq: createStage() });
		await second.settle();
		console.log("ADOPTED", JSON.stringify({ label: controls(second)[0]?.text, sends: calls.sends.length }));
		expect(controls(second)[0]?.text).toBe("Record the request");
		expect(h_text(second)).toContain("not recorded yet");
		press(second);
		await second.settle();
		expect(calls.sends.length).toBe(1);
		second.unmount();
	});

	test("a reverted receipt is not called a live request", async () => {
		reset();
		rfq.recordCreate = async () => ({ ok: true, rfqRequestId: "row-1", status: "failed" });
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		expect(h.text()).toContain("reverted on Base");
		expect(h.text()).not.toContain("Your request is live");
		h.unmount();
	});
});

const h_text = (h: Mounted) => h.text();

describe("the watching stage", () => {
	async function watching(over: Partial<RfqStatusView> = {}): Promise<Mounted> {
		reset();
		rfq.status = async () => ({ ok: true, rfqRequestId: "row-1", status: status(over) });
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		return h;
	}

	test("it shows the SERVER's sentence and offers cancel, not settle", async () => {
		const h = await watching();
		console.log("WATCHING", JSON.stringify({ controls: controls(h).map((c) => c.text), reads: rfq.statusReads }));
		expect(h.text()).toContain("Market makers have until the deadline to answer.");
		expect(controls(h).map((c) => c.text)).toEqual(["Cancel the request", "Check again"]);
		h.unmount();
	});

	test("settle appears ONLY when the server says the reveal window has passed", async () => {
		const waiting = await watching({ status: "reveal_window", nextAction: "wait" });
		expect(control(waiting, "Settle it")).toBeUndefined();
		waiting.unmount();

		const ready = await watching({ status: "ready_to_settle", nextAction: "settle", sentence: "A winner exists." });
		console.log("READY", JSON.stringify(controls(ready).map((c) => c.text)));
		expect(control(ready, "Settle it")).toBeDefined();
		ready.unmount();
	});

	test("cancel prepares, sends and records its own transaction", async () => {
		const h = await watching();
		press(h, "Cancel the request");
		await h.settle();
		console.log("CANCEL", JSON.stringify({ cancels: rfq.cancels, sent: calls.sends.map((s) => s.data), records: rfq.records }));
		expect(rfq.cancels).toEqual([{ rfqRequestId: "row-1" }]);
		// The create that LEFT is the re-prepared one: every send this click did not
		// already prepare goes through the server fence first (`preparedThisSend`).
		expect(calls.sends.map((s) => s.data)).toEqual([FRESH_DATA, "0xCA0001"]);
		expect(rfq.records[1]).toEqual({ token: "cancel-tok", txHash: HASH, kind: "cancel" });
		h.unmount();
	});

	test("settle prepares, sends and records its own transaction", async () => {
		const h = await watching({ status: "ready_to_settle", nextAction: "settle", sentence: "A winner exists." });
		press(h, "Settle it");
		await h.settle();
		console.log("SETTLE", JSON.stringify({ settles: rfq.settles, records: rfq.records }));
		expect(rfq.settles).toEqual([{ rfqRequestId: "row-1" }]);
		expect(rfq.records[1]).toEqual({ token: "settle-tok", txHash: HASH, kind: "settle" });
		h.unmount();
	});

	test("a settled request names the option and links it", async () => {
		const h = await watching({
			status: "settled",
			nextAction: "none",
			sentence: "Filled at 4.20 USDC per contract.",
			optionAddress: "0x00000000000000000000000000000000000000ff",
		});
		console.log("SETTLED", JSON.stringify({ text: h.text().slice(0, 200), controls: controls(h).map((c) => c.text) }));
		expect(h.text()).toContain("Settled.");
		expect(h.text()).toContain("0x00000000000000000000000000000000000000ff");
		// Nothing left to press: a settled request cannot be cancelled or settled again.
		expect(controls(h).length).toBe(0);
		h.unmount();
	});

	test("a cancelled request says the escrow is refunded", async () => {
		const h = await watching({ status: "cancelled", nextAction: "none", sentence: "Cancelled before any offer was accepted." });
		expect(h.text()).toContain("escrow is refunded");
		expect(controls(h).length).toBe(0);
		h.unmount();
	});
});

describe("the card refuses what it cannot check", () => {
	test("a tool output with no request to re-prepare from sends nothing", async () => {
		reset();
		const bare = createStage();
		const { request: _dropped, ...withoutRequest } = bare as PreparedRfqCreate & { request?: unknown };
		const h = mount(RfqExecution, { rfq: withoutRequest as PreparedRfqCreate });
		press(h);
		await h.settle();
		console.log("NO_REQUEST", JSON.stringify({ sends: calls.sends.length, prepares: rfq.prepares.length }));
		expect(calls.sends.length).toBe(0);
		expect(rfq.prepares.length).toBe(0);
		expect(h.text()).toContain("cannot be refreshed");
		h.unmount();
	});

	test("a wallet that changed since the preparation sends nothing", async () => {
		reset();
		replies.connection = { address: "0x00000000000000000000000000000000000000b2", isConnected: true, chainId: 8453 };
		const h = mount(RfqExecution, { rfq: createStage() });
		press(h);
		await h.settle();
		console.log("WALLET_CHANGED", JSON.stringify({ sends: calls.sends.length, text: h.text().slice(-120) }));
		expect(calls.sends.length).toBe(0);
		expect(h.text()).toContain("connected wallet changed");
		h.unmount();
	});
});

describe("the agent-prepared cancel card", () => {
	function action(kind: "rfq_cancel" | "rfq_settle"): PreparedRfqAction {
		return {
			prepared: true,
			kind,
			rfqRequestId: "row-1",
			quotationId: "125",
			token: kind === "rfq_cancel" ? "cancel-tok" : "settle-tok",
			account: WALLET,
			chainId: 8453,
			...(kind === "rfq_cancel"
				? { cancel: { to: FACTORY as `0x${string}`, data: "0xCA0001" as `0x${string}`, value: "0" as const } }
				: { settle: { to: FACTORY as `0x${string}`, data: "0x5E0001" as `0x${string}`, value: "0" as const } }),
		};
	}

	test("it sends its one transaction and records it", async () => {
		reset();
		const h = mount(RfqActionExecution, { action: action("rfq_cancel") });
		await h.settle();
		press(h);
		await h.settle();
		console.log("ACTION_CARD", JSON.stringify({ sent: calls.sends.map((s) => s.data), records: rfq.records }));
		expect(calls.sends.map((s) => s.data)).toEqual(["0xCA0001"]);
		expect(rfq.records).toEqual([{ token: "cancel-tok", txHash: HASH, kind: "cancel" }]);
		h.unmount();
	});

	test("a recording failure keeps the button recording, not re-sending", async () => {
		reset();
		rfq.recordAction = async () => ({ ok: false, code: "LOST", reason: "The server did not answer." });
		const h = mount(RfqActionExecution, { action: action("rfq_settle") });
		await h.settle();
		press(h);
		await h.settle();
		expect(calls.sends.length).toBe(1);
		expect(controls(h)[0]?.text).toBe("Record the request");
		press(h);
		await h.settle();
		expect(calls.sends.length).toBe(1);
		h.unmount();
	});
});
