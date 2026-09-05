/**
 * Component-level probes for the market ticket (lane C confirming pass,
 * findings 1 and 2). These drive the REAL `TakeASide` function through the
 * hook runner in `@/test/hook-runner`, with the wallet and the server actions
 * injected, because both bugs live in the wiring rather than in any extracted
 * function.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { deferred, mount } from "@/test/hook-runner";
import type { PrepareResult, QuoteRaw, RecordResult, TicketQuoteView, TradePanelContext } from "@/lib/trade/types";
import type { Ticket } from "@/lib/display-types";

// ---------------------------------------------------------------- injections

interface Calls {
	quotes: Array<{ side: string; budgetInput: string }>;
	prepares: Array<{ side: string; budgetInput: string }>;
	sends: Array<{ to: string; data: string }>;
	records: Array<{ token: string; txHash: string }>;
}

const calls: Calls = { quotes: [], prepares: [], sends: [], records: [] };
let quoteReply: (input: { side: string; budgetInput: string }) => Promise<TicketQuoteView>;
let prepareReply: (input: { side: string; budgetInput: string }) => Promise<PrepareResult>;
let recordReply: (input: { token: string; txHash: string }) => Promise<RecordResult>;
let sendReply: (input: { to: string; data: string }) => Promise<string>;

mock.module("wagmi", () => ({
	useConfig: () => ({}),
	useConnection: () => ({ address: WALLET, isConnected: true, chainId: 8453 }),
	useSendTransaction: () => ({
		mutateAsync: (input: { to: string; data: string }) => {
			calls.sends.push({ to: input.to, data: input.data });
			return sendReply(input);
		},
	}),
	useSwitchChain: () => ({ switchChain: () => {}, isPending: false }),
}));

mock.module("wagmi/actions", () => ({
	waitForTransactionReceipt: async () => ({ status: "success" }),
}));

mock.module("@/lib/trade/actions", () => ({
	quoteTicket: (input: { side: string; budgetInput: string }) => {
		calls.quotes.push(input);
		return quoteReply(input);
	},
	prepareTrade: (input: { side: string; budgetInput: string }) => {
		calls.prepares.push({ side: input.side, budgetInput: input.budgetInput });
		return prepareReply(input);
	},
	recordTrade: (input: { token: string; txHash: string }) => {
		calls.records.push(input);
		return recordReply(input);
	},
}));

// ------------------------------------------------------------------ fixtures

const WALLET = "0x00000000000000000000000000000000000000a1";

const RAW_BUY: QuoteRaw = {
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
	collateralAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
	maxLossUsd8: "500000000",
	maxPayoutUsd8: "1500000000",
	breakEvenUsd8: "250000000000",
	capped: false,
};

const RAW_SELL: QuoteRaw = { ...RAW_BUY, debit: "22000000", credit: "4375000", collateralPosted: "22000000", maxLossUsd8: "2200000000" };

const money = (raw: string) => ({ raw, display: raw, pnlClass: "" }) as unknown as Ticket["maxLossUsd"];

function ticket(label: string): Ticket {
	return {
		orderLabel: label,
		contracts: "0.01",
		maxLossUsd: money("5.00"),
		maxPayoutUsd: money("15.00"),
		breakEvenUsd: money("2500"),
		liquidityLeftUsd: money("100"),
		presetsUsd: [money("50")],
		collateralSymbol: "USDC",
		sideNote: "",
	} as unknown as Ticket;
}

function quoteView(side: "bull" | "bear", raw: QuoteRaw, label: string): TicketQuoteView {
	return {
		structureId: "s1",
		side,
		taker: side === "bull" ? "buy" : "sell",
		executable: true,
		reason: null,
		budgetInput: "5",
		ticket: ticket(label),
		sideNote: side === "bull" ? "You buy" : "You sell",
		raw,
		signatureExpiresAt: null,
	};
}

function context(): TradePanelContext {
	return {
		asset: "eth",
		slug: "eth",
		structureId: "s1",
		structureLabel: "ETH put 2500 P",
		expiryLabel: "05 Sep 26 15:00 UTC",
		sides: {
			bull: { taker: "buy", available: true, reason: null },
			bear: { taker: "sell", available: true, reason: null },
		},
		quote: quoteView("bull", RAW_BUY, "BUY-A"),
		presets: ["50"],
		thesis: null,
		sessionWallet: WALLET,
		chainId: 8453,
		explorerTxBase: "https://basescan.org/tx/",
	};
}

const fill = (data: `0x${string}`, expected: QuoteRaw) =>
	({
		ok: true,
		stage: "fill",
		fill: { to: "0x1bdff855d6811728acadc00989e79143a2bdfded" as const, data, value: "0" as const },
		token: "tok",
		thesisId: null,
		expected,
		signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
		note: "",
	}) satisfies PrepareResult;

let TakeASide: (props: never) => import("react").ReactElement | null;

beforeAll(async () => {
	({ TakeASide } = (await import("./take-a-side")) as unknown as { TakeASide: typeof TakeASide });
});

function reset(): void {
	calls.quotes = [];
	calls.prepares = [];
	calls.sends = [];
	calls.records = [];
	quoteReply = async () => quoteView("bull", RAW_BUY, "BUY-A");
	prepareReply = async () => fill("0xBUY_A", RAW_BUY);
	recordReply = async () => ({ ok: true, status: "confirmed", positionId: "p1", thesisId: null, txHash: "0xh", card: null, settled: null });
	sendReply = async () => "0xhash1";
}

function mountTicket(trade: TradePanelContext = context()) {
	return mount(TakeASide, { ticket: trade.quote.ticket, structureLabel: trade.structureLabel, expiryLabel: trade.expiryLabel, trade });
}

// -------------------------------------------------------- finding 1: SIDE

describe("C#1: a preparation started for one side must never send after the side changed", () => {
	test("SENT_AFTER_SIDE_CHANGE — switching to Bear mid-preparation sends nothing", async () => {
		reset();
		const held = deferred<PrepareResult>();
		prepareReply = () => held.promise;
		quoteReply = async () => quoteView("bear", RAW_SELL, "SELL-A");

		const h = mountTicket();
		h.click(h.button(/Trade/) ?? (() => { throw new Error("no Trade button"); })());

		// The preparation is in flight. The side controls must not be usable.
		const bear = h.button(/Bear/);
		expect(bear).not.toBeNull();
		const bearDisabled = bear?.props.disabled === true;

		if (!bearDisabled) {
			// Reproduce the reviewer's probe exactly: change sides, let the Sell
			// requote land, then release the held Buy preparation.
			h.click(bear as NonNullable<typeof bear>);
			await h.settle();
			held.resolve(fill("0xBUY_A", RAW_BUY));
			await h.settle();
		}

		expect({ bearDisabled, sends: calls.sends.map((s) => s.data) }).toEqual({ bearDisabled: true, sends: [] });
	});

	test("the amount field and the presets are also locked while a preparation is pending", async () => {
		reset();
		const held = deferred<PrepareResult>();
		prepareReply = () => held.promise;

		const h = mountTicket();
		h.click(h.button(/Trade/) as NonNullable<ReturnType<typeof h.button>>);

		const amount = h.find((e) => e.type === "input")[0];
		expect(amount?.props.disabled).toBe(true);
		expect(h.find((e) => e.props.className === "pill").every((p) => p.props.disabled === true)).toBe(true);

		held.resolve({ ok: false, code: "X", reason: "stop" });
		await h.settle();
	});

	test("a preparation that resolves with the side unchanged still sends", async () => {
		reset();
		const h = mountTicket();
		h.click(h.button(/Trade/) as NonNullable<ReturnType<typeof h.button>>);
		await h.settle();
		expect(calls.sends.map((s) => s.data)).toEqual(["0xBUY_A"]);
	});
});

describe("C#1: the fence, not just the disabled control", () => {
	test("a structure change arriving as a PROP mid-preparation sends nothing", async () => {
		reset();
		const held = deferred<PrepareResult>();
		prepareReply = () => held.promise;

		const trade = context();
		const h = mountTicket(trade);
		h.click(h.button(/Trade/) as NonNullable<ReturnType<typeof h.button>>);

		// "Select" on the market table is a client-side navigation: the panel keeps
		// its state and only its props change. No control can be disabled for that.
		const moved: TradePanelContext = { ...trade, structureId: "s2", quote: { ...trade.quote, structureId: "s2" } };
		h.setProps({ ticket: moved.quote.ticket, structureLabel: moved.structureLabel, expiryLabel: moved.expiryLabel, trade: moved });
		await h.settle();
		held.resolve(fill("0xBUY_A", RAW_BUY));
		await h.settle();

		expect(calls.sends.map((s) => s.data)).toEqual([]);
		expect(h.text()).toContain("The ticket changed while this was being prepared");
	});

	test("an approval is fenced too: a structure change before the approval send stops it", async () => {
		reset();
		const held = deferred<PrepareResult>();
		prepareReply = () => held.promise;

		const trade = context();
		const h = mountTicket(trade);
		h.click(h.button(/Trade/) as NonNullable<ReturnType<typeof h.button>>);
		const moved: TradePanelContext = { ...trade, structureId: "s3", quote: { ...trade.quote, structureId: "s3" } };
		h.setProps({ ticket: moved.quote.ticket, structureLabel: moved.structureLabel, expiryLabel: moved.expiryLabel, trade: moved });
		await h.settle();
		held.resolve({ ok: true, stage: "approve", approve: { to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const, data: "0xAPPROVE" as const, value: "0" as const }, note: "" });
		await h.settle();

		expect(calls.sends.map((s) => s.data)).toEqual([]);
	});
});
