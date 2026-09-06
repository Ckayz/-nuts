/**
 * What the reader actually sees under a reply.
 *
 * The unit tests beside `suggestions.ts` prove the parser; these prove the
 * SURFACE, which is where the two failures that matter would show up:
 *   1. the trailer rendering as raw `SUGGEST: ["…"]` text at the bottom of an
 *      answer, and
 *   2. a turn offering nothing to press, which is the thing the owner asked to
 *      fix ("every time a convo there will be like pre message for user to
 *      choose").
 *
 * Rendered with `renderToStaticMarkup`, the same harness `agent-heading.test.tsx`
 * uses, and for the same reason: `useChat` needs a live fetch to do anything, so
 * the transport is replaced wholesale. `@ai-sdk/react` is imported by
 * `agent-chat.tsx` alone (grepped 2026-09-06), so the mock reaches nothing else.
 */
import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WagmiProvider } from "wagmi";

import { mount } from "@/test/hook-runner";
/**
 * The ONE wagmi registration (its own docblock says why there is only one).
 *
 * Imported here so this file's wallet hook is the mocked one whatever order bun
 * loads the suite in: `@/test/hook-runner` implements no `useContext`, and the
 * real hook needs one. MEASURED in this wagmi build: `useAccount` and
 * `useConnection` are the SAME function object
 * (`import("wagmi").useAccount === useConnection` -> true), so the existing
 * `useConnection` override already answers `useAccount`, and the wallet a probe
 * sees is `replies.connection`.
 */
import { replies, resetTradeMocks } from "@/test/trade-mocks";

/** No wallet — what a provider with `reconnectOnMount={false}` used to answer. */
function signedOut(): void {
	replies.connection = { address: undefined, isConnected: false, chainId: 8453 };
}

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

type Part = { type: string; text?: string; state?: string; output?: unknown };
type Message = { id: string; role: "user" | "assistant"; parts: Part[] };

/** What the mocked `useChat` will hand back on the next render. */
const chat: { messages: Message[]; status: string } = { messages: [], status: "ready" };

/**
 * The transport the component built, kept so a test can ask it what it would
 * SEND. `useChat` is the only thing that ever receives it (`agent-chat.tsx`
 * holds it in a `useState` initialiser), and `prepareSendMessagesRequest` is a
 * public field on `DefaultChatTransport` (`ai@7.0.92` dist/index.js:18625).
 */
const captured: {
	transport: { prepareSendMessagesRequest?: (input: unknown) => unknown } | null;
	/** Every `addToolApprovalResponse` argument, in order (T-1). */
	approvals: Record<string, unknown>[];
} = { transport: null, approvals: [] };

mock.module("@ai-sdk/react", () => ({
	useChat: (options?: { transport?: unknown }) => {
		if (options?.transport !== undefined) {
			captured.transport = options.transport as { prepareSendMessagesRequest?: (input: unknown) => unknown };
		}
		return {
			messages: chat.messages,
			sendMessage: () => {},
			status: chat.status,
			error: undefined,
			addToolApprovalResponse: (answer: Record<string, unknown>) => {
				captured.approvals.push(answer);
			},
		};
	},
}));

const { config } = await import("@/lib/wagmi");
const { AgentChat, SuggestionRow } = await import("./agent-chat");
const { postFillSuggestions, starterSuggestions } = await import("@/lib/agent/suggestions");

function render(messages: Message[], props: { asset?: string | null } = {}, status = "ready"): string {
	// Pinned rather than inherited: importing the shared wagmi mock above made
	// the wallet hook answer WHATEVER the last probe left in `replies`, and every
	// assertion in this file was written against a signed-OUT visitor.
	signedOut();
	chat.messages = messages;
	chat.status = status;
	return renderToStaticMarkup(
		<WagmiProvider config={config} reconnectOnMount={false}>
			<AgentChat {...props} variant="panel" />
		</WagmiProvider>,
	);
}

