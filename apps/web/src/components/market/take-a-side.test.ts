/**
 * The ticket's two pure fences, which the component has no DOM harness to
 * exercise: the pre-send guard (F14 / C4) and the displayed-vs-signed
 * economics comparison (C5).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	changedEconomics,
	recordingSettled,
	sameEconomics,
	sendGuard,
	structureChanged,
	ticketClick,
} from "./take-a-side";
import type { QuoteRaw, RecordResult } from "@/lib/trade/types";

const WALLET = "0x00000000000000000000000000000000000000a1";
const BASE = 8453;

const ok = {
	isConnected: true,
	address: WALLET,
	walletChainId: BASE,
	expectedChainId: BASE,
	sessionWallet: WALLET,
} as const;

describe("sendGuard (F14: the wrong-chain guard must actually fire)", () => {
	test("everything in order passes", () => {
		expect(sendGuard(ok)).toEqual({ ok: true });
	});

	test("a wallet on Ethereum is refused and a switch is requested", () => {
		const result = sendGuard({ ...ok, walletChainId: 1 });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.action).toBe("switch");
		expect(result.message).toContain("Base");
	});

	test("every non-Base chain is refused, including an unknown one", () => {
		for (const chain of [1, 10, 137, 42161, 84532, 0]) {
			expect(sendGuard({ ...ok, walletChainId: chain }).ok).toBe(false);
		}
		// Fail closed: an unknown wallet chain is not treated as Base.
		const unknown = sendGuard({ ...ok, walletChainId: undefined });
		expect(unknown.ok).toBe(false);
		if (unknown.ok) throw new Error("unreachable");
		expect(unknown.action).toBe("switch");
	});

	test("a disconnected wallet is asked to connect before anything about chains", () => {
		const result = sendGuard({ ...ok, isConnected: false, walletChainId: 1 });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.action).toBe("connect");
		expect(sendGuard({ ...ok, address: undefined }).ok).toBe(false);
	});

	test("no session, and a connected wallet that is not the session's, both need sign-in", () => {
		for (const input of [
			{ ...ok, sessionWallet: null },
			{ ...ok, sessionWallet: "0x00000000000000000000000000000000000000b2" },
		]) {
			const result = sendGuard(input);
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("unreachable");
			expect(result.action).toBe("signIn");
		}
	});

	test("the session comparison is case-insensitive on the connected address", () => {
		expect(sendGuard({ ...ok, address: WALLET.toUpperCase().replace("0X", "0x") })).toEqual({ ok: true });
	});
});

function raw(overrides: Partial<QuoteRaw> = {}): QuoteRaw {
	return {
		budget: "1000000",
		numContracts: "389926",
		contractSizeDecimals: 6,
		pricePerContract: "256458427",
		premiumGross: "999998",
		feeEstimate: "124999",
		collateralPosted: "0",
		debit: "999998",
		credit: "0",
		makerLiquidity: "912426840",
		collateralDecimals: 6,
		collateralSymbol: "USDC",
		collateralAddress: "0x0000000000000000000000000000000000000005",
		maxLossUsd8: "99999800",
		maxPayoutUsd8: null,
		breakEvenUsd8: "23000000000",
		capped: false,
		...overrides,
	};
}

describe("sameEconomics (C5: the wallet signs for what the panel showed)", () => {
	test("identical quotes match", () => {
		expect(sameEconomics(raw(), raw())).toBe(true);
	});

	test("every economic field is compared", () => {
		const fields: (keyof QuoteRaw)[] = [
			"numContracts",
			"contractSizeDecimals",
			"pricePerContract",
			"premiumGross",
			"feeEstimate",
			"collateralPosted",
			"debit",
			"credit",
			"collateralDecimals",
			"collateralSymbol",
			"collateralAddress",
			"maxLossUsd8",
			"maxPayoutUsd8",
			"breakEvenUsd8",
		];
		for (const field of fields) {
			const before = raw();
			const changed = raw({ [field]: typeof before[field] === "number" ? 99 : "changed" } as Partial<QuoteRaw>);
			expect(sameEconomics(before, changed)).toBe(false);
			expect(changedEconomics(before, changed)).toContain(field);
		}
	});

	test("ONE base unit of drift is a difference: no tolerance is invented here", () => {
		expect(sameEconomics(raw(), raw({ debit: "999999" }))).toBe(false);
		expect(sameEconomics(raw(), raw({ premiumGross: "999997" }))).toBe(false);
		expect(sameEconomics(raw(), raw({ feeEstimate: "125000" }))).toBe(false);
	});

	test("a null on either side never counts as a match", () => {
		expect(sameEconomics(null, raw())).toBe(false);
		expect(sameEconomics(raw(), null)).toBe(false);
		expect(sameEconomics(null, null)).toBe(false);
	});

	test("fields that do not decide money are not compared", () => {
		// `budget` is the request, `makerLiquidity` is the book's remaining size,
		// `capped` restates numContracts: none of them change what is paid.
		expect(sameEconomics(raw(), raw({ budget: "1", makerLiquidity: "1", capped: true }))).toBe(true);
	});

	test("a null-to-value change in an optional USD field is caught", () => {
		expect(sameEconomics(raw({ maxPayoutUsd8: null }), raw({ maxPayoutUsd8: "1" }))).toBe(false);
	});
});

/**
 * The panel used to keep the PREVIOUS structure's figures under the NEW
 * structure's name after a `?structure=…` navigation, because nothing requoted
 * on a structure change (a side click and the amount blur both did). Measured
 * on a db-mode production build: header `BTC put 79,000 P`, but
 * `Order 81000/80000-PS` / `Max loss $250.00`, unchanged 26 s later.
 */
