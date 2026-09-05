/**
 * The AI hookup's URL contract (fold brief, owner 2026-09-05 18:2x "go on all")
 * and the money-path fences on the agent's write tool.
 *
 * Two URL shapes are fixed and shared with the UI writer, so they are pinned
 * here rather than left to prose: `/agent?thesis=<uuid>` and
 * `/m/<asset>?thesis=<uuid>`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const UUID = "9f1c7a52-0b64-4d19-9c3a-2b7e5d1a4f01";

describe("AI hookup URL contract", () => {
	test("the agent page accepts ?thesis=<uuid> and refuses anything else", () => {
		const source = read("../../app/agent/page.tsx");
		// It reads the parameter and hands only a validated uuid to the chat.
		expect(source).toContain("searchParams");
		expect(source).toContain("params.thesis");
		expect(source).toContain("UUID.test(raw)");
		expect(source).toContain("thesisId={thesisId}");

		// The same grammar the read layer uses, applied to the values that matter.
		const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		expect(uuidPattern.test(UUID)).toBe(true);
		for (const bad of ["", "not-a-uuid", "../../etc/passwd", "1 OR 1=1", `${UUID}x`]) {
			expect(uuidPattern.test(bad)).toBe(false);
		}
	});

	test("the market link the agent hands back is /m/<asset>?thesis=<uuid>", () => {
		const source = read("../thetanuts/../agent/tools.ts");
		expect(source).toContain("`/m/${asset.toLowerCase()}?thesis=${result.context.thesis.id}`");
		// The shape itself, so a rename of either side fails here.
		const url = `/m/${"ETH".toLowerCase()}?thesis=${UUID}`;
		expect(url).toBe(`/m/eth?thesis=${UUID}`);
		const parsed = new URL(url, "https://thesis.fun");
		expect(parsed.pathname).toBe("/m/eth");
		expect(parsed.searchParams.get("thesis")).toBe(UUID);
	});

	test("the market page reads both parameters the link can carry", () => {
		const source = read("../../app/m/[asset]/page.tsx");
		expect(source).toContain('single("thesis")');
		expect(source).toContain('single("structure")');
	});

	test("the system prompt tells the agent to end with that link, verbatim", () => {
		const prompt = read("./prompt.ts");
		expect(prompt).toContain("marketUrl");
		expect(prompt).toContain("verbatim");
	});
});

describe("agent money path", () => {
	const execute = read("./execute.ts");

	test("PRD 10.2: the agent risk ceiling is unchanged at 10 USD", () => {
		expect(execute).toContain("const MAX_LOSS_USD = 10;");
	});

	test("calldata comes from the ONE shared path, never a second one", () => {
		// `prepareTradeFor` issues the signed ticket that `recordTrade` needs.
		expect(execute).toContain("prepareTradeFor(session,");
		// And the tool no longer builds calldata itself.
		expect(execute).not.toContain("await buildFillTransactions(");
	});

	test("the session is bound server-side and must match the connected wallet", () => {
		expect(execute).toContain("session === null");
		expect(execute).toContain("session.walletAddress.toLowerCase() !== account.toLowerCase()");
		const route = read("../../app/api/agent/chat/route.ts");
		// From the cookie, never from the request body.
		expect(route).toContain("const session = await getSession();");
		expect(route).toContain("createExecutionTools({ account, session, thesisId })");
		expect(route).not.toContain("session: body.data");
	});

	test("the agent still prepares BUYS only", () => {
		expect(execute).toContain('order.side !== "buy"');
		expect(execute).toContain('side: "bull"');
	});

	test("the executor pins the chain and the account on every send", () => {
		const component = read("../../components/agent/trade-execution.tsx");
		// Two sends, each with both.
		expect(component.match(/chainId: expectedChainId,\n\t\t\t\t\taccount,/g)?.length ?? 0).toBe(1);
		expect(component.match(/chainId: expectedChainId,\n\t\t\t\taccount,/g)?.length ?? 0).toBe(1);
		// The CONNECTED wallet's chain, not the config's.
		expect(component).toContain("useConnection()");
		expect(component).not.toContain("useChainId()");
	});

	test("the approval is awaited to a mined receipt before the fill is prepared", () => {
		const component = read("../../components/agent/trade-execution.tsx");
		expect(component).toContain("waitForTransactionReceipt(config,");
		expect(component).toContain('approvalReceipt.status !== "success"');
		// And the re-prepare happens after it.
		expect(component.indexOf("waitForTransactionReceipt(config,")).toBeLessThan(
			component.indexOf("const second = await prepareTrade("),
		);
	});

	test("the receipt is recorded through recordTrade, and a held hash is never re-filled", () => {
		const component = read("../../components/agent/trade-execution.tsx");
		expect(component).toContain("recordTrade({ token: ready.token, txHash: fillHash })");
		// C6: a hash already held short-circuits into recording, before any send.
		expect(component).toContain("if (hash !== null) {");
		expect(component.indexOf("if (hash !== null) {")).toBeLessThan(
			component.indexOf("setPhase(\"approving\")"),
		);
		// The hash is stored before anything that can throw after the send.
		expect(component.indexOf("setHash(fillHash);")).toBeLessThan(
			component.indexOf("const recorded = await recordTrade("),
		);
	});

	test("displayed and signed economics are compared before the fill", () => {
		const component = read("../../components/agent/trade-execution.tsx");
		expect(component).toContain("sameEconomics(ready.expected, shown)");
		expect(component.indexOf("sameEconomics(ready.expected, shown)")).toBeLessThan(
			component.indexOf('setPhase("filling")'),
		);
	});

	test("the AI never signs: the tool returns calldata and nothing else sends it", () => {
		expect(execute).not.toContain("sendTransaction");
		expect(execute).not.toContain("privateKey");
		expect(execute).not.toContain("walletClient");
		expect(read("./tools.ts")).not.toContain("sendTransaction");
	});
});
