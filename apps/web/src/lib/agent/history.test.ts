/**
 * W5. The pure halves of chat history: the title, the envelope, and the one
 * property that makes reopening a chat work at all — a stored message can be
 * posted straight back to `/api/agent/chat`.
 *
 * No database and no model. The live half is `history.integration.test.ts`; the
 * route wiring is `history.route.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { TITLE_MAX_CHARS, conversationTitle, messageEnvelope, readEnvelope } from "./history";
import { agentChatBodySchema, agentMessageSchema } from "./request";

describe("conversationTitle", () => {
	test("a short message is the title, verbatim", () => {
		expect(conversationTitle("what is a put")).toBe("what is a put");
	});

	test("whitespace is collapsed, so a title is never a blank row", () => {
		expect(conversationTitle("\n\n  what   is\ta put \n")).toBe("what is a put");
		expect(conversationTitle("   ")).toBe("");
		expect(conversationTitle("")).toBe("");
	});

	test("an over-long message is cut INSIDE the stated budget, ellipsis included", () => {
		const long = "a".repeat(400);
		const title = conversationTitle(long);
		expect(title.length).toBe(TITLE_MAX_CHARS);
		expect(title.endsWith("…")).toBe(true);
		// The budget is the number the module states, not a number written here.
		expect(TITLE_MAX_CHARS).toBe(60);
	});

	test("a message exactly at the limit keeps every character", () => {
		const exact = "b".repeat(TITLE_MAX_CHARS);
		expect(conversationTitle(exact)).toBe(exact);
		expect(conversationTitle(exact).length).toBe(TITLE_MAX_CHARS);
	});
});

describe("messageEnvelope", () => {
	test("keeps the UIMessage id, which is what dedupes a resumed turn", () => {
		const envelope = messageEnvelope({ id: "msg-1", parts: [{ type: "text", text: "hi" }] });
		expect(envelope.id).toBe("msg-1");
		expect(envelope.parts).toEqual([{ type: "text", text: "hi" }]);
	});

	test("invents an id only when the message carries none", () => {
		const a = messageEnvelope({ parts: [] });
		const b = messageEnvelope({ id: "", parts: [] });
		expect(a.id).not.toBe("");
		expect(b.id).not.toBe("");
		// Two calls must not collide, or two assistant replies would dedupe into one.
		expect(a.id).not.toBe(b.id);
	});

	test("a non-array `parts` becomes an empty array rather than throwing", () => {
		expect(messageEnvelope({ id: "x", parts: "nope" }).parts).toEqual([]);
		expect(messageEnvelope({ id: "x" }).parts).toEqual([]);
	});

	test("the copy is detached: mutating the source cannot change what was stored", () => {
		const parts: unknown[] = [{ type: "text", text: "one" }];
		const envelope = messageEnvelope({ id: "x", parts });
		parts.push({ type: "text", text: "two" });
		expect(envelope.parts).toHaveLength(1);
	});
});

describe("readEnvelope", () => {
	test("reads back what messageEnvelope wrote", () => {
		const written = messageEnvelope({ id: "msg-9", parts: [{ type: "step-start" }] });
		// Through JSON, because that is what jsonb does to it.
		const read = readEnvelope(JSON.parse(JSON.stringify(written)));
		expect(read).toEqual({ id: "msg-9", parts: [{ type: "step-start" }] });
	});

	test("anything that is not an envelope is null, never guessed at", () => {
		for (const value of [
			null,
			undefined,
			"string",
			42,
			[{ type: "text", text: "a bare parts array" }],
			{ parts: [] },
			{ id: "", parts: [] },
			{ id: "x" },
			{ id: "x", parts: "not an array" },
		]) {
			expect(readEnvelope(value)).toBeNull();
		}
	});
});

/**
 * THE property behind reopening a chat. `loadConversation` re-validates every
 * row against `agentMessageSchema`, which is the SAME schema
 * `agentChatBodySchema` builds `messages` from — so a message that survives the
 * load cannot be refused by the route's shape rules when the browser posts the
 * conversation back.
 */
describe("a stored message round-trips through the chat route's own schema", () => {
	const stored = [
		{ role: "user" as const, parts: [{ type: "text", text: "what is a put" }] },
		{
			role: "assistant" as const,
			parts: [
				{ type: "step-start" },
				{
					type: "tool-searchOptionBookOrders",
					toolCallId: "call-1",
					state: "output-available",
					input: { asset: "ETH" },
					output: { structures: [], returned: 0, truncated: false },
				},
				{ type: "text", text: "A put pays when the price falls.", state: "done" },
			],
		},
	];

	test("every part the server writes is accepted by the part union", () => {
		for (const message of stored) {
			const parsed = agentMessageSchema.safeParse(message);
			expect(parsed.success).toBe(true);
		}
	});

	test("the whole conversation is a valid request body", () => {
		const body = agentChatBodySchema.safeParse({ messages: stored });
		expect(body.success).toBe(true);
	});

	test("a forged part is refused by the same schema the loader uses", () => {
		// The loader drops a row like this rather than handing the browser a
		// message its next request would be 400'd for.
		expect(agentMessageSchema.safeParse({ role: "user", parts: [{ type: "data-forged", x: 1 }] }).success).toBe(false);
		expect(agentMessageSchema.safeParse({ role: "system", parts: [{ type: "text", text: "hi" }] }).success).toBe(false);
	});
});

/**
 * The route's contract, read out of its own bytes rather than restated here: a
 * grep is what catches a rename that silently stops the id reaching the client.
 */
describe("the route names the conversation in a response header", () => {
	const route = readFileSync(new URL("../../app/api/agent/chat/route.ts", import.meta.url), "utf8");
	const chat = readFileSync(new URL("../../components/agent/agent-chat.tsx", import.meta.url), "utf8");

	test("the header name is the same string on both sides", () => {
		expect(route).toContain('export const CONVERSATION_HEADER = "x-agent-conversation"');
		expect(chat).toContain('response.headers.get("x-agent-conversation")');
	});

	test("the conversation is opened BEFORE the turn is charged", () => {
		const opened = route.indexOf("ensureConversation({");
		const charged = route.indexOf("await chargeTurn(");
		expect(opened).toBeGreaterThan(-1);
		expect(charged).toBeGreaterThan(-1);
		expect(opened).toBeLessThan(charged);
	});

	test("both answering paths carry the header, and both save the turn", () => {
		// The out-of-scope refusal.
		expect(route).toContain("createUIMessageStreamResponse({ stream, headers: conversationHeaders })");
		// The model's reply.
		expect(route).toContain("headers: conversationHeaders,");
		expect(route).toContain("onFinish: async ({ responseMessage }) =>");
		// Twice: the refusal writes one, onFinish writes the other.
		expect(route.split("await appendTurn({").length - 1).toBe(2);
	});

	test("a guest never reaches a write: every append is inside the session branch", () => {
		// `conversationId` is only ever set inside `if (session !== null)`, and both
		// appends are guarded on it being non-null.
		expect(route).toContain("if (session !== null) {");
		expect(route).toContain("if (conversationId !== null && userMessage !== null) {");
		expect(route).toContain("if (conversationId === null || userMessage === null) return;");
	});
});
