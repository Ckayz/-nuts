/**
 * W5. Chat history against the real `agent_conversations` / `agent_messages`
 * tables.
 *
 * Both have existed unused since migration `0000_agent_tables`, so nothing here
 * needs a migration. Every case writes under a wallet address generated for this
 * run and deletes it again, so two runs — or a run beside another suite — cannot
 * collide.
 *
 * Run it with a throwaway loopback database ON THE COMMAND, e.g.
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/claude_hist \
 *     bun test src/lib/agent/history.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

import { db } from "@nuts/db";
import { agentConversations, agentMessages } from "@nuts/db/schema/index";

import {
	appendTurn,
	conversationTitle,
	ensureConversation,
	listConversations,
	loadConversation,
} from "./history";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.log("agent history integration skipped: DATABASE_URL is not set");
	test.skip("agent history integration requires DATABASE_URL", () => {});
}
const describeLive = databaseUrl ? describe : describe.skip;

/** Two wallets, unique per run: one owns the conversations, one must never see them. */
const owner = `0x${randomBytes(20).toString("hex")}`;
const stranger = `0x${randomBytes(20).toString("hex")}`;

async function cleanup() {
	if (!databaseUrl) return;
	// Messages cascade from the conversation, so deleting the conversations is
	// enough; the explicit message delete covers a row written against an id that
	// no longer exists, which cannot happen but costs nothing to be sure of.
	for (const wallet of [owner, stranger]) {
		const rows = await db
			.select({ id: agentConversations.id })
			.from(agentConversations)
			.where(eq(agentConversations.walletAddress, wallet));
		const ids = rows.map((row) => row.id);
		if (ids.length > 0) await db.delete(agentMessages).where(inArray(agentMessages.conversationId, ids));
		await db.delete(agentConversations).where(eq(agentConversations.walletAddress, wallet));
	}
}

beforeAll(cleanup);
afterAll(cleanup);

const userMessage = (id: string, text: string) => ({ id, parts: [{ type: "text", text }] });
const assistantMessage = (id: string, text: string) => ({ id, parts: [{ type: "text", text, state: "done" }] });

