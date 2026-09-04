import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	streamText,
	type UIMessage,
} from "ai";
import { z } from "zod";

import { readTools } from "@/lib/agent/tools";
import { agentModel } from "@/lib/agent/model";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { OUT_OF_SCOPE_REPLY, checkScope } from "@/lib/agent/scope";

export const maxDuration = 60;

const bodySchema = z.object({
	messages: z.array(z.unknown()).min(1).max(80),
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
		tools: readTools,
		// Read tools chain: search, then preview, then answer. Without a ceiling a
		// confused turn can loop; 8 is comfortably above the deepest real path.
		stopWhen: ({ steps }) => steps.length >= 8,
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
