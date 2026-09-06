import "server-only";

/**
 * W5. Chat history for a signed-in wallet.
 *
 * Owner ask 2026-09-06 15:0x, verbatim: "can you add in like history for the ai
 * agent for every session ?"
 *
 * Scope: every chat a SIGNED-IN wallet has with the agent is saved and can be
 * reopened. Guests stay ephemeral — PRD 10.2, verbatim: "Guest users receive
 * ephemeral discovery only. Wallet authentication is required for persistence."
 * Nothing here is ever called without a session; `route.ts` decides that, and
 * `history.integration.test.ts` asserts a guest turn writes no row at all.
 *
 * The two tables have existed unused since migration `0000_agent_tables`
 * (`packages/db/src/schema/agent.ts`), so this slice adds NO migration:
 *
 *   agent_conversations { id, wallet_address, thesis_id, title, created_at, updated_at }
 *   agent_messages      { id, conversation_id, role, parts, scope_allowed, scope_reason, created_at }
 *
 * WHAT `parts` HOLDS, and why it is not the bare parts array. A resumed
 * approval turn re-sends the same user message (the client's `useChat` posts
 * its whole `messages` array again), so an append has to be idempotent per
 * message. There is no unique index to lean on and this slice may not add a
 * migration, so the UIMessage's own id is stored INSIDE the jsonb envelope:
 *
 *   { "id": "<UIMessage id>", "parts": [ …the parts… ] }
 *
 * and the dedupe check is `parts->>'id'`. Stated rather than implied: this is a
 * read-then-write, so two genuinely concurrent appends of the same message id
 * could both miss. TODO-OWNER: a unique index on
 * `(conversation_id, (parts->>'id'))` would close that, and needs a migration.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "@nuts/db";
import { agentConversations, agentMessages } from "@nuts/db/schema/index";

import { agentMessageSchema } from "./request";

/** The database handle a caller may substitute. Only the tests do. */
type Database = typeof db;

/**
 * TODO-OWNER: how long a conversation's title may be. 60 characters is this
 * file's choice, not the owner's — it is roughly one line of the history rail
 * at the page's own font size.
 */
export const TITLE_MAX_CHARS = 60;

/**
 * TODO-OWNER: how many past conversations the history rail lists. 20 is this
 * file's choice, not the owner's, and there is no "load more" in this slice.
 */
export const CONVERSATION_LIST_LIMIT = 20;

/** A message as it is stored, and as `loadConversation` hands it back. */
export interface StoredMessage {
	readonly id: string;
	readonly role: "user" | "assistant";
	readonly parts: readonly unknown[];
}

export interface ConversationSummary {
	readonly id: string;
	readonly title: string | null;
	readonly thesisId: string | null;
	readonly updatedAt: Date;
}

export type EnsureConversation =
	| { readonly status: "ok"; readonly id: string }
	/**
	 * The id names a conversation this wallet does not own, or names nothing at
	 * all. Both answer the same way ON PURPOSE: telling the two apart would say
	 * whether a given uuid exists, and neither is ever adopted.
	 */
	| { readonly status: "not-yours" }
	/** The database could not be reached. History is a convenience, not a fence. */
	| { readonly status: "unavailable"; readonly error: unknown };

/**
 * The title a new conversation gets: the person's first message, trimmed.
 *
 * Whitespace is collapsed first — a message that begins with a newline would
 * otherwise produce a title that renders as an empty row — and an over-long
 * title is cut at `TITLE_MAX_CHARS` with a single ellipsis INSIDE that budget,
 * so the stored string is never longer than the number this file states.
 * Returns null for a message with no text at all, which the rail then renders
 * with its own fallback rather than an empty link.
 */
