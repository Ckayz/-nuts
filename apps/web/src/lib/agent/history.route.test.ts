/// <reference types="bun" />
/**
 * W5. The chat route, driven for real, with only the provider, the session, the
 * scope gate and the write tools replaced.
 *
 * The SDK is NOT stubbed here — `streamText`, `toUIMessageStreamResponse` and
 * its `onFinish` are the installed `ai@7.0.92`, running against
 * `MockLanguageModelV3` from `ai/test`. That is the point: the two claims this
 * feature rests on are claims about the SDK, and a hand-written stub of
 * `toUIMessageStreamResponse` would prove neither.
 *
 *   1. a custom `headers` entry survives onto the streamed `Response`;
 *   2. `onFinish` receives the assistant message the SERVER assembled.
 *
 * WHY A SUBPROCESS. `mock.module` is process-wide in bun and `request.test.ts`
 * already replaces `ai`'s `streamText` for the whole run; a second, different
 * replacement in this file would silently change that file's behaviour too (see
 * the note at the top of `page-data.wiring.test.ts`). Each case therefore runs
 * in its own child with the stubs installed as bun plugins.
 *
 * ZERO model calls: the "provider" is a mock that replays a fixed stream.
 */
import { expect, test } from "bun:test";

const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? "";
const live = DATABASE_URL === "" ? test.skip : test;
if (DATABASE_URL === "") console.log("agent history route test skipped: DATABASE_URL is not set");

const TIMEOUT_MS = 60_000;

/** The reply the mock provider streams, so an assertion can name it exactly. */
const REPLY = "A put pays when the price falls.";

/**
 * Runs `body` in a child with the provider, session, gate and write tools
 * replaced and everything else — the SDK, the schema, the usage ledger, the
 * history module — real. `cwd` is `apps/web`, so `@/…` resolves through the
 * app's own tsconfig paths.
 */
