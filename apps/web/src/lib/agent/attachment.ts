import "server-only";

/**
 * C#7 (lane C confirming pass, finding 7). Conversation CONTEXT is not an
 * attachment request.
 *
 * `/agent?thesis=<uuid>` says "this conversation is about that post". The
 * execution tool forwarded that id into `prepareTradeFor` as the position's
 * attachment, and `resolveAttachment` refuses a post that names no structure:
 *   TEXT_POST_EXECUTION_ATTACHMENT {"error":{"code":"THESIS_HAS_NO_STRUCTURE",
 *                                            "reason":"That post names no structure to trade."}}
 * Every post `writePost` publishes leaves the whole structure group null (owner
 * 2026-09-05: "a pure text opinion is fine also"), so ASKING the agent about a
 * text post made it impossible to execute anything at all — even an instrument
 * the user went on to choose explicitly.
 *
 * Nothing is manufactured here. A post with no structure has nothing to back,
 * so the trade is what migration 0007 already calls a STANDALONE position: it
 * belongs to no post and claims nothing about one. Every other refusal
 * `resolveAttachment` makes — a post about another market, another instrument,
 * a post that is not open — is untouched and still refuses, because those are
 * the substitutions PRD 8.4 forbids.
 */
import { db } from "@nuts/db";
import { findThesis } from "@/lib/trade/store";

export interface ThesisAttachment {
	/** The post to attach the position to, or null for a standalone fill. */
	readonly attach: string | null;
	/**
	 * Why the position is standalone, for the model to say out loud. Null when
	 * the position attaches, and when there was no post in the first place.
	 */
	readonly note: string | null;
}

/**
 * Pure half, so the decision is testable without a database.
 *
 * Only ONE case is turned into a standalone fill: a post that names no
 * instrument. A post that names a DIFFERENT one is still forwarded, so
 * `resolveAttachment` can refuse it — silently trading standalone instead would
 * be exactly the substitution PRD 8.4 forbids, dressed up as a courtesy.
 */
export function attachmentFor(
	thesisId: string | null,
	thesis: { readonly id: string; readonly underlyingAsset: string | null } | null,
): ThesisAttachment {
	if (thesisId === null) return { attach: null, note: null };
	if (thesis === null) {
		// Let the shared path refuse it by name rather than guessing here.
		return { attach: thesisId, note: null };
	}
	if (thesis.underlyingAsset === null) {
		return {
			attach: null,
			// TODO-OWNER: wording.
			note: "That post names no instrument, so this trade is recorded on its own and does not back the post.",
		};
	}
	return { attach: thesis.id, note: null };
}

/** Reads the post named by the conversation and decides what the fill attaches to. */
export async function resolveThesisAttachment(thesisId: string | null): Promise<ThesisAttachment> {
	if (thesisId === null) return { attach: null, note: null };
	return attachmentFor(thesisId, await findThesis(db, thesisId));
}
