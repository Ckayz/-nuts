/**
 * Component-level probes for the market ticket (lane C confirming pass,
 * findings 1 and 2). These drive the REAL `TakeASide` function through the
 * hook runner in `@/test/hook-runner`, with the wallet and the server actions
 * injected, because both bugs live in the wiring rather than in any extracted
 * function.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { deferred, mount } from "@/test/hook-runner";
import { calls, neverLandingReceipt, replies, resetTradeMocks, storage, WALLET } from "@/test/trade-mocks";
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
			bull: { taker: "buy", word: "Bull", directional: true, available: true, reason: null },
			bear: { taker: "sell", word: "Bear", directional: true, available: true, reason: null },
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

// ------------------------------- M5: an approval that never confirms

/**
 * M5 (Opus user-flow tester, confirming round). With a wallet that returns a
 * hash which never lands, the ticket's button stayed "Approving…" and DISABLED
 * at t = 30 / 60 / 120 / 185 / 200 / 215 s, with no message and no way out but
 * a reload (`final-j4-stuck-approving.png`). Reproduced here:
 *   STUCK_APPROVING {"label":"Approving…","disabled":true,"message":false}
 *
 * The safety half held then and must keep holding: exactly one transaction (the
 * approve) is ever offered, and no fill is broadcast.
 */
describe("M5: the ticket stops waiting for an approval and says so", () => {
	const USDC_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
	const BOOK_ADDRESS = "1bdff855d6811728acadc00989e79143a2bdfded";
	const approveFive: PrepareResult = {
		ok: true,
		stage: "approve",
		approve: {
			to: USDC_TOKEN as `0x${string}`,
			data: `0x095ea7b3${"0".repeat(24)}${BOOK_ADDRESS}${(5_000_000).toString(16).padStart(64, "0")}` as `0x${string}`,
			value: "0" as const,
		},
		allowance: {
			amount: "5000000",
			spender: `0x${BOOK_ADDRESS}`,
			tokenAddress: USDC_TOKEN,
			tokenSymbol: "USDC",
			tokenDecimals: 6,
		},
		expected: RAW_BUY,
		note: "Approve USDC first.",
	};

	test("a receipt that never arrives ends in a usable ticket with one sentence", async () => {
		reset();
		replies.prepare = async () => approveFive;
		neverLandingReceipt();
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		const button = primary(h);
		expect({
			label: button.text,
			disabled: button.props.disabled === true,
			// Exactly one transaction was ever offered: the approval.
			sends: calls.sends.length,
			// No fill was prepared behind it.
			prepares: calls.prepares.length,
			says: h.text().includes("has not confirmed on Base yet"),
			// It must NOT claim the approval failed - it may still land.
			claimsFailure: h.text().includes("did not succeed"),
		}).toEqual({ label: "Trade", disabled: false, sends: 1, prepares: 1, says: true, claimsFailure: false });
	});

	test("a REVERTED approval still reads as a failure, not as a timeout", async () => {
		reset();
		replies.prepare = async () => approveFive;
		replies.receiptStatus = "reverted";
		const h = mountTicket();
		h.click(primary(h));
		await h.settle();
		expect(h.text()).toContain("The approval did not succeed on Base");
		expect(calls.sends.length).toBe(1);
	});
});

// ---------------------------------------------------- I-1: the direction words

/**
 * Owner 2026-09-06, decision 1. The ticket prints the words the SERVER resolved
 * for this instrument and sends the taker side those words stand for.
 */