/** The text of every `.pill` in the markup, in order. */
function pills(html: string): string[] {
	return [...html.matchAll(/class="pill"[^>]*>([^<]*)</g)].map((m) => m[1] ?? "");
}

const answer = (text: string): Message => ({ id: "m1", role: "assistant", parts: [{ type: "text", text, state: "done" }] });

test("the trailer becomes chips, and never renders as text", () => {
	const html = render([
		answer(
			'A put is the right to sell at a fixed price.\n\nSUGGEST: ["What is the maximum loss?","What happens at expiry?"]',
		),
	]);
	console.log("CHIPS", JSON.stringify(pills(html)));
	expect(html).toContain("A put is the right to sell at a fixed price.");
	// The two failures that matter, asserted separately: no marker, no JSON.
	expect(html).not.toContain("SUGGEST");
	expect(html).not.toContain("What is the maximum loss?&quot;");
	expect(pills(html)).toEqual(["What is the maximum loss?", "What happens at expiry?"]);
});

test("a text-only turn still offers something to press", () => {
	// The exact shape that used to render an empty row: no tool result, no
	// trailer. `suggestionsFor` returns [] here by design.
	const html = render([answer("I only handle options and theses on Thetanuts here.")]);
	console.log("FALLBACK", JSON.stringify(pills(html)));
	expect(pills(html).length).toBeGreaterThan(0);
});

test("the fallback names the market the panel is about", () => {
	const html = render([answer("Plain answer.")], { asset: "ETH" });
	expect(pills(html)).toContain("What can I trade on ETH?");
});

test("nothing is offered while the answer is still streaming", () => {
	// status "streaming" is what `useChat` reports mid-turn; the trailer is cut
	// from the body even though the part never said so itself.
	const streaming: Message = {
		id: "m1",
		role: "assistant",
		parts: [{ type: "text", text: 'Half an answer.\n\nSUGGEST: ["On' }],
	};
	const html = render([streaming], {}, "streaming");
	expect(html).toContain("Half an answer.");
	expect(html).not.toContain("SUGGEST");
	expect(pills(html)).toEqual([]);
});

test("the empty conversation offers the starters, asset-aware", () => {
	const generic = pills(render([]));
	expect(generic).toEqual(starterSuggestions().map((c) => c.label));

	const eth = pills(render([], { asset: "ETH" }));
	expect(eth).toContain("Protect my ETH from a drop");
	expect(eth).toContain("I think ETH goes up this week. I have $10.");
});

test("after a fill the composer chip is a real link, not a message", () => {
	// `onDone` fires only after a recorded on-chain fill, so the row is rendered
	// directly with the chips that state produces.
	const html = renderToStaticMarkup(
		<SuggestionRow chips={postFillSuggestions("11111111-2222-3333-4444-555555555555")} onSend={() => {}} />,
	);
	console.log("POSTFILL", html);
	expect(html).toContain('<a class="pill" href="/new?link=/p/11111111-2222-3333-4444-555555555555">');
	expect(html).toContain("Write a post about it");
	// The other chip is still a button: it sends a message.
	expect(html).toContain('<button type="button" class="pill">Show my positions</button>');
});

test("an empty chip set renders no row at all", () => {
	expect(renderToStaticMarkup(<SuggestionRow chips={[]} onSend={() => {}} />)).toBe("");
});

/* ------------------------------------------------------------------ *
 * W4, follow-up 1: the composer while an approval card is unanswered
 * ------------------------------------------------------------------ */

/** The shape `readUIMessageStream` produces for a suspended write tool. */
const awaiting: Message = {
	id: "m1",
	role: "assistant",
	parts: [
		{ type: "text", text: "Here is the trade.", state: "done" },
		{
			type: "tool-requestOptionBookExecution",
			state: "approval-requested",
			// `approvalRequest` reads `approval.id`; the cast keeps the fixture
			// the same object the SDK hands the component.
			...({ approval: { id: "a1" }, input: {} } as object),
		} as Part,
	],
};

