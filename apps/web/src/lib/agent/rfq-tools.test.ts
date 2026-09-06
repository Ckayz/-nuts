/// <reference types="bun" />
/**
 * The agent's RFQ tools.
 *
 * Four properties are pinned here, and each is a defect if it breaks:
 *
 *  1. **The wallet is never a model argument.** Read from the tools' own
 *     `inputSchema`s and, independently, from the file's source.
 *  2. **All three write tools are approval-gated.** Read from `route.ts`'s
 *     `toolApproval` map, not from this file's own list.
 *  3. **A preview never mints a key** and never depends on which key it was
 *     built against.
 *  4. **The 10 USD ceiling reaches the preview**, so the model is told a request
 *     is out of bounds before anyone is asked to approve one.
 *
 * Offline: every case below returns before a chain read or a database read.
 * `reserveFromMmPrice` is the SDK's own `premiumPerContract` rule, pinned
 * against the live numbers it was measured from.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { z } from "zod";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

import {
	createRfqTools,
	matchVanillaPut,
	reserveFromMmPrice,
	rfqActionToolOutput,
	rfqCreateToolOutput,
	sameDecimal,
	RFQ_APPROVAL_REQUIRED_TOOLS,
	type RfqCreateRequestEcho,
} from "./rfq-tools";
import type { RfqExpected } from "@/lib/rfq/prepare";

const CTX = { toolCallId: "test", messages: [], context: {} } as never;
const WALLET = "0xb792296be8202ba2fc5d3276fa184e5b479920e3";
const OTHER = "0x1111111111111111111111111111111111111111";
const SESSION = { userId: "u1", walletAddress: WALLET };

const anonymous = createRfqTools({ session: null, account: null });
const signedIn = createRfqTools({ session: SESSION, account: WALLET as `0x${string}` });
const mismatched = createRfqTools({ session: SESSION, account: OTHER as `0x${string}` });

const shapeOf = (schema: unknown) => Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);

const source = () => readFileSync(new URL("./rfq-tools.ts", import.meta.url), "utf8");

/** A future expiry, so nothing here is refused for a reason it was not testing. */
const EXPIRY = new Date(Date.now() + 7 * 86_400_000).toISOString();

/* ------------------------------------------------------------------ *
 * 1. The wallet is never a model argument.
 * ------------------------------------------------------------------ */

