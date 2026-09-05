/**
 * F18. The ONE place a machine code becomes a sentence a person reads.
 *
 * Codes like `challenge_invalid`, `handle_taken` and `invalid_handle` were
 * printed to users verbatim (`auth/actions.ts` -> `wallet-bar.tsx`,
 * `profile-editor.tsx`), which reads as a crash rather than as something the
 * reader can act on. The codes stay in the action RESULTS — they are the
 * contract the server speaks and what a test asserts on — and only the
 * rendering passes through here.
 *
 * TODO-OWNER: every sentence below is placeholder wording. They state the fact
 * and the next action and invent no policy, limit or number, but the voice is
 * the owner's to set.
 */
const MESSAGES: Record<string, string> = {
	// Sign-in (lib/auth/sign-in.ts `CompleteSignInFailure`).
	challenge_invalid: "That sign-in request is no longer valid. Try signing in again.",
	domain_mismatch: "That sign-in request was issued for a different site. Try signing in again.",
	signature_invalid: "That signature could not be verified. Try signing in again.",
	// F24: a real failure during sign-in, as opposed to the user declining.
	sign_in_failed: "Sign-in could not be completed. Check your connection and try again.",
	// Profile (lib/profile/validation.ts, lib/profile/writes.ts).
	invalid_handle: "A handle can use lowercase letters, numbers and underscores only, up to 32 characters.",
	invalid_profile: "Some of those details could not be saved. Check them and try again.",
	handle_taken: "That handle is already taken. Pick another one.",
	sign_in_required: "Sign in with your wallet first.",
	save_failed: "That could not be saved. Try again.",
	// Social (lib/social/guards.ts `SocialError`).
	invalid_id: "That link points at something we cannot find.",
	self_follow: "You cannot follow yourself.",
	blank_comment: "Write something before posting.",
	not_found: "That is no longer here.",
	mock_mode: "This action needs the live database and is off in preview data.",
	invalid_state: "That action could not be applied. Try again.",
};

/**
 * The sentence for a code. Anything unrecognised falls back to a plain line
 * rather than leaking the raw token: an unmapped code is a gap in this file,
 * not something to show a reader.
 *
 * A value that is already a sentence (it contains a space) is passed through,
 * so the server actions that return prose — the trade path returns full
 * sentences — are unaffected.
 */
export function readableError(code: string | null | undefined): string | null {
	if (code === null || code === undefined || code === "") return null;
	const mapped = MESSAGES[code];
	if (mapped !== undefined) return mapped;
	if (code.includes(" ")) return code;
	return "Something went wrong. Try again.";
}

/** Exported for the test that proves every known code is mapped. */
export const MESSAGE_CODES = Object.keys(MESSAGES);
