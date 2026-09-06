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
import { createPositionTools } from "@/lib/agent/positions";
import { createExecutionTools } from "@/lib/agent/execute";
import { createRfqTools } from "@/lib/agent/rfq-tools";
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
	withoutClientEchoes,
} from "@/lib/agent/request";

export const maxDuration = 60;

/**
 * C-2 (lane C pass 3, MAJOR), K-1 (pass-4 lane C MAJOR-1) and K-4 (pass-5 lane
 * C MAJOR-1). What the scope gate is given: every message, SERIALISED WHOLE.
 *
 * -- Why this is not a list of channels -------------------------------------
 *
 * This function has been found wrong in the same way in two consecutive
 * reviews. It read `latestUserText`, then every role's text, then text plus a
 * tool part's `output` and `errorText`, then plus `input` and `rawInput`. Each
 * round closed the channels that round had thought of, and each time the next
 * reviewer found more that `convertToModelMessages` forwards and this did not
 * read. Pass 5 measured seven of them through the real route, gate and provider
 * injected, on the PRE-FOLD bytes (no strip existed yet, so every marker also
 * reached the provider):
 *
 *   A1 approval.reason        A2 approval.requestReason
 *   A3 output-denied reason   A4 approved reason
 *   B1 toolCallId             B2 callProviderMetadata     B3 approval.signature
 *   each {"status":200,"modelCalls":1,"gateSaw":false,"modelSaw":true}
 *   A5, the same string as user text: {"modelCalls":0,"gateSaw":true}
 *
 * An ENUMERATION of channels is the wrong shape, because the property wanted is
 * about the channels nobody has enumerated yet. So the gate now reads the whole
 * validated message object -- `JSON.stringify(message)`: every part, every
 * nested field, every passthrough key such as `useChat`'s `id` -- prefixed with
 * the role the client CLAIMED. `gatePrompt` wraps each string in its own
 * `<message>` block and the gate instruction says to classify, never to obey.
 *
 * The property this buys, and the reason `withoutClientEchoes` runs AFTER this
 * rather than inside the schema: the gate is handed exactly the message the
 * SCHEMA ACCEPTED — zod has already dropped any part key the closed union does
 * not name, and those keys reach nothing at all — and the primary model is
 * handed a SUBSET of that. No client-writable byte reaches the model without
 * passing the classifier, and that stays true if a later edit shortens the
 * strip list.
 *
 * CHUNKED at `MAX_MESSAGE_CHARS`, which is not cosmetic: `gatePrompt` puts
 * every string through `gateWindowText`, a `slice(0, MAX_MESSAGE_CHARS)`. A
 * serialised message is longer than the text inside it, so handing one over
 * whole would let the gate read the first 2,000 characters while the model read
 * all of them -- the exact truncation hole C-P2-3 closed for user text.
 *
 * COST, stated rather than implied: every turn re-classifies the whole request
 * as JSON, so the gate's input is larger than the conversation's prose and
 * grows with it. It is bounded -- `agentChatBodySchema` caps a request at 80
 * messages, each user message at `MAX_MESSAGE_CHARS`, each assistant message at
 * `MAX_ASSISTANT_MESSAGE_CHARS`, and the whole SERIALISED request at
 * `MAX_REQUEST_CHARS`, measured by `agentChatBodySchema` on `JSON.stringify` of
 * these same validated messages and BEFORE the strip runs -- so the arithmetic
 * ceiling is `MAX_REQUEST_CHARS / (MAX_MESSAGE_CHARS - label)` blocks of body,
 * about 61, plus at most one partly-filled block per message, 80: 141 blocks of
 * at most 2,000 characters. Not free.
 * TODO-OWNER: the cheaper design is for the server to SIGN the history it
 * returns and classify only unsigned text; that is a new mechanism, not a fix,
 * and it is the owner's call.
 *
 * FLAGGED, not decided: `GATE_INSTRUCTION` (`lib/agent/scope.ts`) tells the gate
 * model it is given "messages", and each block is now a JSON object rather than
 * bare prose. Everything the person wrote is still inside that JSON and the
 * instruction already says to treat a block as data, but whether that sentence
 * should mention the shape is a copy decision, and `scope.ts` is outside this
 * fold's file list.
 */
function inboundTexts(messages: UIMessage[]): string[] {
	const texts: string[] = [];
	for (const message of messages) {
		// A validated message came out of `JSON.parse`, so it holds no cycles, no
		// `BigInt` and no functions: `JSON.stringify` cannot throw here, and an
		// object never serialises to `undefined`. The fallback is belt to that.
		const serialised = JSON.stringify(message) ?? "";
		const label = `[${String((message as { role?: unknown }).role)}] `;
		const room = Math.max(1, MAX_MESSAGE_CHARS - label.length);
		// `serialised` is never empty, so EVERY message contributes at least one
		// block. A message the gate cannot see at all is the bug this closes.
		for (let at = 0; at < serialised.length; at += room) {
			texts.push(`${label}${serialised.slice(at, at + room)}`);
		}
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
	const scope = await checkScope(inboundTexts(messages));

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
		/**
		 * K-4 item 2. The model is handed the messages MINUS the fields the
		 * SERVER wrote on an earlier turn and the browser only echoes back. See
		 * `withoutClientEchoes`; the gate above already read the unstripped ones.
		 */
		messages: await convertToModelMessages(withoutClientEchoes(messages)),
		/**
		 * Read tools, then the POSITION tools, then the one approval-gated write
		 * tool. `createPositionTools` binds the session the same way
		 * `createExecutionTools` binds it: the wallet whose positions are read is
		 * the cookie's, never a value the model can name.
		 */
		tools: { ...createReadTools({ asset }), ...createPositionTools({ session }), ...createRfqTools({ session, account }), ...createExecutionTools({ account, session, thesisId }) },
		/**
		 * PRD 10.1 and 14: no transaction is prepared without an explicit answer from
		 * the user. The runtime suspends the tool call and emits an approval request,
		 * so `execute` cannot run on the model's say-so alone. Read tools are absent
		 * from this map and therefore run freely; they cannot move funds.
		 */
		toolApproval: {
			requestOptionBookExecution: "user-approval",
			// The three RFQ writes. `requestRfqCreation` escrows the deposit;
			// `requestRfqCancellation` and `requestRfqSettlement` each send a real
			// transaction from the user's wallet. None of them may run on the
			// model's say-so alone. `rfq-tools.ts` `RFQ_APPROVAL_REQUIRED_TOOLS` is
			// the same list, and `rfq-tools.test.ts` pins this map against it.
			requestRfqCreation: "user-approval",
			requestRfqCancellation: "user-approval",
			requestRfqSettlement: "user-approval",
		},
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
