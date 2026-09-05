import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	streamText,
	type UIMessage,
} from "ai";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { readTools } from "@/lib/agent/tools";
import { createExecutionTools } from "@/lib/agent/execute";
import { agentModel } from "@/lib/agent/model";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { OUT_OF_SCOPE_REPLY, checkScope } from "@/lib/agent/scope";

export const maxDuration = 60;

const bodySchema = z.object({
	messages: z.array(z.unknown()).min(1).max(80),
	/**
	 * The connected wallet. Bound into the write tool so the model cannot name a
	 * different address, and used only as the transaction sender.
	 */
	walletAddress: z
		.string()
		.regex(/^0x[0-9a-fA-F]{40}$/)
		.optional(),
	/**
	 * The post this conversation is about (`/agent?thesis=<uuid>`). It only ever
	 * decides which post a prepared fill attaches to; every economic value is
	 * still re-read server-side.
	 */
	thesisId: z
		.string()
		.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
		.optional(),
});

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

	const body = bodySchema.safeParse(parsed);
	if (!body.success) {
		return Response.json({ error: "Expected a messages array." }, { status: 400 });
	}

	const messages = body.data.messages as UIMessage[];
	const account = (body.data.walletAddress as `0x${string}` | undefined) ?? null;
	// Read from the cookie, NEVER from the body: the ticket `prepareTradeFor`
	// issues is bound to this session, so it decides which wallet may ever
	// record the fill.
	const session = await getSession();
	const thesisId = body.data.thesisId?.toLowerCase() ?? null;

	// PRD 10.8 layer 1. Runs before the primary model, so an out-of-scope
	// request costs one small model call rather than a full agent turn.
	const scope = await checkScope(latestUserText(messages));

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
		tools: { ...readTools, ...createExecutionTools({ account, session, thesisId }) },
		/**
		 * PRD 10.1 and 14: no transaction is prepared without an explicit answer from
		 * the user. The runtime suspends the tool call and emits an approval request,
		 * so `execute` cannot run on the model's say-so alone. Read tools are absent
		 * from this map and therefore run freely; they cannot move funds.
		 */
		toolApproval: { requestOptionBookExecution: "user-approval" },
		// Search, preview, then prepare is the deepest real path, and an approval
		// suspends and resumes the loop. Without a ceiling a confused turn can spin.
		stopWhen: ({ steps }) => steps.length >= 10,
		temperature: 0.3,
		// Bounds cost per turn and keeps answers short enough to read. Without an
		// explicit cap the provider reserves its full context window against the
		// account balance, which fails outright on a small balance.
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
