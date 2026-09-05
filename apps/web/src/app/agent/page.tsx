import { AgentChat } from "@/components/agent/agent-chat";

export const metadata = {
	// TODO-OWNER: page title and description (they are also the link preview).
	title: "Agent · Thesis.fun",
	description: "Turn a market view into a real, bounded-risk options position on Base.",
};

/** Same UUID grammar as the read layer; anything else is ignored, never queried. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/agent?thesis=<uuid>` — the destination of the "Explain" control on a post
 * (owner 2026-09-05 18:2x: "ask what this thesis is about then potentially
 * trade on it?").
 *
 * The id is only handed to the chat, which opens the conversation with it; the
 * agent then reads the post through its own `getThesisContext` tool, so nothing
 * about the post is fetched here and no unpublished text can leak through the
 * URL. A malformed id is dropped rather than passed on.
 */
export default async function AgentPage({
	searchParams,
}: {
	searchParams: Promise<{ thesis?: string | string[] }>;
}) {
	const params = await searchParams;
	const raw = Array.isArray(params.thesis) ? params.thesis[0] : params.thesis;
	const thesisId = typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
	return <AgentChat thesisId={thesisId} />;
}
