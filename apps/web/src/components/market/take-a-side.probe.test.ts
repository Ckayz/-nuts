/**
 * Component-level probes for the market ticket (lane C confirming pass,
 * findings 1 and 2). These drive the REAL `TakeASide` function through the
 * hook runner in `@/test/hook-runner`, with the wallet and the server actions
 * injected, because both bugs live in the wiring rather than in any extracted
 * function.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { deferred, mount } from "@/test/hook-runner";
import { calls, HASH, replies, resetTradeMocks, storage, WALLET } from "@/test/trade-mocks";
import type { PrepareResult, QuoteRaw, TicketQuoteView, TradePanelContext } from "@/lib/trade/types";
import type { Ticket } from "@/lib/display-types";

// ------------------------------------------------------------------ fixtures

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
		preparedAt: new Date().toISOString(),
		note: "",
	}) satisfies PrepareResult;

let TakeASide: (props: never) => import("react").ReactElement | null;

beforeAll(async () => {
	({ TakeASide } = (await import("./take-a-side")) as unknown as { TakeASide: typeof TakeASide });
});

function reset(): void {
	resetTradeMocks();
	replies.quote = async () => quoteView("bull", RAW_BUY, "BUY-A");
	replies.prepare = async () => fill("0xBUY_A", RAW_BUY);
}

/** The ticket's one primary button (`className` "btn acc big block go"). */
function primary(h: ReturnType<typeof mount>) {
	const hit = h.find((e) => e.type === "button" && String(e.props.className ?? "").includes("go"))[0];
	if (hit === undefined) throw new Error("no primary button");
	return hit;
}

function mountTicket(trade: TradePanelContext = context()) {
	return mount(TakeASide, { ticket: trade.quote.ticket, structureLabel: trade.structureLabel, expiryLabel: trade.expiryLabel, trade });
}

// -------------------------------------------------------- finding 1: SIDE

describe("C#1: a preparation started for one side must never send after the side changed", () => {
	test("SENT_AFTER_SIDE_CHANGE — switching to Bear mid-preparation sends nothing", async () => {
		reset();
		const held = deferred<PrepareResult>();
		replies.prepare = () => held.promise;
		replies.quote = async () => quoteView("bear", RAW_SELL, "SELL-A");

		const h = mountTicket();
		h.click(primary(h));

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
		replies.prepare = () => held.promise;

		const h = mountTicket();
		h.click(primary(h));

		const amount = h.find((e) => e.type === "input")[0];
		expect(amount?.props.disabled).toBe(true);
		expect(h.find((e) => e.props.className === "pill").every((p) => p.props.disabled === true)).toBe(true);

		held.resolve({ ok: false, code: "X", reason: "stop" });
		await h.settle();
	});

	test("a preparation that resolves with the side unchanged still sends", async () => {
		reset();
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect(calls.sends.map((s) => s.data)).toEqual(["0xBUY_A"]);
	});
});

describe("C#1: the fence, not just the disabled control", () => {
	test("a structure change arriving as a PROP mid-preparation sends nothing", async () => {
		reset();
		const held = deferred<PrepareResult>();
		replies.prepare = () => held.promise;

		const trade = context();
		const h = mountTicket(trade);
		h.click(primary(h));

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
		replies.prepare = () => held.promise;

		const trade = context();
		const h = mountTicket(trade);
		h.click(primary(h));
		const moved: TradePanelContext = { ...trade, structureId: "s3", quote: { ...trade.quote, structureId: "s3" } };
		h.setProps({ ticket: moved.quote.ticket, structureLabel: moved.structureLabel, expiryLabel: moved.expiryLabel, trade: moved });
		await h.settle();
		held.resolve({
			ok: true,
			stage: "approve",
			approve: {
				to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const,
				data: `0x095ea7b3${"0".repeat(24)}${"1".repeat(40)}${(5_000_000).toString(16).padStart(64, "0")}` as const,
				value: "0" as const,
			},
			allowance: {
				amount: "5000000",
				spender: `0x${"1".repeat(40)}`,
				tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
				tokenSymbol: "USDC",
				tokenDecimals: 6,
			},
			expected: RAW_BUY,
			note: "",
		});
		await h.settle();

		expect(calls.sends.map((s) => s.data)).toEqual([]);
	});
});

// ------------------------------------------------------- finding 2: REMOUNT

