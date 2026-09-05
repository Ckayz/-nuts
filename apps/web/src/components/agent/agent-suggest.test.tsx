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

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

type Part = { type: string; text?: string; state?: string; output?: unknown };
type Message = { id: string; role: "user" | "assistant"; parts: Part[] };

/** What the mocked `useChat` will hand back on the next render. */
const chat: { messages: Message[]; status: string } = { messages: [], status: "ready" };

mock.module("@ai-sdk/react", () => ({
	useChat: () => ({
		messages: chat.messages,
		sendMessage: () => {},
		status: chat.status,
		error: undefined,
		addToolApprovalResponse: () => {},
	}),
}));

const { config } = await import("@/lib/wagmi");
const { AgentChat, SuggestionRow } = await import("./agent-chat");
const { postFillSuggestions, starterSuggestions } = await import("@/lib/agent/suggestions");

function render(messages: Message[], props: { asset?: string | null } = {}, status = "ready"): string {
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