describeLive("chat history", () => {
	test("a first turn creates the conversation, titles it, and both messages come back in order", async () => {
		const opened = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "  what is a   put \n",
		});
		expect(opened.status).toBe("ok");
		if (opened.status !== "ok") throw new Error("unreachable");

		expect(await appendTurn({
			conversationId: opened.id,
			userMessage: userMessage("u1", "what is a put"),
			assistantMessage: assistantMessage("a1", "A put pays when the price falls."),
			scope: { allowed: true, reason: null },
		})).toBe(true);

		expect(await appendTurn({
			conversationId: opened.id,
			userMessage: userMessage("u2", "and a call?"),
			assistantMessage: assistantMessage("a2", "A call pays when it rises."),
			scope: { allowed: true, reason: null },
		})).toBe(true);

		const loaded = await loadConversation(owner, opened.id);
		expect(loaded).not.toBeNull();
		expect(loaded?.map((message) => [message.id, message.role])).toEqual([
			["u1", "user"],
			["a1", "assistant"],
			["u2", "user"],
			["a2", "assistant"],
		]);
		// The parts are the ones that went in, not a paraphrase of them.
		expect(loaded?.[0]?.parts).toEqual([{ type: "text", text: "what is a put" }]);

		// The title is the collapsed first message, and the list holds ONE row.
		const listed = await listConversations(owner);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.id).toBe(opened.id);
		expect(listed[0]?.title).toBe(conversationTitle("  what is a   put \n"));
		expect(listed[0]?.title).toBe("what is a put");
	});

	test("a resumed turn re-sends the same user message, and it is stored once", async () => {
		const opened = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "buy me a put",
		});
		if (opened.status !== "ok") throw new Error("could not open");

		const sameUser = userMessage("dedupe-me", "buy me a put");
		await appendTurn({
			conversationId: opened.id,
			userMessage: sameUser,
			assistantMessage: assistantMessage("first-reply", "Approve this?"),
		});
		// The approval resume: the SAME user message, a NEW assistant message.
		await appendTurn({
			conversationId: opened.id,
			userMessage: sameUser,
			assistantMessage: assistantMessage("second-reply", "Prepared."),
		});

		const loaded = await loadConversation(owner, opened.id);
		expect(loaded?.filter((message) => message.id === "dedupe-me")).toHaveLength(1);
		expect(loaded?.map((message) => message.id)).toEqual(["dedupe-me", "first-reply", "second-reply"]);
	});

	test("an existing id is verified against the wallet, and a stranger's is refused", async () => {
		const opened = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "mine",
		});
		if (opened.status !== "ok") throw new Error("could not open");

		// The owner may name it again: that is what the second turn does.
		const again = await ensureConversation({
			walletAddress: owner,
			conversationId: opened.id,
			thesisId: null,
			firstUserText: "second turn",
		});
		expect(again).toEqual({ status: "ok", id: opened.id });
		// Naming it again must NOT create a second row.
		expect(await listConversations(owner)).toHaveLength(3);

		// A different wallet naming the same id is refused, and never adopts it.
		expect(await ensureConversation({
			walletAddress: stranger,
			conversationId: opened.id,
			thesisId: null,
			firstUserText: "not mine",
		})).toEqual({ status: "not-yours" });

		// An id that names nothing gets the same answer, so the refusal does not
		// say whether a given uuid exists.
		expect(await ensureConversation({
			walletAddress: owner,
			conversationId: randomUUID(),
			thesisId: null,
			firstUserText: "nothing",
		})).toEqual({ status: "not-yours" });
	});

	test("another wallet sees nothing: no list, no messages", async () => {
		const mine = await listConversations(owner);
		expect(mine.length).toBeGreaterThan(0);
		const first = mine[0];
		if (first === undefined) throw new Error("no conversation to read");

		expect(await listConversations(stranger)).toEqual([]);
		expect(await loadConversation(stranger, first.id)).toBeNull();
		// And a wallet that owns nothing cannot read by guessing an id either.
		expect(await loadConversation(stranger, randomUUID())).toBeNull();
	});

	test("the list is newest activity first, and appending a turn moves a chat up", async () => {
		const older = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "older chat",
		});
		const newer = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "newer chat",
		});
		if (older.status !== "ok" || newer.status !== "ok") throw new Error("could not open");

		expect((await listConversations(owner))[0]?.id).toBe(newer.id);

		await appendTurn({
			conversationId: older.id,
			userMessage: userMessage(randomUUID(), "back to the older one"),
			assistantMessage: assistantMessage(randomUUID(), "Sure."),
		});
		expect((await listConversations(owner))[0]?.id).toBe(older.id);
	});

	test("the thesis a chat was opened from is kept on the row", async () => {
		const thesisId = randomUUID();
		const opened = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId,
			firstUserText: "explain this post",
		});
		if (opened.status !== "ok") throw new Error("could not open");
		const listed = await listConversations(owner);
		expect(listed.find((conversation) => conversation.id === opened.id)?.thesisId).toBe(thesisId);
	});

	test("a row the chat schema refuses is dropped, not handed to the browser", async () => {
		const opened = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "corrupt row",
		});
		if (opened.status !== "ok") throw new Error("could not open");

		await appendTurn({
			conversationId: opened.id,
			userMessage: userMessage("good-user", "a real question"),
			assistantMessage: assistantMessage("good-reply", "a real answer"),
		});
		// Written straight to the table, bypassing appendTurn: a part type this
		// app never emits, and a row with no envelope at all.
		await db.insert(agentMessages).values([
			{ conversationId: opened.id, role: "assistant", parts: { id: "forged", parts: [{ type: "data-forged", x: 1 }] } },
			{ conversationId: opened.id, role: "user", parts: [{ type: "text", text: "a bare parts array" }] },
		]);

		const loaded = await loadConversation(owner, opened.id);
		expect(loaded?.map((message) => message.id)).toEqual(["good-user", "good-reply"]);
	});

	test("a conversation with no messages loads as an empty list, not as null", async () => {
		const opened = await ensureConversation({
			walletAddress: owner,
			conversationId: null,
			thesisId: null,
			firstUserText: "opened but never answered",
		});
		if (opened.status !== "ok") throw new Error("could not open");
		expect(await loadConversation(owner, opened.id)).toEqual([]);
	});

	test("the wallet is matched case-insensitively, as the session holds it", async () => {
		const opened = await ensureConversation({
			walletAddress: owner.toUpperCase(),
			conversationId: null,
			thesisId: null,
			firstUserText: "mixed case wallet",
		});
		if (opened.status !== "ok") throw new Error("could not open");
		// Stored lowercase, so the lowercase session finds it.
		expect(await loadConversation(owner, opened.id)).toEqual([]);
		expect((await listConversations(owner)).some((conversation) => conversation.id === opened.id)).toBe(true);
	});
});