function probe(body: string): Record<string, unknown> {
	const script = `
		import { plugin } from "bun";
		import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

		const REPLY = ${JSON.stringify(REPLY)};
		globalThis.__session = null;
		globalThis.__inScope = true;
		globalThis.__model = new MockLanguageModelV3({
			doStream: async () => ({
				stream: simulateReadableStream({
					chunks: [
						{ type: "stream-start", warnings: [] },
						{ type: "text-start", id: "t1" },
						{ type: "text-delta", id: "t1", delta: REPLY },
						{ type: "text-end", id: "t1" },
						{ type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
					],
				}),
			}),
		});

		plugin({ name: "history-route-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
			// The session is the ONLY thing that decides whether history is written.
			build.module("@/lib/auth/session", () => ({ exports: {
				getSession: async () => globalThis.__session,
			}, loader: "object" }));
			// The provider boundary. No network, no key, no credit.
			build.module("@/lib/agent/model", () => ({ exports: {
				agentModel: globalThis.__model, gateModel: globalThis.__model, usingGateway: false,
			}, loader: "object" }));
			// PRD 10.8 layer 1, injected so a case can choose its verdict.
			build.module("@/lib/agent/scope", () => ({ exports: {
				OUT_OF_SCOPE_REPLY: "That is outside what this agent does.",
				checkScope: async () => ({ inScope: globalThis.__inScope, degraded: false }),
			}, loader: "object" }));
			build.module("@/lib/agent/execute", () => ({ exports: { createExecutionTools: () => ({}) }, loader: "object" }));
		}});

		const { randomUUID, randomBytes } = await import("node:crypto");
		const { POST } = await import("@/app/api/agent/chat/route");
		const { db } = await import("@nuts/db");
		const { sql } = await import("drizzle-orm");

		/** A fresh guest IP per call so the real daily allowance is never shared. */
		let ip = 0;
		const post = (payload) => {
			ip += 1;
			return POST(new Request("https://thesis.fun/api/agent/chat", {
				method: "POST",
				headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113." + (ip % 250) + ":" + process.pid + ":" + Date.now() + ":" + ip },
				body: JSON.stringify(payload),
			}));
		};
		const text = (value, id) => ({ id, role: "user", parts: [{ type: "text", text: value }] });
		/** The rows a conversation holds, in the order the loader reads them. */
		const rowsFor = async (id) => {
			const result = await db.execute(sql\`
				select role, parts, scope_allowed from agent_messages
				where conversation_id = \${id}::uuid
				order by created_at asc, case when role = 'user' then 0 else 1 end\`);
			return "rows" in result ? result.rows : result;
		};
		const conversationsFor = async (wallet) => {
			const result = await db.execute(sql\`select id, title, wallet_address from agent_conversations where wallet_address = \${wallet}\`);
			return "rows" in result ? result.rows : result;
		};
		const wallet = () => "0x" + randomBytes(20).toString("hex");

		${body}
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: { ...process.env, DATA_SOURCE: "db", DATABASE_URL, DIRECT_DATABASE_URL: "" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	if (child.exitCode !== 0) throw new Error(`${child.stderr.toString()}\n${out}`);
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("RESULT:".length)) as Record<string, unknown>;
}

live(
	"a signed-in turn is saved, and the conversation id comes back in the response header",
	() => {
		const result = probe(`
			const address = wallet();
			globalThis.__session = { userId: randomUUID(), walletAddress: address, expiresAt: new Date(Date.now() + 3600_000) };

			const first = await post({ messages: [text("what is a put", "u-1")] });
			const header = first.headers.get("x-agent-conversation");
			// The stream must be DRAINED before onFinish has run.
			const firstBody = await first.text();

			const created = await conversationsFor(address);
			const rows = header === null ? [] : await rowsFor(header);

			// A second turn naming the same id must append, not create.
			const second = await post({ messages: [text("what is a put", "u-1"), { id: "a-1", role: "assistant", parts: [{ type: "text", text: REPLY }] }, text("and a call?", "u-2")], conversationId: header });
			const secondHeader = second.headers.get("x-agent-conversation");
			await second.text();
			const after = await rowsFor(header);
			const afterConversations = await conversationsFor(address);

			await db.execute(sql\`delete from agent_conversations where wallet_address = \${address}\`);
			console.log("RESULT:" + JSON.stringify({
				status: first.status,
				header,
				bodyHasReply: firstBody.includes(REPLY),
				conversations: created.length,
				title: created[0]?.title ?? null,
				walletStored: created[0]?.wallet_address ?? null,
				roles: rows.map((row) => row.role),
				userText: rows[0]?.parts?.parts?.[0]?.text ?? null,
				userMessageId: rows[0]?.parts?.id ?? null,
				assistantText: rows[1]?.parts?.parts?.map((part) => part.text).join("") ?? null,
				assistantMessageId: rows[1]?.parts?.id ?? null,
				scopeAllowed: rows[0]?.scope_allowed ?? null,
				secondHeader,
				rolesAfter: after.map((row) => row.role),
				idsAfter: after.map((row) => row.parts?.id ?? null),
				conversationsAfter: afterConversations.length,
			}));
		`);

		expect(result.status).toBe(200);
		expect(result.header).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(result.bodyHasReply).toBe(true);
		// One conversation, titled from the person's first message.
		expect(result.conversations).toBe(1);
		expect(result.title).toBe("what is a put");
		// Two rows: the question and the reply the SERVER produced.
		expect(result.roles).toEqual(["user", "assistant"]);
		expect(result.userText).toBe("what is a put");
		expect(result.userMessageId).toBe("u-1");
		expect(result.assistantText).toBe(REPLY);
		expect(result.scopeAllowed).toBe(true);
		// The second turn appends to the SAME conversation and dedupes `u-1`.
		expect(result.secondHeader).toBe(result.header);
		expect(result.conversationsAfter).toBe(1);
		expect(result.rolesAfter).toEqual(["user", "assistant", "user", "assistant"]);
		const ids = result.idsAfter as string[];
		// `u-1` is stored ONCE even though the client re-sent it, and the two
		// replies are separate rows — which is what dedupe by message id buys.
		expect(ids).toHaveLength(4);
		expect(ids[0]).toBe("u-1");
		expect(ids[1]).toBe(result.assistantMessageId as string);
		expect(ids[2]).toBe("u-2");
		expect(new Set(ids).size).toBe(4);
	},
	TIMEOUT_MS,
);

live(
	"a guest turn writes nothing at all and gets no header — even with a wallet CONNECTED",
	() => {
		// The distinction PRD 10.2 draws: "Wallet authentication is required for
		// persistence." A connected wallet is a value the BROWSER chose and sends
		// in the body on every request (`chatRequestBody` always includes it); a
		// session is the httpOnly cookie the server signed. Only the second buys
		// history, or anyone could write into any address's chats by naming it.
		const result = probe(`
			const before = await db.execute(sql\`select count(*)::int as n from agent_conversations\`);
			const beforeMessages = await db.execute(sql\`select count(*)::int as n from agent_messages\`);
			globalThis.__session = null;
			const response = await post({ messages: [text("what is a put", "g-1")], walletAddress: wallet() });
			await response.text();
			const after = await db.execute(sql\`select count(*)::int as n from agent_conversations\`);
			const afterMessages = await db.execute(sql\`select count(*)::int as n from agent_messages\`);
			const rows = (r) => ("rows" in r ? r.rows : r)[0].n;
			console.log("RESULT:" + JSON.stringify({
				status: response.status,
				header: response.headers.get("x-agent-conversation"),
				conversationsAdded: rows(after) - rows(before),
				messagesAdded: rows(afterMessages) - rows(beforeMessages),
			}));
		`);

		expect(result.status).toBe(200);
		expect(result.header).toBeNull();
		expect(result.conversationsAdded).toBe(0);
		expect(result.messagesAdded).toBe(0);
	},
	TIMEOUT_MS,
);

