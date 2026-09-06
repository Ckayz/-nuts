import { AgentChat } from "@/components/agent/agent-chat";
import { AgentHistory } from "@/components/agent/agent-history";
import { listConversations, loadConversation } from "@/lib/agent/history";
import { getSession } from "@/lib/auth/session";

export const metadata = {
	// TODO-OWNER: page title and description (they are also the link preview).
	title: "Agent · Thesis.fun",
	description: "Turn a market view into a real, bounded-risk options position on Base.",
};

/** Same UUID grammar as the read layer; anything else is ignored, never queried. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: string | string[] | undefined): string | null {
	const raw = Array.isArray(value) ? value[0] : value;
	return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

/**
 * `/agent?thesis=<uuid>` — the destination of the "Explain" control on a post
 * (owner 2026-09-05 18:2x: "ask what this thesis is about then potentially
 * trade on it?").
 *
 * The id is only handed to the chat, which opens the conversation with it; the
 * agent then reads the post through its own `getThesisContext` tool, so nothing
 * about the post is fetched here and no unpublished text can leak through the
 * URL. A malformed id is dropped rather than passed on.
 *
 * W5 — `/agent?c=<uuid>` reopens a SAVED chat (owner 2026-09-06 15:0x: "can you
 * add in like history for the ai agent for every session ?").
 *
 * The wallet comes from the session cookie, never from the URL, and
 * `loadConversation` answers null for a conversation that is not this wallet's,
 * so a link to someone else's chat renders an EMPTY agent rather than their
 * history. A signed-out visitor gets the same empty agent plus one sentence:
 * PRD 10.2, "Guest users receive ephemeral discovery only. Wallet
 * authentication is required for persistence."
 */
export default async function AgentPage({
	searchParams,
}: {
	searchParams: Promise<{ thesis?: string | string[]; c?: string | string[] }>;
}) {
	const params = await searchParams;
	const thesisId = single(params.thesis);
	const requested = single(params.c);

	const session = await getSession();
	const conversations = session === null ? [] : await listConversations(session.walletAddress);
	const messages =
		session === null || requested === null ? null : await loadConversation(session.walletAddress, requested);
	// Null covers both "no id asked for" and "not this wallet's": the chat opens
	// empty either way, and no id is handed to the client that the server would
	// then refuse on the next turn.
	const conversationId = messages === null ? null : requested;

	return (
		<AgentChat
			thesisId={thesisId}
			initialConversationId={conversationId}
			initialMessages={messages === null ? undefined : (messages as never)}
			history={
				<AgentHistory
					conversations={conversations.map((conversation) => ({
						id: conversation.id,
						title: conversation.title,
						updatedAt: conversation.updatedAt,
					}))}
					activeId={conversationId}
					signedIn={session !== null}
				/>
			}
		/>
	);
}