describe("the model cannot name a wallet", () => {
	test("every tool's input schema, field by field", () => {
		expect(shapeOf(anonymous.buildCustomRfqPreview.inputSchema)).toEqual([
			"underlying",
			"strikesUsd",
			"expiryAt",
			"numContracts",
			"reservePricePerContract",
			"offerDeadlineMinutes",
		]);
		expect(shapeOf(anonymous.suggestRfqReservePrice.inputSchema)).toEqual(["underlying", "strikeUsd", "expiryAt"]);
		expect(shapeOf(anonymous.listMyRfqs.inputSchema)).toEqual(["limit"]);
		expect(shapeOf(anonymous.getRfqStatus.inputSchema)).toEqual(["rfqRequestId"]);
		expect(shapeOf(anonymous.requestRfqCreation.inputSchema)).toEqual([
			"underlying",
			"strikesUsd",
			"expiryAt",
			"numContracts",
			"reservePricePerContract",
			"offerDeadlineMinutes",
		]);
		expect(shapeOf(anonymous.requestRfqCancellation.inputSchema)).toEqual(["rfqRequestId"]);
		expect(shapeOf(anonymous.requestRfqSettlement.inputSchema)).toEqual(["rfqRequestId"]);
	});

	/** A second, independent measurement: nothing address-shaped in any schema block. */
	test("no inputSchema block in the file names an address", () => {
		// Each schema block runs from `inputSchema: z.object({` to that tool's
		// `execute:`; the shared field schemas above are read the same way.
		const blocks = source()
			.split("inputSchema: z.object({")
			.slice(1)
			.map((rest) => rest.split("execute:")[0] ?? "");
		const shared = source().slice(0, source().indexOf("export interface RfqToolsParams"));
		expect(blocks.length).toBe(7);
		expect(shared).not.toMatch(/^const \w*(?:wallet|address|account)\w*Schema/im);
		for (const block of blocks) {
			expect(block).not.toMatch(/wallet|address|account|requester|owner/i);
		}
	});

	test("a signed-out session refuses every tool that needs one, and never throws", async () => {
		expect(await anonymous.listMyRfqs.execute({ limit: 10 }, CTX)).toMatchObject({ signedIn: false });
		expect(await anonymous.getRfqStatus.execute({ rfqRequestId: "x" }, CTX)).toMatchObject({ found: false });
		for (const tool of [anonymous.requestRfqCancellation, anonymous.requestRfqSettlement]) {
			expect(await tool.execute({ rfqRequestId: "x" }, CTX)).toMatchObject({ prepared: false });
		}
		const created = await anonymous.requestRfqCreation.execute(
			{
				underlying: "ETH",
				strikesUsd: ["2300"],
				expiryAt: EXPIRY,
				numContracts: "1",
				reservePricePerContract: "0.5",
				offerDeadlineMinutes: 60,
			},
			CTX,
		);
		expect(created).toMatchObject({ prepared: false, kind: "rfq_create" });
	});

	/**
	 * The same fence `createExecutionTools` carries: an escrow must not leave a
	 * different address than the one that will own the request. Mutant: delete
	 * the `account.toLowerCase() !== session.walletAddress.toLowerCase()` branch
	 * in `signedInAccount`.
	 */
	test("a connected wallet that is not the signed-in one refuses all three writes", async () => {
		const create = await mismatched.requestRfqCreation.execute(
			{
				underlying: "ETH",
				strikesUsd: ["2300"],
				expiryAt: EXPIRY,
				numContracts: "1",
				reservePricePerContract: "0.5",
				offerDeadlineMinutes: 60,
			},
			CTX,
		);
		expect(create).toMatchObject({ prepared: false, kind: "rfq_create" });
		expect(JSON.stringify(create)).toContain("not the one that signed in");
		for (const [tool, kind] of [
			[mismatched.requestRfqCancellation, "rfq_cancel"],
			[mismatched.requestRfqSettlement, "rfq_settle"],
		] as const) {
			const refused = await tool.execute({ rfqRequestId: "x" }, CTX);
			expect(refused).toMatchObject({ prepared: false, kind });
		}
	});
});

/* ------------------------------------------------------------------ *
 * 2. Approval gating.
 * ------------------------------------------------------------------ */

describe("every write tool is approval-gated", () => {
	test("route.ts's own toolApproval map names all three, read from its source", () => {
		const route = readFileSync(
			new URL("../../app/api/agent/chat/route.ts", import.meta.url),
			"utf8",
		);
		const block = route.match(/toolApproval:\s*\{([\s\S]*?)\n\t\t\}/)?.[1] ?? "";
		expect(block).not.toBe("");
		for (const name of RFQ_APPROVAL_REQUIRED_TOOLS) {
			expect(block).toContain(`${name}: "user-approval"`);
		}
		// And the read tools are absent from it: they cannot move funds.
		for (const name of ["buildCustomRfqPreview", "suggestRfqReservePrice", "listMyRfqs", "getRfqStatus"]) {
			expect(block).not.toContain(name);
		}
	});

	test("the gated list is exactly the tools whose names start with request", () => {
		const names = Object.keys(createRfqTools({ session: null, account: null }));
		expect(names.filter((name) => name.startsWith("request")).sort()).toEqual([...RFQ_APPROVAL_REQUIRED_TOOLS].sort());
	});

	/** Nothing in this file signs, sends or holds a key. */
	test("the module contains no signer, no key and no send", () => {
		const text = source();
		for (const forbidden of ["sendTransaction", "privateKey", "walletClient", "getOrCreateWalletRfqKey", "signTypedData"]) {
			expect(text).not.toContain(forbidden);
		}
	});
});

/* ------------------------------------------------------------------ *
 * 3. Preview.
 * ------------------------------------------------------------------ */

const preview = (over: Record<string, unknown> = {}) =>
	signedIn.buildCustomRfqPreview.execute(
		{
			underlying: "ETH",
			strikesUsd: ["2300"],
			expiryAt: EXPIRY,
			numContracts: "1",
			reservePricePerContract: "0.5",
			offerDeadlineMinutes: 60,
			...over,
		} as never,
		CTX,
	);