live(
	"another wallet's conversation id is refused before a turn is charged",
	() => {
		const result = probe(`
			const mine = wallet();
			const theirs = wallet();
			globalThis.__session = { userId: randomUUID(), walletAddress: theirs, expiresAt: new Date(Date.now() + 3600_000) };
			const opened = await post({ messages: [text("their chat", "t-1")] });
			const theirId = opened.headers.get("x-agent-conversation");
			await opened.text();

			globalThis.__session = { userId: randomUUID(), walletAddress: mine, expiresAt: new Date(Date.now() + 3600_000) };
			const { db: _db } = await import("@nuts/db");
			const beforeTurns = await db.execute(sql\`select coalesce(sum(turns),0)::int as n from agent_usage where subject = \${mine.toLowerCase()}\`);
			const refused = await post({ messages: [text("give me theirs", "m-1")], conversationId: theirId });
			const refusedBody = await refused.json();
			const afterTurns = await db.execute(sql\`select coalesce(sum(turns),0)::int as n from agent_usage where subject = \${mine.toLowerCase()}\`);
			const theirRows = await rowsFor(theirId);

			await db.execute(sql\`delete from agent_conversations where wallet_address in (\${mine}, \${theirs})\`);
			const n = (r) => ("rows" in r ? r.rows : r)[0].n;
			console.log("RESULT:" + JSON.stringify({
				status: refused.status,
				source: refusedBody.source,
				leaksExistence: JSON.stringify(refusedBody).includes(theirId),
				turnsCharged: n(afterTurns) - n(beforeTurns),
				theirRowCount: theirRows.length,
			}));
		`);

		expect(result.status).toBe(403);
		expect(result.source).toBe("agent");
		// The refusal never repeats the id back, so it cannot confirm one exists.
		expect(result.leaksExistence).toBe(false);
		// And it costs nothing: `ensureConversation` runs before `chargeTurn`.
		expect(result.turnsCharged).toBe(0);
		// Their conversation is untouched: two rows, the ones their own turn wrote.
		expect(result.theirRowCount).toBe(2);
	},
	TIMEOUT_MS,
);

live(
	"the out-of-scope refusal is saved as a turn, with the gate's verdict on the question",
	() => {
		const result = probe(`
			const address = wallet();
			globalThis.__session = { userId: randomUUID(), walletAddress: address, expiresAt: new Date(Date.now() + 3600_000) };
			globalThis.__inScope = false;
			const response = await post({ messages: [text("write me a python scraper", "o-1")] });
			const header = response.headers.get("x-agent-conversation");
			const body = await response.text();
			const rows = header === null ? [] : await rowsFor(header);
			await db.execute(sql\`delete from agent_conversations where wallet_address = \${address}\`);
			console.log("RESULT:" + JSON.stringify({
				status: response.status,
				header,
				bodyHasRefusal: body.includes("outside what this agent does"),
				roles: rows.map((row) => row.role),
				scopeAllowed: rows[0]?.scope_allowed ?? null,
				scopeAllowedOnReply: rows[1]?.scope_allowed ?? null,
				assistantText: rows[1]?.parts?.parts?.[0]?.text ?? null,
			}));
		`);

		expect(result.status).toBe(200);
		expect(result.header).toMatch(/^[0-9a-f]{8}-/);
		expect(result.bodyHasRefusal).toBe(true);
		expect(result.roles).toEqual(["user", "assistant"]);
		// PRD 10.8 layer 1's verdict belongs on the person's message.
		expect(result.scopeAllowed).toBe(false);
		expect(result.scopeAllowedOnReply).toBeNull();
		expect(result.assistantText).toBe("That is outside what this agent does.");
	},
	TIMEOUT_MS,
);

