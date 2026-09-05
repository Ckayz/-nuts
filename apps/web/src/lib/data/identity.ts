/**
 * Route identifiers and monograms derived from what the schema actually stores.
 *
 * SCHEMA FOLLOW-UPS (both verified absent on 2026-09-05):
 *  - `theses` has no `slug` column (packages/db/src/schema/theses.ts). `/t/[slug]`
 *    therefore routes on the thesis uuid. A real slug column, or a
 *    slug-generation rule, is an owner/schema decision.
 *  - `users` has no `handle` column (packages/db/src/schema/users.ts). `/u/[handle]`
 *    therefore routes on the lowercase wallet address, which is the identity per
 *    the owner's "wallet address is the identity" decision. Nothing is invented.
 *
 * Pure; no database import, so these are unit-testable.
 */

/** `theses.id`, until a slug column exists. */
export function thesisSlug(thesisId: string): string {
	return thesisId;
}

/** Lowercase wallet address, until a handle column exists. */
export function creatorHandle(walletAddress: string): string {
	return walletAddress.toLowerCase();
}

/**
 * Two-character monogram for the mockup's `.av` avatar. Uses the display name
 * when the user set one, otherwise the first two hex characters of the address.
 * Derivation only — no name is invented for a user who has not set one.
 */
export function creatorInitials(displayName: string | null, walletAddress: string): string {
	if (displayName !== null) {
		const words = displayName.trim().split(/\s+/).filter((word) => word.length > 0);
		if (words.length >= 2) return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
		if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
	}
	return walletAddress.replace(/^0x/i, "").slice(0, 2).toUpperCase();
}