describe("buildCustomRfqPreview", () => {
	test("prices the escrow, the strikes and both deadlines, and returns no calldata", async () => {
		const result = (await preview()) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(true);
		expect(result.expected).toMatchObject({
			depositBaseUnits: "500000",
			deposit: "0.5",
			strikesUsd: ["2300"],
			numContracts: "1",
			maxLossUsd: "0.5",
			collateralSymbol: "USDC",
		});
		expect(result.maxLossUsd).toBe("0.5");
		// A preview hands back nothing a wallet could send.
		const text = JSON.stringify(result);
		expect(text).not.toContain('"create"');
		expect(text).not.toContain('"approve"');
		expect(text).not.toContain('"data"');
		expect(text).not.toContain('"token"');
	});

	/**
	 * THE CEILING, at the preview. Mutant: return `ok: true` unconditionally in
	 * `buildCustomRfqPreview`.
	 */
	test("says out loud when a request is over the 10 USD limit", async () => {
		const result = (await preview({ reservePricePerContract: "11" })) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(false);
		expect(String(result.refusal)).toContain("10 USD agent limit");
		// The economics are still returned so the model can explain the gap.
		expect(result.expected).toMatchObject({ deposit: "11" });
	});

	test("an escrow over the limit at TWENTY-ONE contracts is refused too", async () => {
		const ok = (await preview({ numContracts: "20" })) as unknown as Record<string, unknown>;
		expect(ok.ok).toBe(true);
		const over = (await preview({ numContracts: "21" })) as unknown as Record<string, unknown>;
		expect(over.ok).toBe(false);
	});

	test("refuses without an offer deadline instead of picking one", async () => {
		const result = (await preview({ offerDeadlineMinutes: undefined })) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(false);
		expect(String(result.refusal)).toContain("Nothing here picks a default");
	});

	test.each([
		["an unparseable expiry", { expiryAt: "next friday" }],
		["an expiry inside the offer window", { expiryAt: new Date(Date.now() + 60_000).toISOString() }],
		["three strikes", { strikesUsd: ["1", "2", "3"] }],
		["a zero contract count", { numContracts: "0" }],
	])("refuses %s with a reason", async (_name, over) => {
		const result = (await preview(over)) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(false);
		expect(typeof result.refusal).toBe("string");
	});

	test("an anonymous preview works and still names no wallet", async () => {
		const result = (await anonymous.buildCustomRfqPreview.execute(
			{
				underlying: "ETH",
				strikesUsd: ["2300"],
				expiryAt: EXPIRY,
				numContracts: "1",
				reservePricePerContract: "0.5",
				offerDeadlineMinutes: 60,
			},
			CTX,
		)) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(true);
		expect(JSON.stringify(result)).not.toContain(WALLET);
	});

	test("a put spread prices both legs and shows them ascending", async () => {
		const result = (await preview({ strikesUsd: ["2300", "2100"] })) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(true);
		expect((result.expected as { strikesUsd: string[] }).strikesUsd).toEqual(["2100", "2300"]);
	});

	/**
	 * WHY A PREVIEW MAY USE A THROWAWAY KEY. The key travels in its own
	 * `requesterPublicKey` field and nothing in `expected` is derived from it, so
	 * a preview can price a request without minting one. Measured through
	 * `buildRfqCreate` with two different valid keys.
	 */
	test("the previewed economics do not depend on which key they were built against", async () => {
		const { buildRfqCreate } = await import("@nuts/thetanuts");
		const { rfqClientFor } = await import("@/lib/rfq/prepare");
		const client = rfqClientFor("0x0000000000000000000000000000000000000000");
		const build = (requesterPublicKey: string) =>
			buildRfqCreate({
				client,
				allowance: 0n,
				params: {
					requester: "0x0000000000000000000000000000000000000000",
					underlying: "ETH",
					strikesUsd: ["2300"],
					expiry: Math.floor(Date.parse(EXPIRY) / 1000),
					numContracts: "1",
					reservePricePerContract: "0.5",
					offerDeadlineMinutes: 60,
					requesterPublicKey,
				},
			});
		const a = build(`0x02${"11".repeat(32)}`);
		const b = build(`0x03${"ab".repeat(32)}`);
		expect(a.expected.requesterPublicKey).not.toBe(b.expected.requesterPublicKey);
		const economics = (built: ReturnType<typeof build>) => ({
			deposit: built.expected.depositBaseUnits.toString(),
			contracts: built.expected.numContracts.toString(),
			strikes: built.expected.strikesUsd8.map(String),
			expiry: built.expected.expiryTimestamp.toString(),
			implementation: built.expected.implementation,
			reserve: built.expected.reservePriceBaseUnits.toString(),
		});
		expect(economics(a)).toEqual(economics(b));
	});

	test("every sentence it returns carries the escrow and fee notes", async () => {
		const result = (await preview()) as unknown as Record<string, unknown>;
		expect(String(result.escrowNote)).toContain("returned in full if it is cancelled");
		expect(String(result.feeNote)).toContain("min(0.06% of notional, 12.5% of premium)");
		expect(String(result.previewNote)).toContain("Nothing has been escrowed");
	});
});

