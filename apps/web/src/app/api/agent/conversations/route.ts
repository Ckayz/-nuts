import { getSession } from "@/lib/auth/session";
import { listConversations } from "@/lib/agent/history";

/**
 * W5. `GET /api/agent/conversations` — the signed-in wallet's saved chats.
 *
 * PRD 10.4 names this route and its sibling `/:id`. Both are thin wrappers over
 * `lib/agent/history.ts`, and neither takes a wallet as a parameter: the wallet
 * is the SESSION's, read from the httpOnly cookie, so no request can ask for
 * someone else's history.
 *
 * The page at `/agent` renders the same list server-side, so nothing in this
 * app calls this route today. It exists because the PRD names it, and because
 * it is the one shape a future client-side "recent chats" control would use.
 *
 * `no-store`: a per-wallet answer must never be held by a shared cache.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const session = await getSession();
	if (session === null) {
		// TODO-OWNER: the wording. PRD 10.2: persistence needs authentication.
		return Response.json({ error: "Sign in with a wallet to see your chats." }, { status: 401 });
	}
	const conversations = await listConversations(session.walletAddress);
	return Response.json(
		{
			conversations: conversations.map((conversation) => ({
				id: conversation.id,
				title: conversation.title,
				thesisId: conversation.thesisId,
				updatedAt: conversation.updatedAt.toISOString(),
			})),
		},
		{ headers: { "cache-control": "no-store" } },
	);
}