test("a new message cannot be sent while a card is waiting", () => {
	// `.research/rfq/followups.md` item 1: sending here failed the whole turn
	// with `AI_MissingToolResultsError` and the reader saw "could not complete".
	const html = render([awaiting]);
	console.log("GUARD", JSON.stringify(html.match(/Answer the card above first\./g)));
	// The sentence is printed, not only used as a placeholder.
	expect(html).toContain("Answer the card above first.");
	// Both controls are out of action.
	expect(html).toMatch(/<textarea[^>]*disabled=""/);
	expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send</);
	// And the chip row is gone: pressing a chip sends a message too.
	expect(pills(html)).toEqual([]);
});

test("with no card waiting the composer is live and the chips are back", () => {
	const html = render([answer("Plain answer.")]);
	expect(html).not.toContain("Answer the card above first.");
	expect(html).not.toMatch(/<textarea[^>]*disabled=""/);
	expect(pills(html).length).toBeGreaterThan(0);
});

test("an ANSWERED card releases the composer", () => {
	// Once the user answers, the runtime moves the part to `approval-responded`
	// (`ai@7.0.92` dist/index.d.ts), which `approvalRequest` does not match.
	const answered: Message = {
		id: "m1",
		role: "assistant",
		parts: [
			{
				type: "tool-requestOptionBookExecution",
				state: "approval-responded",
				...({ approval: { id: "a1" }, input: {} } as object),
			} as Part,
		],
	};
	const html = render([answered]);
	expect(html).not.toContain("Answer the card above first.");
	expect(html).not.toMatch(/<textarea[^>]*disabled=""/);
});

test("the person's own words are set apart from the reply", () => {
	const html = render([
		{ id: "u1", role: "user", parts: [{ type: "text", text: "What can I buy?", state: "done" }] },
		answer("Here is one."),
	]);
	console.log("USER_BLOCK", JSON.stringify(html.match(/<div class="agent-user">/g)));
	expect(html).toContain('<div class="agent-user">');
	// Exactly one: the reply is not wrapped.
	expect(html.match(/agent-user/g)).toHaveLength(1);
});

/* ------------------------------------------------------------------ *
 * D-2: the market this panel sends, after a market-to-market move
 * ------------------------------------------------------------------ */

/**
 * What the transport would POST right now.
 *
 * `prepareSendMessagesRequest` is the component's own closure, so this asks the
 * REAL thing the route would receive rather than re-deriving it.
 */
async function requestBody(): Promise<Record<string, unknown>> {
	const transport = captured.transport;
	if (transport?.prepareSendMessagesRequest === undefined) throw new Error("no transport captured");
	const prepared = (await transport.prepareSendMessagesRequest({
		messages: [],
		body: undefined,
	})) as { body: Record<string, unknown> };
	return prepared.body;
}

test("D-2: a market-to-market move changes the market the panel SENDS", async () => {
	resetTradeMocks();
	replies.connection = { address: "0x00000000000000000000000000000000000000ab", isConnected: true, chainId: 8453 };
	chat.messages = [];
	chat.status = "ready";
	captured.transport = null;

	// `app/m/[asset]/page.tsx` renders this panel with no `key`, and
	// `components/market/right-tabs.tsx` keeps it mounted, so a client-side move
	// from /m/eth to /m/btc changes the prop WITHOUT a remount. `setProps` is
	// exactly that: every hook slot survives.
	const h = mount(AgentChat as never, { asset: "eth", variant: "panel" });
	const afterEth = await requestBody();
	h.setProps({ asset: "btc", variant: "panel" });
	const afterBtc = await requestBody();
	console.log("BODY_AFTER_ETH", JSON.stringify(afterEth));
	console.log("BODY_AFTER_BTC", JSON.stringify(afterBtc));

	expect(afterEth.asset).toBe("eth");
	// The value is not cosmetic: `app/api/agent/chat/route.ts` puts it in the
	// system prompt and hands it to `createReadTools({ asset })`.
	expect(afterBtc.asset).toBe("btc");
	// The wallet still rides along, so the fix did not cost the address ref.
	expect(afterBtc.walletAddress).toBe("0x00000000000000000000000000000000000000ab");
	h.unmount();
	resetTradeMocks();
	signedOut();
});

