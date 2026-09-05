import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	streamText,
	type UIMessage,
} from "ai";

import { env } from "@nuts/env/server";

import { getSession } from "@/lib/auth/session";
import { createReadTools } from "@/lib/agent/tools";
import { createExecutionTools } from "@/lib/agent/execute";
import {
	AGENT_ERROR_SENTENCES,
	agentErrorSentence,
	classifyAgentError,
} from "@/lib/agent/errors";
import { agentModel } from "@/lib/agent/model";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { OUT_OF_SCOPE_REPLY, checkScope } from "@/lib/agent/scope";
import { chargeTurn, subjectFor } from "@/lib/agent/usage";
// The request shape lives outside this file: a Next route handler may only
// export its verbs and its route config, so a schema exported here would fail
// the build, and it has to be importable by a test.
import {
	HISTORY_TOO_LONG,
	MAX_MESSAGE_CHARS,
	MESSAGE_TOO_LONG,
	REQUEST_TOO_LONG,
	agentChatBodySchema,
	messageText,
} from "@/lib/agent/request";

export const maxDuration = 60;

/**
 * C-2 (lane C pass 3, MAJOR). Plain text of EVERY user message in the request,
 * in order, for the scope gate.
 *
 * This used to be `latestUserText` — a backwards scan that returned the newest
 * user message and stopped. The whole client-supplied history was then forwarded
 * to the primary model at line ~148, and nothing anywhere establishes that the
 * earlier messages were ever classified: the history comes from the browser and
 * carries no server signature, the schema accepts consecutive user messages, and
 * `useChat` will replay whatever the client hands it. The reviewer's two
 * sequences, reproduced here before the fix:
 *
 *   TWO_USER            {"gateTexts":["What is a put?"],
 *                        "primaryRoles":["user","user"],"primaryHasScraper":true}
 *   USER_ASSISTANT_USER {"gateTexts":["What is a put?"],
 *                        "primaryRoles":["user","assistant","user"],
 *                        "primaryHasScraper":true}
 *
 * PRD 10.8, verbatim: "Every inbound message is classified before the primary
 * model runs. … This layer is authoritative." Everything in the request IS
 * inbound, so everything in the request is classified.
 *
 * ASSISTANT parts are deliberately NOT included. They are not the person's
 * request, and forwarding them to the gate would hand a classifier text a
 * hostile client wrote under the model's own role — text the gate instruction
 * says to treat as data would then arrive as conversation. The one thing that
 * must be classified is what the user is asking for, and that is the user role.
 *
 * COST, stated rather than implied: every turn re-classifies the whole
 * conversation's user text instead of one message, so the gate's input grows
 * with the conversation. It is bounded — `agentChatBodySchema` caps a request at
 * 80 messages, each user message at `MAX_MESSAGE_CHARS`, and the whole request
 * at `MAX_REQUEST_CHARS` — so this cannot grow without limit, but it is not
 * free. TODO-OWNER: the cheaper design is for the server to SIGN the history it
 * returns and classify only unsigned user text; that is a new mechanism, not a
 * fix, and it is the owner's call.
 */
function userTexts(messages: UIMessage[]): string[] {
	const texts: string[] = [];
	for (const message of messages) {
		if (message?.role !== "user") continue;
		const text = messageText(message.parts as Array<{ type?: unknown; text?: unknown }>);
		if (text.length > 0) texts.push(text);
	}
	return texts;
}

/**
 * F-E item 3. Every JSON failure this route writes carries `source: "agent"`.
 *
 * `useChat` surfaces a non-OK response by throwing `new Error(await
 * response.text())` (`ai@7.0.92` dist/index.js:18673-18676), so the whole body
 * lands in `error.message` in the browser. The marker is what lets the client
 * tell OUR sentence from a proxy's error page and refuse to print the latter —
 * see `agentErrorMessage` in `lib/agent/errors.ts`.
 */
function agentError(message: string, status: number): Response {
	return Response.json({ error: message, source: "agent" }, { status });
}