export function conversationTitle(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= TITLE_MAX_CHARS) return collapsed;
	return `${collapsed.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * The envelope written into `agent_messages.parts`.
 *
 * The generated fallback is NOT decoration. MEASURED on the installed SDK — a
 * real `streamText(...).toUIMessageStreamResponse({ onFinish })` against
 * `MockLanguageModelV3`:
 *
 *   {"header":"abc","contentType":"text/event-stream",
 *    "seen":{"id":"","keys":["isAborted","isContinuation","outcome",
 *            "responseMessage","messages","finishReason"],
 *            "parts":["step-start","text"]}}
 *
 * `responseMessage.id` is the EMPTY STRING when the route passes neither
 * `originalMessages` nor `generateMessageId` (`ai@7.0.92` dist/index.js:8038 →
 * :7596, `messageId != null ? messageId : ""`). Without the fallback every
 * assistant row in a conversation would carry the same id and the dedupe below
 * would collapse them into one. The USER message's id is the client's own and
 * is stable across a resumed approval turn, which is what dedupe is for.
 */
export function messageEnvelope(message: {
	readonly id?: unknown;
	readonly parts?: unknown;
}): { readonly id: string; readonly parts: unknown[] } {
	const id = typeof message.id === "string" && message.id !== "" ? message.id : randomUUID();
	return { id, parts: Array.isArray(message.parts) ? [...message.parts] : [] };
}

/**
 * The envelope read back out, or null when the row does not hold one.
 *
 * A row written by something other than `appendTurn` — or by an older shape —
 * is dropped rather than guessed at: a half-understood part reaching the client
 * would be posted straight back to `/api/agent/chat`, which refuses anything
 * outside its closed part union, and the person would see a 400 on a
 * conversation they only opened.
 */
export function readEnvelope(value: unknown): { readonly id: string; readonly parts: unknown[] } | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as { id?: unknown; parts?: unknown };
	if (typeof record.id !== "string" || record.id === "") return null;
	if (!Array.isArray(record.parts)) return null;
	return { id: record.id, parts: record.parts };
}

/**
 * Creates the conversation on the first turn, or checks that an existing id
 * belongs to this wallet.
 *
 * NEVER adopts: an id whose row is missing, or whose `wallet_address` is not
 * this session's, is `not-yours` and the route refuses the request. The wallet
 * is compared lowercase, which is how `users.wallet_address` and the session
 * cookie both hold it (`lib/auth/session.ts` lowercases on write).
 */
export async function ensureConversation(
	input: {
		readonly walletAddress: string;
		readonly conversationId: string | null;
		readonly thesisId: string | null;
		readonly firstUserText: string;
	},
	database: Database = db,
): Promise<EnsureConversation> {
	const wallet = input.walletAddress.toLowerCase();
	try {
		if (input.conversationId !== null) {
			const rows = await database
				.select({ walletAddress: agentConversations.walletAddress })
				.from(agentConversations)
				.where(eq(agentConversations.id, input.conversationId))
				.limit(1);
			const owner = rows[0]?.walletAddress;
			if (typeof owner !== "string" || owner.toLowerCase() !== wallet) return { status: "not-yours" };
			return { status: "ok", id: input.conversationId };
		}
		const title = conversationTitle(input.firstUserText);
		const created = await database
			.insert(agentConversations)
			.values({
				walletAddress: wallet,
				thesisId: input.thesisId,
				title: title === "" ? null : title,
			})
			.returning({ id: agentConversations.id });
		const id = created[0]?.id;
		if (typeof id !== "string") return { status: "unavailable", error: new Error("no conversation id returned") };
		return { status: "ok", id };
	} catch (error) {
		console.error("[agent/history] could not open a conversation:", error);
		return { status: "unavailable", error };
	}
}

/**
 * Writes one turn: the person's message and the reply the SERVER produced.
 *
 * Never throws. History is a convenience — a failure here must not break a
 * stream the person is already reading — so a database error is logged and
 * `false` comes back. The caller's own tests assert both halves.
 *
 * The assistant row is the message the server sent, not one the browser echoed:
 * `route.ts` takes it from `toUIMessageStreamResponse`'s `onFinish`
 * (`responseMessage`, measured at `ai@7.0.92` dist/index.js:7627).
 */
export async function appendTurn(
	input: {
		readonly conversationId: string;
		readonly userMessage: { readonly id?: unknown; readonly parts?: unknown };
		readonly assistantMessage: { readonly id?: unknown; readonly parts?: unknown };
		readonly scope?: { readonly allowed: boolean; readonly reason?: string | null };
	},
	database: Database = db,
): Promise<boolean> {
	try {
		const user = messageEnvelope(input.userMessage);
		const assistant = messageEnvelope(input.assistantMessage);
		await insertOnce(database, input.conversationId, "user", user, input.scope ?? null);
		await insertOnce(database, input.conversationId, "assistant", assistant, null);
		await database
			.update(agentConversations)
			.set({ updatedAt: new Date() })
			.where(eq(agentConversations.id, input.conversationId));
		return true;
	} catch (error) {
		console.error("[agent/history] could not append a turn:", error);
		return false;
	}
}

/** Inserts the message unless this conversation already holds that message id. */
async function insertOnce(
	database: Database,
	conversationId: string,
	role: "user" | "assistant",
	envelope: { readonly id: string; readonly parts: unknown[] },
	scope: { readonly allowed: boolean; readonly reason?: string | null } | null,
): Promise<void> {
	const existing = await database
		.select({ id: agentMessages.id })
		.from(agentMessages)
		.where(
			and(
				eq(agentMessages.conversationId, conversationId),
				sql`${agentMessages.parts}->>'id' = ${envelope.id}`,
			),
		)
		.limit(1);
	if (existing.length > 0) return;
	await database.insert(agentMessages).values({
		conversationId,
		role,
		parts: envelope,
		scopeAllowed: scope === null ? null : scope.allowed,
		scopeReason: scope?.reason ?? null,
	});
}

/** This wallet's conversations, newest activity first. */
export async function listConversations(
	walletAddress: string,
	limit: number = CONVERSATION_LIST_LIMIT,
	database: Database = db,
): Promise<ConversationSummary[]> {
	try {
		const rows = await database
			.select({
				id: agentConversations.id,
				title: agentConversations.title,
				thesisId: agentConversations.thesisId,
				updatedAt: agentConversations.updatedAt,
			})
			.from(agentConversations)
			.where(eq(agentConversations.walletAddress, walletAddress.toLowerCase()))
			.orderBy(desc(agentConversations.updatedAt))
			.limit(limit);
		return rows;
	} catch (error) {
		console.error("[agent/history] could not list conversations:", error);
		return [];
	}
}

/**
 * One conversation's messages, or null when it is not this wallet's.
 *
 * ORDER. `created_at` is the only clock these rows carry, and two statements
 * can land on the same microsecond, so the tie is broken by role: within one
 * timestamp the person's message comes before the reply to it. That is the only
 * pairing this table can ever hold, because `appendTurn` writes exactly one of
 * each.
 *
 * Every row is re-validated against the SAME part union `/api/agent/chat`
 * accepts (`agentMessageSchema`), so a reopened conversation can be posted back
 * unchanged. A row that fails is dropped and logged rather than returned: the
 * alternative is a 400 on a conversation the person only opened.
 */
export async function loadConversation(
	walletAddress: string,
	conversationId: string,
	database: Database = db,
): Promise<StoredMessage[] | null> {
	try {
		const owner = await database
			.select({ walletAddress: agentConversations.walletAddress })
			.from(agentConversations)
			.where(eq(agentConversations.id, conversationId))
			.limit(1);
		const address = owner[0]?.walletAddress;
		if (typeof address !== "string" || address.toLowerCase() !== walletAddress.toLowerCase()) return null;

		const rows = await database
			.select({ role: agentMessages.role, parts: agentMessages.parts })
			.from(agentMessages)
			.where(eq(agentMessages.conversationId, conversationId))
			.orderBy(
				asc(agentMessages.createdAt),
				asc(sql`case when ${agentMessages.role} = 'user' then 0 else 1 end`),
			);

		const messages: StoredMessage[] = [];
		for (const row of rows) {
			// `system` is not a role this app's chat ever produces, and the route
			// refuses one from a client; a stored one would be dropped here too.
			if (row.role !== "user" && row.role !== "assistant") continue;
			const envelope = readEnvelope(row.parts);
			if (envelope === null) {
				console.warn("[agent/history] dropped a message row with no envelope");
				continue;
			}
			const parsed = agentMessageSchema.safeParse({ role: row.role, parts: envelope.parts });
			if (!parsed.success) {
				console.warn("[agent/history] dropped a message row the chat schema refuses");
				continue;
			}
			messages.push({ id: envelope.id, role: row.role, parts: envelope.parts });
		}
		return messages;
	} catch (error) {
		console.error("[agent/history] could not load a conversation:", error);
		return null;
	}
}