describe("C#2: a remount must not put a second fill in front of the user", () => {
	test("MOUNT / SAME_MOUNT_RETRY / REMOUNT — sends stay 1", async () => {
		reset();
		replies.record = async () => {
			throw new Error("response lost");
		};

		const trade = context();
		const first = mountTicket(trade);
		first.click(first.button(/Trade/) as NonNullable<ReturnType<typeof first.button>>);
		await first.settle();
		const mount1 = { sends: calls.sends.length, records: calls.records.length, label: primary(first).text };

		// Same mount: the button records, it does not trade.
		first.click(primary(first));
		await first.settle();
		const sameMount = { sends: calls.sends.length, records: calls.records.length };

		// The user reloads the page. A fresh component, same wallet, same chain.
		first.unmount();
		const second = mountTicket(trade);
		await second.settle();
		const label = primary(second).text;
		if (label !== "Record the fill") {
			second.click(primary(second));
			await second.settle();
		}
		const remount = { sends: calls.sends.length, label };

		expect({ mount1, sameMount, remount }).toEqual({
			mount1: { sends: 1, records: 1, label: "Record the fill" },
			sameMount: { sends: 1, records: 2 },
			remount: { sends: 1, label: "Record the fill" },
		});
	});

	test("a durable recording answer releases the hold, so the next mount trades again", async () => {
		reset();
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect(storage.size).toBe(0);

		const again = mountTicket();
		await again.settle();
		expect(primary(again).text).toBe("Trade");
	});

	test("a refusal keeps the hold across the remount — money moved either way", async () => {
		reset();
		replies.record = async () => ({ ok: false, code: "X", reason: "not yet" });
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect(storage.size).toBe(1);

		const again = mountTicket();
		await again.settle();
		expect(primary(again).text).toBe("Record the fill");
		again.click(primary(again));
		await again.settle();
		expect(calls.sends.length).toBe(1);
		expect(calls.records.length).toBe(2);
	});

	test("another wallet does not inherit the held fill", async () => {
		reset();
		replies.record = async () => ({ ok: false, code: "X", reason: "not yet" });
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();

		const other = { ...context(), sessionWallet: "0x00000000000000000000000000000000000000b2" };
		const again = mount(TakeASide, {
			ticket: other.quote.ticket,
			structureLabel: other.structureLabel,
			expiryLabel: other.expiryLabel,
			trade: other,
		});
		await again.settle();
		expect(primary(again).text).toBe("Trade");
	});
});

// ----------------------------------------------- C-R2: PRD 14's 30-second window

/**
 * C-R2 (confirming round, MAJOR). The ticket sent whatever the server had
 * prepared, however old. `rg preparedAt|fillIsStale` in this component returned
 * no matches, and the reviewer's probe broadcast 31-second-old calldata with
 * the maker signature still valid:
 *   MARKET_STALE {"sends":[{"to":"0x1bdff855…","data":"0xSTALE"}],"prepares":1}
 */
describe("C-R2: the ticket may not broadcast calldata older than 30 seconds", () => {
	const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
	const fillAt = (data: `0x${string}`, expected: QuoteRaw, preparedAt: string) =>
		({
			ok: true,
			stage: "fill",
			fill: { to: "0x1bdff855d6811728acadc00989e79143a2bdfded" as const, data, value: "0" as const },
			token: data === "0xFRESH" ? "tok2" : "tok",
			thesisId: null,
			expected,
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt,
			note: "",
		}) satisfies PrepareResult;

	test("MARKET_STALE — 31 seconds old: re-prepare, then send the FRESH calldata", async () => {
		reset();
		let call = 0;
		replies.prepare = async () => {
			call += 1;
			return call === 1 ? fillAt("0xSTALE", RAW_BUY, at(31_000)) : fillAt("0xFRESH", RAW_BUY, at(0));
		};
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect({ prepares: calls.prepares.length, sends: calls.sends.map((s) => s.data) }).toEqual({
			prepares: 2,
			sends: ["0xFRESH"],
		});
		// Recorded with the ticket that BUILT the sent calldata, not the stale one.
		expect(calls.records.map((r) => r.token)).toEqual(["tok2"]);
	});

	test("a fill inside the window is sent with no extra round trip", async () => {
		reset();
		replies.prepare = async () => fillAt("0xBUY_A", RAW_BUY, at(29_000));
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect({ prepares: calls.prepares.length, sends: calls.sends.map((s) => s.data) }).toEqual({
			prepares: 1,
			sends: ["0xBUY_A"],
		});
	});

	test("a refresh that is ITSELF stale sends nothing", async () => {
		reset();
		replies.prepare = async () => fillAt("0xSTALE", RAW_BUY, at(31_000));
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect({ prepares: calls.prepares.length, sends: calls.sends }).toEqual({ prepares: 2, sends: [] });
		expect(h.text()).toContain("could not be refreshed inside the 30 seconds");
	});

	test("an absent preparedAt is treated as stale — fail closed", async () => {
		reset();
		let call = 0;
		replies.prepare = async () => {
			call += 1;
			if (call === 1) {
				const { preparedAt: _drop, ...rest } = fillAt("0xNOSTAMP", RAW_BUY, at(0));
				return rest as unknown as PrepareResult;
			}
			return fillAt("0xFRESH", RAW_BUY, at(0));
		};
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect({ prepares: calls.prepares.length, sends: calls.sends.map((s) => s.data) }).toEqual({
			prepares: 2,
			sends: ["0xFRESH"],
		});
	});

	test("a refresh that arrives after the ticket moved sends nothing", async () => {
		reset();
		const trade = context();
		let call = 0;
		const held = deferred<PrepareResult>();
		replies.prepare = () => {
			call += 1;
			return call === 1 ? Promise.resolve(fillAt("0xSTALE", RAW_BUY, at(31_000))) : held.promise;
		};
		const h = mountTicket(trade);
		h.click(primary(h));
		await h.settle();
		const moved: TradePanelContext = { ...trade, structureId: "s9", quote: { ...trade.quote, structureId: "s9" } };
		h.setProps({ ticket: moved.quote.ticket, structureLabel: moved.structureLabel, expiryLabel: moved.expiryLabel, trade: moved });
		await h.settle();
		held.resolve(fillAt("0xFRESH", RAW_BUY, at(0)));
		await h.settle();
		expect(calls.sends).toEqual([]);
		expect(h.text()).toContain("The ticket changed while this was being prepared");
	});
});

