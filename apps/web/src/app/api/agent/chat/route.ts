import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	streamText,
	type UIMessage,
} from "ai";

import { getSession } from "@/lib/auth/session";
import { createReadTools } from "@/lib/agent/tools";
import { createExecutionTools } from "@/lib/agent/execute";
import { agentModel } from "@/lib/agent/model";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { OUT_OF_SCOPE_REPLY, checkScope } from "@/lib/agent/scope";
import { chargeTurn, subjectFor } from "@/lib/agent/usage";
// The request shape lives outside this file: a Next route handler may only
// export its verbs and its route config, so a schema exported here would fail
// the build, and it has to be importable by a test.
import { agentChatBodySchema } from "@/lib/agent/request";

export const maxDuration = 60;

/** Plain text of the newest user message, for the scope gate. */
function latestUserText(messages: UIMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role !== "user") continue;
		return m.parts
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("\n")
			.trim();
	}
	return "";
}

export async function POST(request: Request) {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return Response.json({ error: "Malformed request body." }, { status: 400 });
	}

	const body = agentChatBodySchema.safeParse(parsed);
	if (!body.success) {
		return Response.json({ error: "Expected a messages array." }, { status: 400 });
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
		return Response.json({ error: turn.reason }, { status: 429 });
	}

	// PRD 10.8 layer 1. Runs before the primary model, so an out-of-scope
	// request costs one small model call rather than a full agent turn.
	const scope = await checkScope(latestUserText(messages));

	/**
	 * Residual (lane C confirming pass): the gate's `degraded` result was ignored
	 * — a scope check that could not run returned `inScope: true` and the turn
	 * proceeded as if it had passed. PRD 10.8 makes this layer 1 of the defence,
	 * so a layer that did not run is a refusal, not a pass.
	 * TODO-OWNER: the wording, and whether a degraded gate should serve at all.
	 */
	if (scope.degraded) {
		return Response.json(
			{ error: "The agent's safety check could not run, so this message was not sent. Try again shortly." },
			{ status: 503 },
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
			// Never leak provider internals to the browser.
			console.error("[agent/chat]", error);
			return "The agent is unavailable right now. Please try again.";
		},
	});
}
