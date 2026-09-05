/** Same UUID grammar as data/reads.ts; kept pure for offline input tests. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SOCIAL_PUBLIC_STATUSES = ["open", "expired", "settled"] as const;
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
