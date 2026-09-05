/** Lowercase wallet-address route fallback for a user whose handle is null. */
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
