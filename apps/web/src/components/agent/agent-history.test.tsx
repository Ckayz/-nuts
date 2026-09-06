/**
 * W5. The saved-chat rail: what a signed-out visitor sees, what a signed-in
 * wallet sees, and that a link never carries anything but its own id.
 *
 * `renderToStaticMarkup`, the same harness `agent-heading.test.tsx` and
 * `agent-suggest.test.tsx` use. The component is presentational — no session, no
 * database, no fetch — so nothing has to be mocked.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

const { AgentHistory, HISTORY_COPY, shortAgo } = await import("./agent-history");
const { chatRequestBody, readConversationHeader } = await import("./agent-chat");
const { agentChatBodySchema } = await import("@/lib/agent/request");

const NOW = new Date("2026-09-06T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("shortAgo", () => {
	test("the shortest honest unit, at each boundary", () => {
		expect(shortAgo(NOW, NOW)).toBe("now");
		expect(shortAgo(ago(0.5), NOW)).toBe("now");
		expect(shortAgo(ago(1), NOW)).toBe("1m");
		expect(shortAgo(ago(59), NOW)).toBe("59m");
		expect(shortAgo(ago(60), NOW)).toBe("1h");
		expect(shortAgo(ago(60 * 23), NOW)).toBe("23h");
		expect(shortAgo(ago(60 * 24), NOW)).toBe("1d");
		expect(shortAgo(ago(60 * 24 * 9), NOW)).toBe("9d");
	});

	test("a clock skew that puts the row in the future reads `now`, never a negative", () => {
		expect(shortAgo(new Date(NOW.getTime() + 60_000), NOW)).toBe("now");
	});
});

describe("AgentHistory", () => {
	const conversations = [
		{ id: "11111111-1111-4111-8111-111111111111", title: "what is a put", updatedAt: ago(5) },
		{ id: "22222222-2222-4222-8222-222222222222", title: null, updatedAt: ago(60 * 30) },
	];

	test("a signed-out visitor is told what signing in buys, and gets no links", () => {
		const html = renderToStaticMarkup(<AgentHistory conversations={[]} signedIn={false} now={NOW} />);
		expect(html).toContain(HISTORY_COPY.signedOut);
		// No "New chat", no conversation links: there is nothing to save into.
		expect(html).not.toContain("href=");
	});

	test("a signed-in wallet gets New chat first, then its own chats newest-first", () => {
		const html = renderToStaticMarkup(<AgentHistory conversations={conversations} signedIn now={NOW} />);
		expect(html).toContain(">New chat<");
		expect(html).toContain('href="/agent"');
		expect(html).toContain(`href="/agent?c=${conversations[0]?.id}"`);
		expect(html).toContain(`href="/agent?c=${conversations[1]?.id}"`);
		// New chat is first in the DOM, so it is the first thing tabbed to.
		expect(html.indexOf(">New chat<")).toBeLessThan(html.indexOf("what is a put"));
		// The title, and the fallback for a conversation that never got one.
		expect(html).toContain("what is a put");
		expect(html).toContain(HISTORY_COPY.untitled);
		// The relative labels, computed from the injected clock.
		expect(html).toContain(">5m<");
		expect(html).toContain(">1d<");
	});

	test("the open conversation is marked, and only that one", () => {
		const html = renderToStaticMarkup(
			<AgentHistory conversations={conversations} activeId={conversations[1]?.id ?? null} signedIn now={NOW} />,
		);
		expect(html.match(/aria-current="page"/g)?.length ?? 0).toBe(1);
		// It is the SECOND chip that carries it: the marker sits inside the anchor
		// whose href is that id, and after the first chip has already been written.
		const marked = html.indexOf('aria-current="page"');
		expect(marked).toBeGreaterThan(html.indexOf(conversations[0]?.id ?? ""));
		expect(html.slice(marked, marked + 200)).toContain(`/agent?c=${conversations[1]?.id}`);
		expect(html.slice(marked, marked + 200)).not.toContain(conversations[0]?.id ?? "");
	});

	test("a signed-in wallet with no chats still gets New chat, plus the empty sentence", () => {
		const html = renderToStaticMarkup(<AgentHistory conversations={[]} signedIn now={NOW} />);
		expect(html).toContain('href="/agent"');
		expect(html).toContain(HISTORY_COPY.empty);
	});

	test("a link is the id and nothing else: no wallet, no title, in the URL", () => {
		const html = renderToStaticMarkup(<AgentHistory conversations={conversations} signedIn now={NOW} />);
		const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
		expect(hrefs).toEqual([
			"/agent",
			`/agent?c=${conversations[0]?.id}`,
			`/agent?c=${conversations[1]?.id}`,
		]);
	});

	test("the accent is not used here: chips only, no accent class", () => {
		const html = renderToStaticMarkup(<AgentHistory conversations={conversations} signedIn now={NOW} />);
		expect(html).toContain('class="pills"');
		expect(html).toContain('class="pill"');
		expect(html).not.toContain("accent");
	});
});

/**
 * How the conversation id gets from the server to the browser and back.
 *
 * MEASURED at `ai@7.0.92`: `HttpChatTransport.sendMessages` keeps only
 * `response.body` (dist/index.js:18681), so the `Response` never reaches
 * `useChat` — the transport's `fetch` option is the one seam, and
 * `readConversationHeader` is what runs inside it. A real `Response` is used
 * here, not a hand-written headers object, so the casing and trimming rules are
 * the platform's.
 */
