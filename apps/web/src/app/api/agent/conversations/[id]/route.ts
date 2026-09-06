import { getSession } from "@/lib/auth/session";
import { loadConversation } from "@/lib/agent/history";

/**
 * W5. `GET /api/agent/conversations/:id` — one saved chat's messages.
 *
 * PRD 10.4. The wallet comes from the session cookie, never from the URL, and
 * `loadConversation` returns null for a conversation that is not this wallet's
 * — which is answered 404, the same as an id that does not exist, so the route
 * never says whether someone else's conversation is there.
 */
export const dynamic = "force-dynamic";

/** The same uuid grammar the chat route and the read layer use. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
	const session = await getSession();
	if (session === null) {
		// TODO-OWNER: the wording.
		return Response.json({ error: "Sign in with a wallet to see your chats." }, { status: 401 });
	}
	const { id } = await context.params;
	// A malformed id is refused here rather than queried.
	if (!UUID.test(id)) return Response.json({ error: "No such conversation." }, { status: 404 });

	const messages = await loadConversation(session.walletAddress, id.toLowerCase());
	if (messages === null) {
		// TODO-OWNER: the wording. Deliberately the same answer as "not yours".
		return Response.json({ error: "No such conversation." }, { status: 404 });
	}
	return Response.json({ id: id.toLowerCase(), messages }, { headers: { "cache-control": "no-store" } });
}