/* ------------------------------------------------------------------ *
 * 4. The reserve-price suggestion arithmetic.
 * ------------------------------------------------------------------ */

describe("reserveFromMmPrice", () => {
	/**
	 * The SDK's own rule, measured at `dist/index.js:16892`:
	 * `premiumPerContract = isBaseCollateral(product) ? mmPrice : mmPrice * spot`,
	 * and a PUT is not a base-collateral product (`:16810`). Numbers below are the
	 * live surface read 2026-09-06: ETH-7SEP26-2900-P asked 0.1619 at a spot of
	 * 2503.39, which is 405.298841 USD per contract exactly.
	 */
	test("multiplies by spot and rounds UP to the USDC unit", () => {
		expect(reserveFromMmPrice(0.1619, 2503.39)).toBe("405.298841");
		// Rounded UP, never down: a reserve is a ceiling on what the buyer pays.
		expect(reserveFromMmPrice(0.0000001, 1)).toBe("0.000001");
	});

	test("refuses anything it cannot value", () => {
		expect(reserveFromMmPrice(0, 2500)).toBeNull();
		expect(reserveFromMmPrice(-1, 2500)).toBeNull();
		expect(reserveFromMmPrice(0.1, 0)).toBeNull();
		expect(reserveFromMmPrice(Number.NaN, 2500)).toBeNull();
		expect(reserveFromMmPrice(Number.POSITIVE_INFINITY, 2500)).toBeNull();
	});

	test("its output is always a valid reservePricePerContract for the tools", async () => {
		const suggested = reserveFromMmPrice(0.0002, 2503.39);
		expect(suggested).toBe("0.500678");
		const result = (await preview({ reservePricePerContract: suggested })) as unknown as Record<string, unknown>;
		expect(result.ok).toBe(true);
	});
});

describe("sameDecimal", () => {
	test("two spellings of one strike are one strike", () => {
		expect(sameDecimal("2450", "2450.00000000")).toBe(true);
		expect(sameDecimal("02450", "2450")).toBe(true);
		expect(sameDecimal("2450.5", "2450.50")).toBe(true);
	});
	test("and two different strikes are not", () => {
		expect(sameDecimal("2450", "2451")).toBe(false);
		expect(sameDecimal("2450.1", "2450.01")).toBe(false);
	});
});

/* ------------------------------------------------------------------ *
 * 5. Matching a strike and an expiry against the market-maker surface.
 * ------------------------------------------------------------------ */

/**
 * Rows in the shape the live surface publishes, read 2026-09-06 from
 * `client.mmPricing.getAllPricing("ETH")`: 783 tickers, 396 of them puts,
 * `ETH-6SEP26-2460-P` expiring 1788681600 = 2026-09-06T08:00:00Z.
 */
const SURFACE = [
	{ ticker: "ETH-6SEP26-2460-P", strike: 2460, expiry: 1_788_681_600, isCall: false },
	{ ticker: "ETH-6SEP26-2460-C", strike: 2460, expiry: 1_788_681_600, isCall: true },
	{ ticker: "ETH-7SEP26-2460-P", strike: 2460, expiry: 1_788_768_000, isCall: false },
	{ ticker: "ETH-11SEP26-2100-P", strike: 2100, expiry: 1_789_113_600, isCall: false },
];