describe("structureChanged", () => {
	const A = "727bc7cc9bcf7f8f";
	const B = "81000_80000_ps_1d";

	test("the same structure does not requote (this is every render after the first)", () => {
		expect(structureChanged(A, A)).toBe(false);
	});

	test("a different structure requotes", () => {
		expect(structureChanged(A, B)).toBe(true);
		expect(structureChanged(B, A)).toBe(true);
	});

	test("the first structure to exist is quoted", () => {
		expect(structureChanged(undefined, A)).toBe(true);
	});

	test("losing the structure requotes nothing (there is nothing to quote)", () => {
		expect(structureChanged(A, undefined)).toBe(false);
		expect(structureChanged(undefined, undefined)).toBe(false);
	});

	test("ids are compared exactly, never by prefix or case", () => {
		expect(structureChanged(A, A.toUpperCase())).toBe(true);
		expect(structureChanged(A, `${A}0`)).toBe(true);
		expect(structureChanged(A, A.slice(0, -1))).toBe(true);
	});
});

/**
 * C6-r2 (lane C confirming pass, finding 2). A recording that fails must never
 * put a Trade button back in front of a user whose fill is already on chain.
 *
 * The reviewer's probe MARKET_RECORD_FAILURE drove the real component with a
 * stubbed wallet and measured `{"sends":2,"records":2}`: the click handler
 * cleared the hash and prepared a second fill. These pin the two decisions that
 * handler now makes, and `sign()` is asserted to consult the first one BEFORE
 * it clears anything — the bug was entirely in the order of those lines.
 */
describe("ticketClick (C6-r2: a sent fill owns every further click)", () => {
	const sent = { token: "ticket-token", txHash: `0x${"ab".repeat(32)}` };

	test("with nothing sent, a click prepares a fill", () => {
		expect(ticketClick(null)).toEqual({ kind: "prepare" });
	});

	test("with a fill sent, a click records THAT hash with THAT ticket", () => {
		expect(ticketClick(sent)).toEqual({ kind: "record", token: sent.token, txHash: sent.txHash });
	});

	test("the recorded pair is the sent pair, never a re-derived one", () => {
		const action = ticketClick(sent);
		if (action.kind !== "record") throw new Error("unreachable");
		expect(action.token).toBe(sent.token);
		expect(action.txHash).toBe(sent.txHash);
	});
});

describe("recordingSettled (C6-r2: only a durable row releases the hash)", () => {
	const success: RecordResult = {
		ok: true,
		status: "confirmed",
		positionId: "p1",
		thesisId: null,
		txHash: `0x${"ab".repeat(32)}`,
		card: null,
		settled: null,
	};

	test("a confirmed row releases it", () => {
		expect(recordingSettled(success)).toBe(true);
	});

	test("a reverted fill also releases it: the row is durable and terminal", () => {
		expect(recordingSettled({ ...success, status: "failed", card: null, settled: null })).toBe(true);
	});

	test("every refusal keeps it held — the money already left the wallet", () => {
		for (const code of ["CHAIN_UNAVAILABLE", "FILL_DOES_NOT_MATCH", "FILL_QUANTITY_UNPROVEN", "TX_HASH_TAKEN"]) {
			expect(recordingSettled({ ok: false, code, reason: "no" })).toBe(false);
		}
	});
});

describe("C6-r2: the click handler consults the sent fill first", () => {
	const source = readFileSync(new URL("./take-a-side.tsx", import.meta.url), "utf8");

	test("`sign` reads the sent fill before it clears the hash or the card", () => {
		const body = source.slice(source.indexOf("const sign = useCallback"));
		const decides = body.indexOf("ticketClick(sentRef.current)");
		const clears = body.indexOf("setTxHash(null)");
		expect(decides).toBeGreaterThan(-1);
		expect(clears).toBeGreaterThan(-1);
		expect(decides).toBeLessThan(clears);
	});

	test("the sent fill is held BEFORE the recording is attempted", () => {
		const body = source.slice(source.indexOf("const sign = useCallback"));
		const holds = body.indexOf("holdSent(fill)");
		const records = body.indexOf("await finishRecording(fill)");
		expect(holds).toBeGreaterThan(-1);
		expect(records).toBeGreaterThan(holds);
	});
});
