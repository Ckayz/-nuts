/** Access preformatted display values; domain parsing lives only in display.ts. */
import type { DisplayAmount } from "./display-types";
export function usd(value: DisplayAmount) { return value.usd; }
export function usd2(value: DisplayAmount) { return value.usd2; }
export function signedUsd(value: DisplayAmount | undefined) { return value?.signed ?? "—"; }
export function pnlClass(value: DisplayAmount | undefined) { return value?.pnlClass ?? ""; }

/**
 * m5 (user-flow re-walk 2026-09-06). `/portfolio` printed "1 Followers".
 *
 * `Creator.followers` is already the FORMATTED string (`Intl.NumberFormat`), so
 * the count has to be read back from the unformatted `followerCount` to know
 * whether the noun is singular. Grouping separators mean only the raw 1 is
 * singular — "1,001 Followers" is right.
 *
 * The singular is the existing word with its plural "s" removed; no new copy.
 */
export function countLabel(count: number | undefined, plural: string, singular: string): string {
	return count === 1 ? singular : plural;
}
