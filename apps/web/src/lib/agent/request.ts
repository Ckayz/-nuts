/**
 * The `/api/agent/chat` request shape.
 *
 * In its own module because a Next.js route handler may only export its HTTP
 * verbs and route config — an exported schema there fails the build — and this
 * one is pinned by a test.
 */
import { z } from "zod";

/**
 * Residual (lane C confirming pass). `messages` was `z.array(z.unknown())`, so
 * `{messages:[{role:"user"}]}` and `{messages:[{role:"user",parts:[null]}]}`
 * both passed the schema and then threw inside `latestUserText` — on
 * `m.parts.filter` and on `p.type` respectively. A malformed body is a 400.
 *
 * Deliberately shallow: this is a shape fence, not a re-implementation of the
 * SDK's `UIMessage`. It asserts only what this route dereferences.
 */
const messageSchema = z.object({
	role: z.string(),
	parts: z.array(z.object({ type: z.string() }).passthrough()),
}).passthrough();

/** Exported so the shape can be pinned by a test rather than by a request. */
export const agentChatBodySchema = z.object({
	// TODO-OWNER: the conversation length a single turn may carry. 80 is not an
	// owner number; it bounds what `convertToModelMessages` is handed.
	messages: z.array(messageSchema).min(1).max(80),
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