describe("I-1: Bull and Bear on the ticket name the asset's direction", () => {
	/** A PUT: Bull SELLS it, Bear BUYS it. Shaped exactly as `lib/market/page.ts` builds it. */
	function putContext(): TradePanelContext {
		const base = context();
		return {
			...base,
			structureLabel: "ETH put 2,340 P",
			sides: {
				bull: { taker: "sell", word: "Bull", directional: true, available: true, reason: null },
				bear: { taker: "buy", word: "Bear", directional: true, available: true, reason: null },
			},
			quote: { ...quoteView("bear", RAW_BUY, "PUT-A"), taker: "buy", sideNote: "Bear buys the ETH put 2,340 P and pays premium." },
		};
	}

	test("the two buttons read Bull · sell and Bear · buy on a put", () => {
		reset();
		const h = mountTicket(putContext());
		const labels = h
			.buttons()
			.map((b) => b.text)
			.filter((t) => /Bull|Bear|^Buy$|^Sell$/.test(t));
		expect(labels).toEqual(["Bull · sell", "Bear · buy"]);
		expect(h.text()).toContain("Bear buys the ETH put 2,340 P and pays premium.");
	});

	test("pressing Bull on a put quotes and prepares the SELL side", async () => {
		reset();
		replies.quote = async () => ({ ...quoteView("bull", RAW_SELL, "PUT-A"), taker: "sell", sideNote: "Bull sells" });
		replies.prepare = async () => fill("0xSELL_A", RAW_SELL);
		const h = mountTicket(putContext());
		const bull = h.button(/^Bull/);
		expect(bull).not.toBeNull();
		h.click(bull!);
		await h.settle();
		expect(calls.quotes).toEqual([{ structureId: "s1", side: "bull", taker: "sell", budgetInput: "5" }]);
		h.click(primary(h));
		await h.settle();
		expect(calls.prepares.map((c) => ({ side: c.side, taker: c.taker }))).toEqual([{ side: "bull", taker: "sell" }]);
	});

	test("a structure with no direction is labelled with the raw taker verbs", () => {
		reset();
		const base = context();
		const h = mountTicket({
			...base,
			sides: {
				bull: { taker: "buy", word: "Buy", directional: false, available: true, reason: null },
				bear: { taker: "sell", word: "Sell", directional: false, available: true, reason: null },
			},
		});
		const labels = h
			.buttons()
			.map((b) => b.text)
			.filter((t) => /^(Buy|Sell)$/.test(t) || /Bull|Bear/.test(t));
		expect(labels).toEqual(["Buy", "Sell"]);
		expect(h.text()).not.toContain("Bull");
		expect(h.text()).not.toContain("Bear");
	});

	/**
	 * Measured on `/m/eth` at port 31610 before the fix: selecting an ETH put
	 * spread while the panel sat on Bull left
	 *   {"text":"Bull · sell","checked":true,"disabled":true}
	 * — a checked, unfillable button. The server already opens on the fillable
	 * side (`lib/market/page.ts`); this applies the same rule after a
	 * client-side navigation.
	 */
	test("a structure change moves off a side this instrument cannot fill", async () => {
		reset();
		replies.quote = async () => quoteView("bear", RAW_BUY, "PUT-A");
		const h = mountTicket();
		expect(h.buttons().find((b) => /Bull/.test(b.text))?.props["aria-checked"]).toBe(true);
		const put = putContext();
		const next: TradePanelContext = {
			...put,
			structureId: "s2",
			sides: {
				bull: { taker: "sell", word: "Bull", directional: true, available: false, reason: "no maker" },
				bear: { taker: "buy", word: "Bear", directional: true, available: true, reason: null },
			},
		};
		h.setProps({ ticket: next.quote.ticket, structureLabel: next.structureLabel, expiryLabel: next.expiryLabel, trade: next });
		await h.settle();
		const checked = h.buttons().filter((b) => b.props["aria-checked"] === true).map((b) => b.text);
		expect(checked).toEqual(["Bear · buy"]);
		expect(calls.quotes.at(-1)).toMatchObject({ structureId: "s2", side: "bear", taker: "buy" });
	});
});

// ------------------------------------- K3: the ticket's keyboard path

/** The amount field. Present only with live wiring (`trade !== undefined`). */
function amountField(h: ReturnType<typeof mount>) {
	const hit = h.find((e) => e.type === "input")[0];
	if (hit === undefined) throw new Error("no amount input");
	return hit;
}

const pills = (h: ReturnType<typeof mount>) => h.find((e) => e.props.className === "pill");