// -------------------------- C-R3: the approval is signed for what the panel shows

/**
 * C-R3 (confirming round, MAJOR). `prepare.ts:155-185` issues an approval for
 * EXACTLY the fresh quote's debit, and the ticket signed it before comparing
 * that quote with the panel — measured on a $5.00 panel:
 *   APPROVE_BEFORE_COMPARE {"sends":1,"sentAllowance":"20000000"}
 */
describe("C-R3: no allowance is signed before the economics are compared", () => {
	const RAW_BIG: QuoteRaw = { ...RAW_BUY, budget: "20000000", numContracts: "40000", premiumGross: "20000000", debit: "20000000", maxLossUsd8: "2000000000" };
	const USDC_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
	const BOOK = "1bdff855d6811728acadc00989e79143a2bdfded";
	const approveFor = (expected: QuoteRaw, amount: bigint, calldataAmount = amount) =>
		({
			ok: true,
			stage: "approve",
			approve: {
				to: USDC_TOKEN as `0x${string}`,
				data: `0x095ea7b3${"0".repeat(24)}${BOOK}${calldataAmount.toString(16).padStart(64, "0")}` as `0x${string}`,
				value: "0" as const,
			},
			allowance: {
				amount: amount.toString(),
				spender: `0x${BOOK}`,
				tokenAddress: USDC_TOKEN,
				tokenSymbol: "USDC",
				tokenDecimals: 6,
			},
			expected,
			note: "Approve USDC first.",
		}) satisfies PrepareResult;

	test("APPROVE_BEFORE_COMPARE — a 20 USDC approval under a $5 panel is not sent", async () => {
		reset();
		replies.prepare = async () => approveFor(RAW_BIG, 20_000_000n);
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect(calls.sends).toEqual([]);
		expect(h.text()).toContain("The price moved while this was prepared");
		// The panel was refreshed from the server, so the next click signs for
		// figures the user has seen.
		expect(calls.quotes.length).toBe(1);
	});

	test("an approval for the SHOWN economics is sent, and its note names the decoded allowance", async () => {
		reset();
		let call = 0;
		// The SECOND preparation is held, so the card can be inspected while the
		// approval is on chain and the fill has not been built yet.
		const second = deferred<PrepareResult>();
		replies.prepare = () => {
			call += 1;
			return call === 1 ? Promise.resolve(approveFor(RAW_BUY, 5_000_000n)) : second.promise;
		};
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		const approval = calls.sends[0];
		expect({
			sends: calls.sends.length,
			// The bytes carry exactly the amount the note printed.
			allowance: approval === undefined ? null : BigInt(`0x${approval.data.slice(-64)}`).toString(),
			note: h.text().includes("This approval allows 5 USDC"),
		}).toEqual({ sends: 1, allowance: "5000000", note: true });

		second.resolve({
			ok: true,
			stage: "fill",
			fill: { to: "0x1bdff855d6811728acadc00989e79143a2bdfded" as const, data: "0xBUY_A" as const, value: "0" as const },
			token: "tok",
			thesisId: null,
			expected: RAW_BUY,
			signatureExpiresAt: new Date(Date.now() + 90_000).toISOString(),
			preparedAt: new Date().toISOString(),
			note: "",
		} satisfies PrepareResult);
		await h.settle();
		expect(calls.sends.map((s) => s.data).slice(1)).toEqual(["0xBUY_A"]);
	});

	test("an approval whose BYTES disagree with the printed amount is not sent", async () => {
		reset();
		// The server says 5 USDC; the calldata allows 20.
		replies.prepare = async () => approveFor(RAW_BUY, 5_000_000n, 20_000_000n);
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect(calls.sends).toEqual([]);
		expect(h.text()).toContain("Nothing was sent");
	});
});
