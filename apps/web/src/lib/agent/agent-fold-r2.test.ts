/**
 * Lane C confirming pass (Astra MEDIUM, pin `e35eb43`) — the agent findings.
 *
 * Each block names the reviewer's probe and asserts the behaviour that probe
 * measured, not the source text: a `toContain` on a string is exactly the guard
 * that let finding 1 through in the first place.
 */
import { describe, expect, test } from "bun:test";
import { readUIMessageStream } from "ai";
import { approvalRequest, chatRequestBody, marketLinkParts } from "@/components/agent/agent-chat";
import { displayFrom } from "@/components/agent/trade-execution";
import { AGENT_COLLATERAL, DAILY_TURNS, MAX_LOSS_USD8, withinAgentLimits } from "./limits";
import { limitFor, subjectFor, utcDay } from "./usage";
import { getPublicPostContext } from "@/lib/post-context";
import { agentChatBodySchema } from "./request";
import type { PrepareResult, QuoteRaw } from "@/lib/trade/types";

/** The chunks a real approval-suspended tool call streams, in order. */
const APPROVAL_CHUNKS = [
	{ type: "start" },
	{ type: "start-step" },
	{ type: "tool-input-start", toolCallId: "c1", toolName: "requestOptionBookExecution" },
	{
		type: "tool-input-available",
		toolCallId: "c1",
		toolName: "requestOptionBookExecution",
		input: { instrumentKey: "ETH|put|1", budget: "5" },
	},
	{ type: "tool-approval-request", approvalId: "approval-1", toolCallId: "c1" },
	{ type: "finish-step" },
	{ type: "finish" },
];

async function partsFromChunks(chunks: unknown[]) {
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk as never);
			controller.close();
		},
	});
	let last: { parts: unknown[] } | null = null;
	for await (const message of readUIMessageStream({ stream })) last = message as { parts: unknown[] };
	return last?.parts ?? [];
}

describe("C1-r2 BLOCKER: the approval controls must render on the SDK's real part", () => {
	test("`ai@7.0.92` turns the approval chunk into tool-<name> / approval-requested", async () => {
		const parts = await partsFromChunks(APPROVAL_CHUNKS);
		const part = parts.find(
			(p) => (p as { state?: string }).state === "approval-requested",
		) as Record<string, unknown> | undefined;
		expect(part).toBeDefined();
		// The reviewer's UI_MATCH probe: the OLD test could never be true.
		expect(parts.some((p) => (p as { type?: string }).type === "tool-approval-request")).toBe(false);
		expect(part?.type).toBe("tool-requestOptionBookExecution");
		expect((part?.approval as { id?: string } | undefined)?.id).toBe("approval-1");
	});

	test("that part yields the approval id and the tool input the card shows", async () => {
		const parts = await partsFromChunks(APPROVAL_CHUNKS);
		const found = parts.map(approvalRequest).find((value) => value !== null);
		expect(found).toEqual({ id: "approval-1", input: { instrumentKey: "ETH|put|1", budget: "5" } });
	});

	test("nothing else in a message is treated as an approval", async () => {
		const parts = await partsFromChunks([
			{ type: "start" },
			{ type: "start-step" },
			{ type: "text-start", id: "t" },
			{ type: "text-delta", id: "t", delta: "hello" },
			{ type: "text-end", id: "t" },
			{ type: "tool-input-start", toolCallId: "c2", toolName: "getMarketData" },
			{ type: "tool-input-available", toolCallId: "c2", toolName: "getMarketData", input: {} },
			{ type: "tool-output-available", toolCallId: "c2", output: { ok: true } },
			{ type: "finish-step" },
			{ type: "finish" },
		]);
		expect(parts.map(approvalRequest).filter((value) => value !== null)).toEqual([]);
	});

	test("a malformed approval is not rendered as one", () => {
		for (const bad of [
			null,
			undefined,
			"tool-x",
			{ type: "tool-x", state: "approval-requested" },
			{ type: "tool-x", state: "approval-requested", approval: {} },
			{ type: "tool-x", state: "approval-requested", approval: { id: "" } },
			{ type: "text", state: "approval-requested", approval: { id: "a" } },
			{ type: "tool-x", state: "input-available", approval: { id: "a" } },
		]) {
			expect(approvalRequest(bad)).toBeNull();
		}
	});
});