test("D-2: the thesis the panel sends still follows its own prop", async () => {
	resetTradeMocks();
	chat.messages = [];
	chat.status = "ready";
	captured.transport = null;
	const first = "11111111-2222-3333-4444-555555555555";
	const second = "66666666-7777-8888-9999-aaaaaaaaaaaa";
	const h = mount(AgentChat as never, { thesisId: first, variant: "panel" });
	const before = await requestBody();
	h.setProps({ thesisId: second, variant: "panel" });
	const after = await requestBody();
	console.log("THESIS_BODIES", JSON.stringify({ before: before.thesisId, after: after.thesisId }));
	expect(before.thesisId).toBe(first);
	expect(after.thesisId).toBe(second);
	h.unmount();
	resetTradeMocks();
	signedOut();
});

/* ------------------------------------------------------------------ *
 * T-1 (Opus user-flow tester): what the model is told when a card is cancelled
 * ------------------------------------------------------------------ */

/**
 * The approval card element the chat rendered, whatever component it is.
 *
 * `@/test/hook-runner` does not descend into nested function components, so the
 * card itself is not rendered — its PROPS are, which is exactly the boundary
 * this test is about: what the chat hands the card's `onRespond`.
 */
function approvalCard(h: ReturnType<typeof mount>): { onRespond: (approved: boolean) => void } {
	const found = h.find((element) => typeof element.type === "function" && "onRespond" in element.props);
	const card = found[0];
	if (card === undefined) throw new Error("no approval card rendered");
	return card.props as unknown as { onRespond: (approved: boolean) => void };
}

const awaitingPart = (type: string): Message => ({
	id: "m1",
	role: "assistant",
	parts: [{ type, state: "approval-requested", ...({ approval: { id: "a1" }, input: {} } as object) } as Part],
});

test("T-1: cancelling a card tells the model a PERSON declined it", () => {
	// Without a reason the SDK sends the model only "Tool call execution denied."
	// (`ai@7.0.92` dist/index.js:11733 — `approval.reason` or that fallback), and
	// the model then invented an explanation: "the tool refused, likely because
	// the order on the book has nearly expired".
	for (const type of [
		"tool-requestOptionBookExecution",
		"tool-requestRfqCreation",
		"tool-requestRfqCancellation",
		"tool-requestRfqSettlement",
	]) {
		resetTradeMocks();
		signedOut();
		captured.approvals = [];
		chat.messages = [awaitingPart(type)];
		chat.status = "ready";
		const h = mount(AgentChat as never, { variant: "panel" });
		approvalCard(h).onRespond(false);
		console.log("DECLINED", type, JSON.stringify(captured.approvals));
		expect(captured.approvals.length, type).toBe(1);
		expect(captured.approvals[0]?.approved, type).toBe(false);
		expect(String(captured.approvals[0]?.reason ?? ""), type).toContain("Cancel");
		h.unmount();
	}
});

test("T-1: approving a card carries no decline reason", () => {
	resetTradeMocks();
	signedOut();
	captured.approvals = [];
	chat.messages = [awaitingPart("tool-requestOptionBookExecution")];
	chat.status = "ready";
	const h = mount(AgentChat as never, { variant: "panel" });
	approvalCard(h).onRespond(true);
	console.log("APPROVED", JSON.stringify(captured.approvals));
	expect(captured.approvals[0]?.approved).toBe(true);
	expect(captured.approvals[0]?.reason).toBeUndefined();
	h.unmount();
	resetTradeMocks();
	signedOut();
});