live(
	"a resumed turn — one whose last message is the assistant's — re-sends the same question, and it is stored once",
	() => {
		const result = probe(`
			const address = wallet();
			globalThis.__session = { userId: randomUUID(), walletAddress: address, expiresAt: new Date(Date.now() + 3600_000) };

			const first = await post({ messages: [text("prepare a put for me", "r-1")] });
			const id = first.headers.get("x-agent-conversation");
			await first.text();

			// The shape the runtime resumes with after an approval: the newest
			// message is the ASSISTANT's, and the person's question is further back.
			const resumed = await post({
				conversationId: id,
				messages: [
					text("prepare a put for me", "r-1"),
					{ id: "r-a1", role: "assistant", parts: [{ type: "text", text: REPLY }] },
				],
			});
			await resumed.text();

			const rows = await rowsFor(id);
			await db.execute(sql\`delete from agent_conversations where wallet_address = \${address}\`);
			console.log("RESULT:" + JSON.stringify({
				status: resumed.status,
				ids: rows.map((row) => row.parts?.id ?? null),
				roles: rows.map((row) => row.role),
				userRows: rows.filter((row) => row.role === "user").length,
			}));
		`);

		expect(result.status).toBe(200);
		// The question is stored ONCE; the two replies are separate rows.
		expect(result.userRows).toBe(1);
		expect((result.ids as string[])[0]).toBe("r-1");
		expect(result.roles).toEqual(["user", "assistant", "assistant"]);
	},
	TIMEOUT_MS,
);

/**
 * PRD 10.4 names `GET /api/agent/conversations` and `/:id`. Nothing in this app
 * calls them — `/agent` reads the same functions server-side — so they are
 * driven here directly, in the same child harness, with the SESSION stubbed and
 * everything else real.
 */
live(
	"the two read routes answer only for the session's own wallet",
	() => {
		const result = probe(`
			const mine = wallet();
			const theirs = wallet();
			const list = (await import("@/app/api/agent/conversations/route")).GET;
			const one = (await import("@/app/api/agent/conversations/[id]/route")).GET;
			const req = () => new Request("https://thesis.fun/api/agent/conversations");

			// Signed out.
			globalThis.__session = null;
			const outList = await list();
			const outOne = await one(req(), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });

			// Two wallets, one conversation each.
			globalThis.__session = { userId: randomUUID(), walletAddress: theirs, expiresAt: new Date(Date.now() + 3600_000) };
			const opened = await post({ messages: [text("their question", "x-1")] });
			const theirId = opened.headers.get("x-agent-conversation");
			await opened.text();

			globalThis.__session = { userId: randomUUID(), walletAddress: mine, expiresAt: new Date(Date.now() + 3600_000) };
			const openedMine = await post({ messages: [text("my question", "y-1")] });
			const myId = openedMine.headers.get("x-agent-conversation");
			await openedMine.text();

			const myList = await (await list()).json();
			const mineOne = await one(req(), { params: Promise.resolve({ id: myId }) });
			const mineBody = await mineOne.json();
			const theirsOne = await one(req(), { params: Promise.resolve({ id: theirId }) });
			const malformed = await one(req(), { params: Promise.resolve({ id: "not-a-uuid" }) });

			await db.execute(sql\`delete from agent_conversations where wallet_address in (\${mine}, \${theirs})\`);
			console.log("RESULT:" + JSON.stringify({
				signedOutList: outList.status,
				signedOutOne: outOne.status,
				listStatus: 200,
				listIds: myList.conversations.map((c) => c.id),
				listTitles: myList.conversations.map((c) => c.title),
				mineStatus: mineOne.status,
				mineRoles: mineBody.messages.map((m) => m.role),
				mineText: mineBody.messages[0]?.parts?.[0]?.text ?? null,
				theirsStatus: theirsOne.status,
				theirsBody: await theirsOne.json(),
				malformedStatus: malformed.status,
			}));
		`);

		expect(result.signedOutList).toBe(401);
		expect(result.signedOutOne).toBe(401);
		// The list holds this wallet's conversation and nothing else.
		expect(result.listIds).toHaveLength(1);
		expect(result.listTitles).toEqual(["my question"]);
		expect(result.mineStatus).toBe(200);
		expect(result.mineRoles).toEqual(["user", "assistant"]);
		expect(result.mineText).toBe("my question");
		// Another wallet's conversation is a 404 — the same answer an id that does
		// not exist gets, so the route never confirms one is there.
		expect(result.theirsStatus).toBe(404);
		expect(result.theirsBody).toEqual({ error: "No such conversation." });
		expect(result.malformedStatus).toBe(404);
	},
	TIMEOUT_MS,
);