describe("C3-r2: the agent ceiling applies to what was PREPARED", () => {
	const quote = (over: Partial<QuoteRaw> = {}): QuoteRaw =>
		({
			numContracts: "1000000",
			contractSizeDecimals: 6,
			pricePerContract: "50000000",
			premiumGross: "500000",
			feeEstimate: "1000",
			collateralPosted: "0",
			debit: "500000",
			credit: "0",
			collateralDecimals: 6,
			collateralSymbol: "USDC",
			collateralAddress: "0xcol",
			maxLossUsd8: "500000000",
			maxPayoutUsd8: "1000000000",
			breakEvenUsd8: "300000000000",
			...over,
		}) as QuoteRaw;

	const fill = (over: Partial<QuoteRaw> = {}): PrepareResult => ({
		ok: true,
		stage: "fill",
		fill: { to: "0xbook", data: "0xdead", value: "0" },
		token: "t",
		thesisId: null,
		expected: quote(over),
		signatureExpiresAt: "2026-09-05T08:00:30.000Z",
		note: "",
	});

	test("$5 of prepared risk passes", () => {
		expect(withinAgentLimits(fill())).toEqual({ ok: true });
	});

	test("the reviewer's $20 return is refused (returnedRiskUsd8 2000000000)", () => {
		const gate = withinAgentLimits(fill({ maxLossUsd8: "2000000000" }));
		expect(gate.ok).toBe(false);
		if (gate.ok) throw new Error("unreachable");
		expect(gate.reason).toContain("20.00");
	});

	test("exactly the ceiling passes; one base unit over does not", () => {
		expect(withinAgentLimits(fill({ maxLossUsd8: MAX_LOSS_USD8.toString() })).ok).toBe(true);
		expect(withinAgentLimits(fill({ maxLossUsd8: (MAX_LOSS_USD8 + 1n).toString() })).ok).toBe(false);
	});

	test("PRD 10.2 USDC-only: aBasUSDC is refused even at $1 of risk", () => {
		const gate = withinAgentLimits(fill({ collateralSymbol: "aBasUSDC", maxLossUsd8: "100000000" }));
		expect(gate.ok).toBe(false);
		if (gate.ok) throw new Error("unreachable");
		expect(gate.reason).toContain(AGENT_COLLATERAL);
	});

	test("a quote with no USD max loss is refused, not waved through", () => {
		expect(withinAgentLimits(fill({ maxLossUsd8: null })).ok).toBe(false);
		expect(withinAgentLimits(fill({ maxLossUsd8: "not-a-number" })).ok).toBe(false);
	});

	test("the approval leg has nothing to measure and is not refused", () => {
		const approve: PrepareResult = {
			ok: true,
			stage: "approve",
			approve: { to: "0xtoken", data: "0xdead", value: "0" },
			note: "",
		};
		expect(withinAgentLimits(approve)).toEqual({ ok: true });
		expect(withinAgentLimits({ ok: false, code: "X", reason: "y" })).toEqual({ ok: true });
	});
});

describe("C4-r2: the card displays the quote it compares", () => {
	const preview = {
		premium: { amount: "1", token: "USDC" },
		contracts: "0.01",
		maxLossUsd: "1",
	};

	test("with no server quote the agent's preview is all there is", () => {
		expect(displayFrom(null, preview)).toEqual({
			pay: "1 USDC",
			maxLossUsd: "1",
			contracts: "0.01",
		});
	});

	test("with a server quote the printed amounts come from THAT quote", () => {
		const quote = {
			numContracts: "2000000",
			contractSizeDecimals: 6,
			debit: "2000000",
			collateralDecimals: 6,
			collateralSymbol: "USDC",
			maxLossUsd8: "200000000",
		} as QuoteRaw;
		// The reviewer's AGENT_INITIAL_DISPLAY: displayed "1" while "2000000" base
		// units were about to be signed for.
		expect(displayFrom(quote, preview)).toEqual({
			pay: "2 USDC",
			// `formatUsd8` trims: 200000000 / 1e8 = 2.
			maxLossUsd: "2",
			contracts: "2",
		});
	});
});

describe("C6-r2: daily model limits (PRD 10.2)", () => {
	test("the PRD's numbers, unchanged", () => {
		expect(DAILY_TURNS.guest).toBe(10);
		expect(DAILY_TURNS.wallet).toBe(50);
		expect(limitFor("ip")).toBe(10);
		expect(limitFor("wallet")).toBe(50);
	});

	test("a signed-in wallet is charged as a wallet, lowercased, even behind a proxy", () => {
		const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" });
		expect(subjectFor("0xAbC0000000000000000000000000000000000001", headers)).toEqual({
			kind: "wallet",
			subject: "0xabc0000000000000000000000000000000000001",
		});
	});

	test("a guest is charged to the left-most forwarded address", () => {
		const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" });
		expect(subjectFor(null, headers)).toEqual({ kind: "ip", subject: "203.0.113.7" });
		expect(subjectFor(null, new Headers({ "x-real-ip": "198.51.100.4" }))).toEqual({
			kind: "ip",
			subject: "198.51.100.4",
		});
	});

	test("an unidentifiable caller yields no subject", () => {
		expect(subjectFor(null, new Headers())).toBeNull();
		expect(subjectFor("", new Headers({ "x-forwarded-for": "  " }))).toBeNull();
	});

	test("the day is the UTC calendar day", () => {
		expect(utcDay(new Date("2026-09-05T23:59:59.000Z"))).toBe("2026-09-05");
		expect(utcDay(new Date("2026-09-06T00:00:00.000Z"))).toBe("2026-09-06");
	});
});