describe("readConversationHeader", () => {
	const id = "11111111-1111-4111-8111-111111111111";
	const withHeader = (value: string) => new Response("", { headers: { "x-agent-conversation": value } });

	test("reads the id the server named, whatever the header's case", () => {
		expect(readConversationHeader(withHeader(id))).toBe(id);
		// Header names are case-insensitive; the VALUE is lowercased by us.
		expect(readConversationHeader(new Response("", { headers: { "X-Agent-Conversation": id.toUpperCase() } }))).toBe(id);
		expect(readConversationHeader(withHeader(` ${id} `))).toBe(id);
	});

	test("a reply that names nothing leaves the chat unsaved rather than guessing", () => {
		expect(readConversationHeader(new Response(""))).toBeNull();
	});

	test("anything the route's schema would refuse is dropped here", () => {
		for (const bad of ["", "not-a-uuid", `${id}x`, "../../etc/passwd", "1 OR 1=1", `${id},${id}`]) {
			expect(readConversationHeader(withHeader(bad)), bad).toBeNull();
		}
	});
});

describe("chatRequestBody carries the conversation id back", () => {
	const id = "22222222-2222-4222-8222-222222222222";

	test("the id is sent when there is one", () => {
		const body = chatRequestBody({
			messages: [],
			body: undefined,
			walletAddress: "0xabc",
			thesisId: null,
			conversationId: id,
		});
		expect(body.conversationId).toBe(id);
	});

	test("a new chat sends no `conversationId` key at all (the schema marks it optional)", () => {
		for (const conversationId of [null, undefined]) {
			const body = chatRequestBody({ messages: [], body: undefined, walletAddress: "0xabc", thesisId: null, conversationId });
			expect("conversationId" in body).toBe(false);
		}
		// And the existing callers, which pass nothing at all, are unchanged.
		const legacy = chatRequestBody({ messages: [], body: undefined, walletAddress: "0xabc", thesisId: null });
		expect("conversationId" in legacy).toBe(false);
	});

	test("the route's own schema accepts that body, and refuses a malformed id", () => {
		const messages = [{ role: "user", parts: [{ type: "text", text: "hi" }] }];
		expect(agentChatBodySchema.safeParse({ messages, conversationId: id }).success).toBe(true);
		expect(agentChatBodySchema.safeParse({ messages, conversationId: "not-a-uuid" }).success).toBe(false);
		expect(agentChatBodySchema.safeParse({ messages, conversationId: "" }).success).toBe(false);
	});
});
