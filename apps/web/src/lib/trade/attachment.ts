/**
 * C12-r2 (lane C confirming pass, finding 12). Does a fill on THIS live
 * structure describe the instrument a post named?
 *
 * Pure and dependency-free on purpose: `prepare.ts` imports `@nuts/db` at module
 * scope, and this rule is the one PRD 8.4 states outright — "The app must not
 * silently substitute another asset, expiry, or direction" — so it gets tests
 * that run without a database.
 */
import type { LiveStructure } from "@/lib/market/live";

/** Strike prices are 8-decimal on the book (`lib/market/live.ts`). */
const STRIKE_DECIMALS = 8;

/** The post's own structure columns, as `theses` stores them. */
export interface PostStructure {
	readonly expiryAt: Date | null;
	readonly isCall: boolean | null;
	readonly strikes: string[] | null;
	readonly strikeDecimals: number | null;
}

/**
 * C12-r2. Which part of the post's own structure this fill would not match, or
 * null when it matches. The post's columns are written by `publishPost` from the
 * same order snapshot the book produces, so the comparison is exact:
 *
 *  - `expiryAt` is a timestamp; `structure.expiry` is the order's unix expiry;
 *  - `isCall` is the same boolean on both sides;
 *  - `strikes` are integer strings at `strikeDecimals`, and the book's strikes
 *    are 8-decimal integers (`STRIKE_DECIMALS`), so they are rescaled before
 *    they are compared. A post with unreadable strikes fails closed.
 *
 * `theses_structure_all_or_nothing` guarantees that a post with an
 * `underlyingAsset` has every one of these columns, so `null` here means the
 * value could not be READ, never that the post omitted it.
 */
export function instrumentMismatch(
	thesis: PostStructure,
	structure: Pick<LiveStructure, "expiry" | "isCall" | "strikes">,
): "expiry" | "direction" | "strikes" | null {
	const expirySeconds = thesis.expiryAt === null ? null : Math.floor(thesis.expiryAt.getTime() / 1000);
	if (expirySeconds === null || BigInt(expirySeconds) !== structure.expiry) return "expiry";
	if (thesis.isCall === null || thesis.isCall !== structure.isCall) return "direction";
	const scaled = postStrikesUsd8(thesis.strikes, thesis.strikeDecimals);
	if (scaled === null) return "strikes";
	const live = [...structure.strikes].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
	if (scaled.length !== live.length) return "strikes";
	if (scaled.some((strike, index) => strike !== live[index])) return "strikes";
	return null;
}

/** A post's stored strikes as ascending 8-decimal integers, or null if unreadable. */
export function postStrikesUsd8(strikes: string[] | null, decimals: number | null): bigint[] | null {
	if (strikes === null || strikes.length === 0 || decimals === null) return null;
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
	const values: bigint[] = [];
	for (const strike of strikes) {
		if (!/^\d+$/.test(strike)) return null;
		const raw = BigInt(strike);
		// Rescale to the book's 8 decimals. A post stored at a FINER scale whose
		// value does not survive the rescale is a genuine mismatch, not a rounding
		// detail, so the division must be exact.
		if (decimals >= STRIKE_DECIMALS) {
			const divisor = 10n ** BigInt(decimals - STRIKE_DECIMALS);
			if (raw % divisor !== 0n) return null;
			values.push(raw / divisor);
		} else {
			values.push(raw * 10n ** BigInt(STRIKE_DECIMALS - decimals));
		}
	}
	return values.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
}
