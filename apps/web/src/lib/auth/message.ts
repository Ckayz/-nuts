/**
 * The exact bytes the wallet signs, built from persisted challenge fields only.
 *
 * The client never sends the message text back: `verifySignIn` rebuilds it from
 * the `auth_challenges` row it just consumed, so a caller cannot substitute a
 * different domain, chain or expiry than the one the server issued.
 *
 * Shape follows EIP-4361 (Sign-In with Ethereum) so wallets render it legibly.
 * It is signed with `personal_sign` (EIP-191), not EIP-712 typed data: SIWE is a
 * plain-text standard, and viem's public-client `verifyMessage` hashes it with
 * `hashMessage` and then verifies EOA, ERC-1271 and ERC-6492 signatures through
 * one call — which is what Coinbase Smart Wallet needs before its account is
 * deployed. EIP-712 would add a domain separator and buy nothing here.
 *
 * Deliberate deviation from EIP-4361: the optional `Issued At` line is omitted.
 * `auth_challenges` (packages/db/src/schema/auth-challenges.ts) stores
 * `wallet_address`, `nonce`, `domain`, `chain_id` and `expires_at` and no issue
 * timestamp, so including one would make the verifier re-derive a value it never
 * persisted. Every field below comes from a stored column.
 *
 * Pure: no database, no crypto, no `server-only`, so it is unit-testable.
 */
import { getAddress } from "viem";

export interface SignInMessageFields {
	/** RFC 3986 authority the challenge was issued for, e.g. `thesis.fun` or `localhost:3001`. */
	domain: string;
	walletAddress: string;
	chainId: number;
	nonce: string;
	statement: string;
	expiresAt: Date;
}

/** Loopback hosts are served over http in development; everything else is https. */
export function originForDomain(domain: string): string {
	const host = domain.split(":")[0] ?? "";
	const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
	return `${loopback ? "http" : "https"}://${domain}`;
}

export function buildSignInMessage(fields: SignInMessageFields): string {
	// EIP-4361 requires the EIP-55 checksummed form in the message body even
	// though every persisted copy of the address is lowercase.
	const address = getAddress(fields.walletAddress);
	return [
		`${fields.domain} wants you to sign in with your Ethereum account:`,
		address,
		"",
		fields.statement,
		"",
		`URI: ${originForDomain(fields.domain)}`,
		"Version: 1",
		`Chain ID: ${fields.chainId}`,
		`Nonce: ${fields.nonce}`,
		`Expiration Time: ${fields.expiresAt.toISOString()}`,
	].join("\n");
}