describe("residual: the agent's market link is clickable", () => {
	test("the settled URL shape becomes an anchor and the rest stays text", () => {
		const uuid = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01";
		const parts = marketLinkParts(`Trade it here: /m/eth?thesis=${uuid} — good luck.`);
		expect(parts).toEqual([
			{ text: "Trade it here: ", href: null },
			{ text: `/m/eth?thesis=${uuid}`, href: `/m/eth?thesis=${uuid}` },
			{ text: " — good luck.", href: null },
		]);
	});

	test("a bare market path links too", () => {
		expect(marketLinkParts("see /m/btc")).toEqual([
			{ text: "see ", href: null },
			{ text: "/m/btc", href: "/m/btc" },
		]);
	});

	test("nothing else in model output becomes a destination", () => {
		for (const text of [
			"visit https://example.com now",
			"open /p/9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01",
			"javascript:alert(1)",
			"//evil.example/m/eth",
			"plain words only",
		]) {
			expect(marketLinkParts(text).every((piece) => piece.href === null || piece.href.startsWith("/m/"))).toBe(true);
		}
		expect(marketLinkParts("plain words only")).toEqual([{ text: "plain words only", href: null }]);
	});
});

describe("C7-r2: /agent?thesis= must send thesisId, not only say it", () => {
	const uuid = "aaaa0000-0000-4000-8000-00000000f001";

	test("the body carries the id the page was opened with", () => {
		expect(
			chatRequestBody({ messages: [], body: undefined, walletAddress: "0xabc", thesisId: uuid }),
		).toEqual({ messages: [], walletAddress: "0xabc", thesisId: uuid });
	});

	test("with no post, `thesisId` is absent rather than null (the route's schema is optional)", () => {
		const body = chatRequestBody({ messages: [], body: undefined, walletAddress: "0xabc", thesisId: null });
		expect("thesisId" in body).toBe(false);
	});

	test("the reviewer's measured body — messages + walletAddress only — is no longer produced", () => {
		const body = chatRequestBody({
			messages: [{ role: "user", parts: [{ type: "text", text: `Explain thesis ${uuid}` }] }],
			body: undefined,
			walletAddress: "0xabc",
			thesisId: uuid,
		});
		expect(Object.keys(body).sort()).toEqual(["messages", "thesisId", "walletAddress"]);
	});

	test("the route's own schema accepts that body and rejects a malformed one", () => {
		expect(agentChatBodySchema.safeParse({
			messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
			walletAddress: `0x${"a".repeat(40)}`,
			thesisId: uuid,
		}).success).toBe(true);
		// Residual: both of these used to pass the schema and then THROW inside
		// `latestUserText` — on `m.parts.filter` and on `p.type`.
		expect(agentChatBodySchema.safeParse({ messages: [{ role: "user" }] }).success).toBe(false);
		expect(agentChatBodySchema.safeParse({ messages: [{ role: "user", parts: [null] }] }).success).toBe(false);
		expect(agentChatBodySchema.safeParse({ messages: [] }).success).toBe(false);
		expect(agentChatBodySchema.safeParse({}).success).toBe(false);
	});
});

describe("C8-r2: Explain must read a text-only post", () => {
	const uuid = "aaaa0000-0000-4000-8000-00000000f001";
	const post = {
		id: uuid,
		slug: "eth-goes-up-1a2b",
		headline: "ETH goes up this week",
		rationale: "Funding flipped.",
		taggedAsset: "ETH",
		status: "open",
		createdAt: "2026-09-05T08:00:00.000Z",
		author: { walletAddress: "0xabc", displayName: null },
		url: "/t/eth-goes-up-1a2b",
	};

	test("a published post is returned with its text and nothing financial", async () => {
		const result = await getPublicPostContext(uuid, { findPublicPost: async () => post });
		expect(result).toEqual({ available: true, post });
		if (!result.available) throw new Error("unreachable");
		// The frozen contract's economic keys must not appear here.
		for (const key of ["economics", "structure", "verification", "market"]) {
			expect(key in result.post).toBe(false);
		}
	});

	test("a post the reader does not return is not_found, and so is a non-uuid", async () => {
		const reader = { findPublicPost: async () => null };
		expect(await getPublicPostContext(uuid, reader)).toEqual({ available: false, reason: "not_found" });
		for (const bad of ["", "not-a-uuid", "../../etc/passwd", "1 OR 1=1", `${uuid}x`]) {
			expect(await getPublicPostContext(bad, { findPublicPost: async () => post })).toEqual({
				available: false,
				reason: "not_found",
			});
		}
	});
});
