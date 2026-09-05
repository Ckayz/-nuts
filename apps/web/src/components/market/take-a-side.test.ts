/**
 * The ticket's two pure fences, which the component has no DOM harness to
 * exercise: the pre-send guard (F14 / C4) and the displayed-vs-signed
 * economics comparison (C5).
 */
import { describe, expect, test } from "bun:test";
import { changedEconomics, sameEconomics, sendGuard } from "./take-a-side";
import type { QuoteRaw } from "@/lib/trade/types";

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
