import { sumDecimals, usdDecimalOrNull } from "../data/decimal";
import { FILLED_POSITION_STATUSES } from "../data/constants";
import { SOCIAL_PUBLIC_STATUSES } from "./guards";
export interface RankingPosition {
	userId: string; status: string; confirmedAt: Date | null;
	estimatedPnlUsd: string | null; finalPnlUsd: string | null;
}
/** TODO-OWNER: provisional 1W confirmed-position window and P&L formula.
 * Missing/NaN components make a total unavailable, not an invented zero.
 */
export function rankCreators(rows: readonly RankingPosition[], now: Date, window: "1W") {
	const since = now.getTime() - (window === "1W" ? 7 * 24 * 60 * 60 * 1000 : 0);
	const groups = new Map<string, (string | null)[]>();
	for (const row of rows) {
		if (!FILLED_POSITION_STATUSES.some(status => status === row.status) || !row.confirmedAt || row.confirmedAt.getTime() < since || row.confirmedAt > now) continue;
		const values = groups.get(row.userId) ?? [];
		values.push(usdDecimalOrNull(row.status === "settled" ? row.finalPnlUsd : row.estimatedPnlUsd));
		groups.set(row.userId, values);
	}
	return [...groups].map(([userId, values]) => ({ userId, pnl: values.some(v => v === null) ? null : sumDecimals(values.filter((v): v is string => v !== null)) }))
		.sort((a, b) => comparePnl(a.pnl, b.pnl) || a.userId.localeCompare(b.userId));
}
function comparePnl(a: string | null, b: string | null): number {
	if (a === null) return b === null ? 0 : 1;
	if (b === null) return -1;
	const negativeB = b.startsWith("-") ? b.slice(1) : `-${b}`;
	const difference = sumDecimals([a, negativeB]);
	return /^-?0(?:\.0+)?$/.test(difference) ? 0 : difference.startsWith("-") ? 1 : -1;
}
export interface RankingThesis {
	id: string; status: string; likes: number; comments: number; participants: number;
	expiryAt: Date | null; settledAt: Date | null;
}
/** TODO-OWNER: provisional engagement sum; no time threshold or weighting. */
export function rankTheses<T extends RankingThesis>(rows: readonly T[], kind: "trending" | "ending" | "settled"): T[] {
	return rows.filter(row => kind === "trending" ? SOCIAL_PUBLIC_STATUSES.some(s => s === row.status) : kind === "ending" ? row.status === "open" && row.expiryAt !== null : row.status === "settled")
		.sort((a, b) => {
			// TODO-OWNER: ending = expiry ascending; settled = settlement descending.
			const difference = kind === "trending" ? (b.likes + b.comments + b.participants) - (a.likes + a.comments + a.participants)
				: kind === "ending" ? a.expiryAt!.getTime() - b.expiryAt!.getTime()
				: (b.settledAt?.getTime() ?? -Infinity) - (a.settledAt?.getTime() ?? -Infinity);
			return difference || a.id.localeCompare(b.id);
		});
}