describe("matchVanillaPut", () => {
	test("an exact strike and instant is an exact match", () => {
		const found = matchVanillaPut(SURFACE, { strikeUsd: "2460", expiry: 1_788_681_600 });
		expect(found.match?.ticker).toBe("ETH-6SEP26-2460-P");
		expect(found.expiryMatch).toBe("exact");
		expect(found.nearest).toEqual([]);
	});

	/**
	 * The surface expires at 08:00 UTC and people say dates. A midnight instant
	 * on the same UTC day matches, and SAYS it matched that way.
	 */
	test("midnight on the same UTC day matches and is labelled", () => {
		const found = matchVanillaPut(SURFACE, { strikeUsd: "2460", expiry: 1_788_652_800 });
		expect(found.match?.ticker).toBe("ETH-6SEP26-2460-P");
		expect(found.expiryMatch).toBe("same_utc_day");
	});

	test("a call is never returned for a put", () => {
		const calls = SURFACE.filter((row) => row.isCall);
		expect(matchVanillaPut(calls, { strikeUsd: "2460", expiry: 1_788_681_600 }).match).toBeNull();
	});

	test("a strike the surface does not list returns the nearest, never a substitute", () => {
		const found = matchVanillaPut(SURFACE, { strikeUsd: "2455", expiry: 1_788_681_600 });
		expect(found.match).toBeNull();
		expect(found.nearest.map((row) => row.ticker)).toEqual([
			"ETH-6SEP26-2460-P",
			"ETH-7SEP26-2460-P",
			"ETH-11SEP26-2100-P",
		]);
		expect(found.nearest[0]?.expiryAt).toBe("2026-09-06T08:00:00.000Z");
	});

	test("a different spelling of the same strike still matches", () => {
		expect(matchVanillaPut(SURFACE, { strikeUsd: "2460.00", expiry: 1_788_681_600 }).match?.ticker).toBe(
			"ETH-6SEP26-2460-P",
		);
	});

	test("an empty surface yields no match and no alternatives", () => {
		const found = matchVanillaPut([], { strikeUsd: "2460", expiry: 1_788_681_600 });
		expect(found.match).toBeNull();
		expect(found.nearest).toEqual([]);
	});
});

/* ------------------------------------------------------------------ *
 * 6. The tool envelopes — the contract `components/agent/rfq-execution.tsx`
 *    codes against (`components/agent/rfq-contract.ts`).
 * ------------------------------------------------------------------ */

const TX = { to: "0x8118dad971debffb49b9280047659174128a8b94", data: "0xdeadbeef", value: "0" } as const;
const EXPECTED: RfqExpected = {
	depositBaseUnits: "500000",
	deposit: "0.5",
	strikesUsd: ["2300"],
	numContracts: "1",
	expiryAt: "2026-09-13T08:00:00.000Z",
	offerEndAt: "2026-09-06T09:00:00.000Z",
	factory: "0x8118daD971dEbffB49B9280047659174128A8B94",
	maxLossUsd: "0.5",
	collateralSymbol: "USDC",
};
const REQUEST: RfqCreateRequestEcho = {
	underlying: "ETH",
	strikesUsd: ["2300"],
	expiry: "2026-09-13T08:00:00.000Z",
	numContracts: "1",
	reservePricePerContract: "0.5",
	offerDeadlineMinutes: 60,
};