/** Type into the amount field, exactly as `onChange` receives it. */
function type(h: ReturnType<typeof mount>, value: string): void {
	(amountField(h).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
	h.flush();
}

/** Leave the amount field. */
function blur(h: ReturnType<typeof mount>): void {
	(amountField(h).props.onBlur as () => void)();
	h.flush();
}

describe("K3: a blur that changes nothing must not requote", () => {
	test("UNCHANGED_BLUR — tabbing out of an untouched amount field asks the server nothing", async () => {
		reset();
		const h = mountTicket();
		await h.settle();
		calls.quotes = [];

		blur(h);
		await h.settle();

		// And nothing has been taken out of the keyboard's way for it.
		expect({
			quotes: calls.quotes,
			pillsDisabled: pills(h).map((p) => p.props.disabled),
			tradeDisabled: primary(h).props.disabled,
		}).toEqual({ quotes: [], pillsDisabled: [false], tradeDisabled: false });
	});

	test("a blur after a CHANGED amount still requotes — the fix removes no quote the panel needs", async () => {
		reset();
		const h = mountTicket();
		await h.settle();
		calls.quotes = [];

		type(h, "7");
		blur(h);
		await h.settle();

		expect(calls.quotes).toEqual([{ structureId: "s1", side: "bull", taker: "buy", budgetInput: "7" }]);
	});

	test("a blur after the amount was typed back to what was quoted asks nothing either", async () => {
		reset();
		const h = mountTicket();
		await h.settle();
		calls.quotes = [];

		type(h, "7");
		type(h, "5");
		blur(h);
		await h.settle();

		expect(calls.quotes).toEqual([]);
	});
});

describe("K3: a requote in flight must not take the controls out of the tab order", () => {
	test("QUOTE_IN_FLIGHT — the presets and Trade stay focusable and say they are busy", async () => {
		reset();
		const held = deferred<TicketQuoteView>();
		replies.quote = () => held.promise;

		const h = mountTicket();
		await h.settle();
		type(h, "7");
		blur(h);

		// The quote is in flight: one request out, no answer yet.
		expect(calls.quotes.length).toBe(1);
		const state = {
			label: primary(h).text,
			tradeDisabled: primary(h).props.disabled,
			tradeAriaBusy: primary(h).props["aria-busy"],
			tradeAriaDisabled: primary(h).props["aria-disabled"],
			pillsDisabled: pills(h).map((p) => p.props.disabled),
			pillsAriaBusy: pills(h).map((p) => p.props["aria-busy"]),
			pillsAriaDisabled: pills(h).map((p) => p.props["aria-disabled"]),
		};

		// `mount().click` refuses a `disabled` element, so this line is itself the
		// assertion that the button is reachable — and the counts after it are the
		// assertion that reaching it changed nothing.
		h.click(primary(h));
		h.click(pills(h)[0] as NonNullable<ReturnType<typeof primary>>);

		expect({
			...state,
			sends: calls.sends,
			prepares: calls.prepares,
			// The preset press must not have started a second quote either.
			quotes: calls.quotes.length,
		}).toEqual({
			label: "Quoting…",
			tradeDisabled: false,
			tradeAriaBusy: true,
			tradeAriaDisabled: true,
			pillsDisabled: [false],
			pillsAriaBusy: [true],
			pillsAriaDisabled: [true],
			sends: [],
			prepares: [],
			quotes: 1,
		});

		held.resolve(quoteView("bull", RAW_BUY, "BUY-A"));
		await h.settle();
		// And once the answer lands the ticket is usable again.
		expect({ tradeDisabled: primary(h).props.disabled, pillsDisabled: pills(h).map((p) => p.props.disabled) }).toEqual({
			tradeDisabled: false,
			pillsDisabled: [false],
		});
	});

	test("a PREPARATION in flight is still a real `disabled` — it is not a transient requote", async () => {
		reset();
		const held = deferred<PrepareResult>();
		replies.prepare = () => held.promise;

		const h = mountTicket();
		h.click(primary(h));

		expect({
			tradeDisabled: primary(h).props.disabled,
			pillsDisabled: pills(h).map((p) => p.props.disabled),
			amountDisabled: amountField(h).props.disabled,
		}).toEqual({ tradeDisabled: true, pillsDisabled: [true], amountDisabled: true });

		held.resolve({ ok: false, code: "X", reason: "stop" });
		await h.settle();
	});
});

describe("K3: quoteIsCurrent", () => {
	const at = (structureId: string, side: "bull" | "bear", budgetInput: string) => ({ structureId, side, budgetInput });

	test("the same structure, side and amount is current; any difference is not", async () => {
		const { quoteIsCurrent } = (await import("./take-a-side")) as unknown as {
			quoteIsCurrent: (a: ReturnType<typeof at> | null, b: ReturnType<typeof at>) => boolean;
		};
		expect({
			same: quoteIsCurrent(at("s1", "bull", "5"), at("s1", "bull", "5")),
			otherBudget: quoteIsCurrent(at("s1", "bull", "5"), at("s1", "bull", "7")),
			otherSide: quoteIsCurrent(at("s1", "bull", "5"), at("s1", "bear", "5")),
			otherStructure: quoteIsCurrent(at("s1", "bull", "5"), at("s2", "bull", "5")),
			// Fails closed: with nothing quoted, the blur must still requote.
			nothingQuoted: quoteIsCurrent(null, at("s1", "bull", "5")),
			// "" and "5" are different amounts, not both "empty".
			emptyVsValue: quoteIsCurrent(at("s1", "bull", ""), at("s1", "bull", "5")),
		}).toEqual({
			same: true,
			otherBudget: false,
			otherSide: false,
			otherStructure: false,
			nothingQuoted: false,
			emptyVsValue: false,
		});
	});
});

describe("K3: isQuoting — which pending transition may keep the controls focusable", () => {
	const PHASES = ["idle", "quoting", "preparing", "approving", "filling", "recording", "confirmed", "failed"] as const;

	test("every phase, both `pending` values, with and without a sent fill", async () => {
		const { isQuoting } = (await import("./take-a-side")) as unknown as {
			isQuoting: (pending: boolean, phase: (typeof PHASES)[number], hasSentFill: boolean) => boolean;
		};
		const table = (pending: boolean, hasSentFill: boolean) =>
			Object.fromEntries(PHASES.map((phase) => [phase, isQuoting(pending, phase, hasSentFill)]));

		expect({
			// Nothing in flight: never "quoting", whatever the phase says.
			notPending: table(false, false),
			// A transition in flight. `idle` is in here on purpose: it is the frame
			// in which a landed quote has already set the phase back while the
			// transition is still pending, and treating it as held put the
			// `disabled` attribute on all five controls for one frame (measured).
			pending: table(true, false),
			// A sent, unrecorded fill owns the ticket no matter what else is true.
			pendingWithSentFill: table(true, true),
		}).toEqual({
			notPending: {
				idle: false,
				quoting: false,
				preparing: false,
				approving: false,
				filling: false,
				recording: false,
				confirmed: false,
				failed: false,
			},
			pending: {
				idle: true,
				quoting: true,
				preparing: false,
				approving: false,
				filling: false,
				recording: false,
				confirmed: true,
				failed: true,
			},
			pendingWithSentFill: {
				idle: false,
				quoting: false,
				preparing: false,
				approving: false,
				filling: false,
				recording: false,
				confirmed: false,
				failed: false,
			},
		});
	});
});

describe("K3: the frame in which a landed quote meets a still-pending transition", () => {
	test("QUOTE_LANDING — no control takes the `disabled` attribute back on the way out", async () => {
		reset();
		const held = deferred<TicketQuoteView>();
		replies.quote = () => held.promise;

		const h = mountTicket();
		await h.settle();
		type(h, "7");
		blur(h);
		const labelWhileInFlight = primary(h).text;

		// Step the answer home one microtask at a time and render each frame. The
		// component's own `setPhase("idle")` runs a whole tick before the
		// transition's `isPending` clears, and rendering that gap is the only way
		// to see the frame Chrome saw: measured on a db-mode build with the
		// requote held 600 ms, Tab-ing through the presets as the answer landed
		// went `button:$500` → `<body>` because all five controls were `disabled`
		// again for exactly one frame.
		const frames: Array<{ label: string; trade: unknown; pills: unknown[] }> = [];
		held.resolve(quoteView("bull", RAW_BUY, "BUY-A"));
		for (let i = 0; i < 8; i += 1) {
			await Promise.resolve();
			h.flush();
			frames.push({ label: primary(h).text, trade: primary(h).props.disabled, pills: pills(h).map((p) => p.props.disabled) });
		}
		await h.settle();

		expect({
			labelWhileInFlight,
			// The gap really was rendered: the phase is back to `idle` — the button
			// reads "Trade" again — in the very first frame after the answer, a
			// tick before the transition's `isPending` clears. Without this line
			// the rest of the assertion could pass vacuously.
			firstFrameAfterLanding: frames[0]?.label,
			everDisabled: frames.some((f) => f.trade === true || f.pills.some((d) => d === true)),
			finalTrade: primary(h).props.disabled,
			finalPills: pills(h).map((p) => p.props.disabled),
		}).toEqual({
			labelWhileInFlight: "Quoting…",
			firstFrameAfterLanding: "Trade",
			everDisabled: false,
			finalTrade: false,
			finalPills: [false],
		});
	});
});
