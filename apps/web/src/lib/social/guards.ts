/** Same UUID grammar as data/reads.ts; kept pure for offline input tests. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * B3. THE one public-status list, re-exported so the rankings and the readers
 * cannot drift apart again. Two lists existed and disagreed about `expired`.
 */
export { PUBLIC_THESIS_STATUSES as SOCIAL_PUBLIC_STATUSES } from "@/lib/data/constants";
export type SocialError = { error: "sign_in_required" | "invalid_id" | "self_follow" | "blank_comment" | "not_found" | "mock_mode" | "invalid_state" };
export function actorGuard(actor: string | null, target: unknown, follow = false): SocialError | null {
	if (actor === null) return { error: "sign_in_required" };
	if (typeof target !== "string" || !UUID.test(target) || !UUID.test(actor)) return { error: "invalid_id" };
	if (follow && actor.toLowerCase() === target.toLowerCase()) return { error: "self_follow" };
	return null;
}
export function commentBody(body: unknown): string | SocialError {
	// TODO-OWNER: comment maximum length is not defined; no invented cap.
	if (typeof body !== "string" || !body.trim()) return { error: "blank_comment" };
	return body.trim();
}

export function desiredStateGuard(value: unknown): SocialError | null {
	return value === undefined || typeof value === "boolean" ? null : { error: "invalid_state" };
}

/**
 * B-R2 (lane B pass 2), second half. The caller may say WHICH wallet the
 * browser is holding; when it does and that is not the session's wallet, the
 * write is refused.
 *
 * The session cookie stays the identity — this never grants anything. It only
 * refuses a write whose two identities disagree, which is the window a FAILED
 * mismatch sign-out leaves open: the wallet is B, the cookie is still A, and
 * without this the like lands as A.
 *
 * Fail closed: anything present that is not this session's wallet is a refusal,
 * including a non-string and the empty string. Absent (`undefined`/`null`) is
 * the caller saying nothing, which is the behaviour every existing caller had.
 * The code is the existing `sign_in_required` — its sentence ("Sign in with
 * your wallet first.") is what the person has to do, and no new copy is
 * invented here.
 */
export function walletGuard(sessionWallet: string, claimed: unknown): SocialError | null {
	if (claimed === undefined || claimed === null) return null;
	if (typeof claimed !== "string") return { error: "sign_in_required" };
	return claimed.trim().toLowerCase() === sessionWallet.trim().toLowerCase()
		? null
		: { error: "sign_in_required" };
}