describe("rfqCreateToolOutput", () => {
	test("the create stage puts the calldata, the ticket and the request where the card reads them", () => {
		const out = rfqCreateToolOutput(
			{
				ok: true,
				stage: "create",
				create: TX,
				token: "tok",
				rfqRequestId: "row-1",
				expected: EXPECTED,
				preparedAt: "2026-09-06T08:00:00.000Z",
				note: "sign it",
			},
			{ account: WALLET, request: { ...REQUEST } },
		);
		// The prepare result, at the TOP level.
		expect(out.ok).toBe(true);
		expect(out.stage).toBe("create");
		expect(out).toMatchObject({
			create: TX,
			token: "tok",
			rfqRequestId: "row-1",
			preparedAt: "2026-09-06T08:00:00.000Z",
			expected: EXPECTED,
			note: "sign it",
		});
		// The envelope.
		expect(out.prepared).toBe(true);
		expect(out.kind).toBe("rfq_create");
		expect(out.chainId).toBe(8453);
		expect(out.account).toBe(WALLET);
		expect(out.transactions).toEqual({ create: TX });
		// The request, nested AND flat — `rfqCreateRequestOf` reads either.
		expect(out.request).toEqual(REQUEST);
		expect(out).toMatchObject(REQUEST);
	});

	test("the approve stage carries its allowance and no ticket", () => {
		const out = rfqCreateToolOutput(
			{
				ok: true,
				stage: "approve",
				approve: TX,
				allowance: {
					amount: "500000",
					spender: "0x8118dad971debffb49b9280047659174128a8b94",
					tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
					tokenSymbol: "USDC",
					tokenDecimals: 6,
				},
				expected: EXPECTED,
				note: "approve it",
			},
			{ account: WALLET, request: { ...REQUEST } },
		);
		expect(out.stage).toBe("approve");
		expect(out).toMatchObject({ approve: TX });
		expect(out.transactions).toEqual({ approve: TX });
		expect("token" in out).toBe(false);
		// The re-prepare request is present at the APPROVE stage too: that is the
		// whole reason it is echoed, since the create is built after the approval
		// mines.
		expect(out.request).toEqual(REQUEST);
		expect(String(out.instruction)).toContain("0.5 USDC");
	});
});

describe("rfqActionToolOutput", () => {
	test("a cancel puts its calldata and ticket at the top level", () => {
		const out = rfqActionToolOutput(
			{
				ok: true,
				cancel: TX,
				quotationId: "125",
				rfqRequestId: "row-1",
				token: "tok",
				preparedAt: "2026-09-06T08:00:00.000Z",
				note: "sign it",
			},
			"rfq_cancel",
			WALLET,
		);
		expect(out).toMatchObject({
			prepared: true,
			kind: "rfq_cancel",
			stage: "cancel",
			cancel: TX,
			token: "tok",
			quotationId: "125",
			rfqRequestId: "row-1",
			chainId: 8453,
		});
		expect(out.transactions).toEqual({ cancel: TX });
		expect("bestPriceBaseUnits" in out).toBe(false);
	});

	test("a settle carries the winning offer as well", () => {
		const out = rfqActionToolOutput(
			{
				ok: true,
				settle: TX,
				quotationId: "125",
				rfqRequestId: "row-1",
				token: "tok",
				bestPrice: "480000",
				preparedAt: "2026-09-06T08:00:00.000Z",
				note: "sign it",
			},
			"rfq_settle",
			WALLET,
		);
		expect(out).toMatchObject({
			prepared: true,
			kind: "rfq_settle",
			stage: "settle",
			settle: TX,
			token: "tok",
			bestPrice: "480000",
		});
		expect(out.transactions).toEqual({ settle: TX });
		expect((out as { bestPriceBaseUnits?: string }).bestPriceBaseUnits).toBe("480000");
		expect(String(out.instruction)).toContain("permissionless");
	});
});

/* ------------------------------------------------------------------ *
 * 7. The server actions the card imports, by name.
 * ------------------------------------------------------------------ */

describe("lib/rfq/actions.ts", () => {
	test("exports exactly the seven names rfq-execution.tsx imports, all async", async () => {
		const actions: Record<string, unknown> = await import("@/lib/rfq/actions");
		for (const name of [
			"prepareRfqCreateFor",
			"prepareRfqCancelFor",
			"prepareRfqSettleFor",
			"recordRfqCreateFor",
			"recordRfqCancelFor",
			"recordRfqSettleFor",
			"getRfqStatusFor",
		]) {
			expect(typeof actions[name]).toBe("function");
			expect((actions[name] as { constructor: { name: string } }).constructor.name).toBe("AsyncFunction");
		}
	});

	test("no action accepts a session or a wallet: each takes exactly one argument", async () => {
		const actions: Record<string, (...args: never[]) => unknown> = await import("@/lib/rfq/actions");
		for (const name of Object.keys(actions)) {
			expect(actions[name]?.length).toBe(1);
		}
	});
});