export async function POST(request: Request) {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return agentError("Malformed request body.", 400);
	}

	const body = agentChatBodySchema.safeParse(parsed);
	if (!body.success) {
		/**
		 * C-P2-3. An over-long message gets its own sentence, because "expected a
		 * messages array" would be a lie about what the person did wrong. Both
		 * answers are 400s decided here, BEFORE `chargeTurn` and before any model
		 * call. TODO-OWNER: the wording and the 2,000-character limit itself.
		 */
		const codes = new Set(body.error.issues.map((issue) => issue.message));
		// C-3. The aggregate refusal is about the CONVERSATION, so it cannot be
		// answered with "keep that message shorter" — the person's last message may
		// be three words. TODO-OWNER: both sentences.
		const sentence = codes.has(REQUEST_TOO_LONG)
			? "This conversation has grown too long to send. Start a new chat and ask again."
			: codes.has(MESSAGE_TOO_LONG)
				? `That message is too long. Please keep it under ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters and send it again.`
				: codes.has(HISTORY_TOO_LONG)
					? // Not the person's message: an earlier reply in the history is
						// longer than any answer this app can produce. Nothing they can
						// shorten, so they are told what to do instead.
						"An earlier reply in this conversation is too long to send back. Start a new chat and ask again."
					: "Expected a messages array.";
		return agentError(sentence, 400);
	}

	const messages = body.data.messages as unknown as UIMessage[];
	const account = (body.data.walletAddress as `0x${string}` | undefined) ?? null;
	// Read from the cookie, NEVER from the body: the ticket `prepareTradeFor`
	// issues is bound to this session, so it decides which wallet may ever
	// record the fill.
	const session = await getSession();
	const thesisId = body.data.thesisId?.toLowerCase() ?? null;
	// Uppercased to match the tickers the order feed publishes. Only defaults the
	// agent's search; it is bound into the tool by closure, never offered to the
	// model as an argument.
	const asset = body.data.asset?.toUpperCase() ?? null;

	/**
	 * C6-r2. PRD 10.2's daily model limits, charged BEFORE any model is called —
	 * including the small scope model, which is also a paid call. The turn is
	 * charged to the signed-in wallet when there is one, so the connected address
	 * in the body cannot buy a bigger allowance than the session it belongs to.
	 */
	const turn = await chargeTurn(subjectFor(session?.walletAddress ?? null, request.headers));
	if (!turn.allowed) {
		return agentError(turn.reason, 429);
	}

	// PRD 10.8 layer 1. Runs before the primary model, so an out-of-scope
	// request costs one small model call rather than a full agent turn.
	const scope = await checkScope(userTexts(messages));

	/**
	 * Residual (lane C confirming pass): the gate's `degraded` result was ignored
	 * — a scope check that could not run returned `inScope: true` and the turn
	 * proceeded as if it had passed. PRD 10.8 makes this layer 1 of the defence,
	 * so a layer that did not run is a refusal, not a pass.
	 * TODO-OWNER: the wording, and whether a degraded gate should serve at all.
	 */
	if (scope.degraded) {
		/**
		 * F-E item 3. One sentence per CAUSE instead of one sentence for all of
		 * them: a spent free-tier quota, an unpaid account and a model id the
		 * provider does not serve each need a different person to do a different
		 * thing, and "try again shortly" is only true for one of the three.
		 * TODO-OWNER: every sentence in AGENT_ERROR_SENTENCES.
		 */
		const cls = scope.errorClass === "ok" ? "unknown" : scope.errorClass;
		return agentError(
			`The agent's safety check could not run, so this message was not sent. ${AGENT_ERROR_SENTENCES[cls]}`,
			503,
		);
	}

	if (!scope.inScope) {
		const stream = createUIMessageStream({
			execute: async ({ writer }) => {
				const id = crypto.randomUUID();
				writer.write({ type: "text-start", id });
				writer.write({ type: "text-delta", id, delta: OUT_OF_SCOPE_REPLY });
				writer.write({ type: "text-end", id });
			},
		});
		return createUIMessageStreamResponse({ stream });
	}

	const result = streamText({
		model: agentModel,
		system: SYSTEM_PROMPT,
		messages: await convertToModelMessages(messages),
		tools: { ...createReadTools({ asset }), ...createExecutionTools({ account, session, thesisId }) },
		/**
		 * PRD 10.1 and 14: no transaction is prepared without an explicit answer from
		 * the user. The runtime suspends the tool call and emits an approval request,
		 * so `execute` cannot run on the model's say-so alone. Read tools are absent
		 * from this map and therefore run freely; they cannot move funds.
		 */
		toolApproval: { requestOptionBookExecution: "user-approval" },
		// Search, preview, then prepare is the deepest real path, and an approval
		// suspends and resumes the loop. Without a ceiling a confused turn can spin.
		// TODO-OWNER: the step ceiling and the sampling temperature.
		stopWhen: ({ steps }) => steps.length >= 10,
		temperature: 0.3,
		// Bounds cost per turn and keeps answers short enough to read. Without an
		// explicit cap the provider reserves its full context window against the
		// account balance, which fails outright on a small balance.
		// TODO-OWNER: the per-turn output ceiling.
		maxOutputTokens: 1200,
	});

	return result.toUIMessageStreamResponse({
		onError: (error) => {
			/**
			 * F-E item 3. `streamText` reports failures HERE rather than throwing out
			 * of the handler, so the response is already a 200 by the time this runs
			 * — which is exactly why a wrong model id looked like a working route
			 * for a whole evening (`da09e81`). The class decides the sentence; the
			 * class and the model id are logged so an operator can act without the
			 * user relaying anything.
			 *
			 * Never leaks provider internals: `agentErrorSentence` returns one of
			 * five fixed strings and nothing derived from the provider's message.
			 */
			console.error(`[agent/chat] [${classifyAgentError(error)}] model=${env.AGENT_MODEL}:`, error);
			return agentErrorSentence(error);
		},
	});
}
