/**
 * Where each thesis sits on the price chart.
 *
 * fomo's signature idea, and the best one in their product: a post is drawn ON
 * the candles at the moment it was written, as the author's avatar, and hovering
 * it shows what they said. The social layer becomes part of the price rather
 * than a column beside it — you can see that somebody called the top before the
 * top, which is the whole claim this product makes.
 *
 * Pure. Given the theses and the candles, it decides which posts can be placed
 * and where; the component does the drawing.
 *
 * ── The rule that matters ───────────────────────────────────────────────────
 *
 * A thesis is placed ONLY when it falls inside the window the chart is showing.
 * The chart is one week of hourly candles, so an older post has no position on
 * it — and a post pinned to the first or last candle instead would claim a
 * timing its author never had. Those are dropped, and the caller is told how
 * many, so the UI can say "3 older theses are outside this window" rather than
 * silently under-reporting the conversation.
 */

import type { Candle } from "./klines";

/** What the marker layer needs from a thesis. */
export interface MarkerThesis {
	readonly id: string;
	readonly slug: string;
	/** ISO 8601, the moment it was posted. */
	readonly createdAt: string;
	readonly headline: string;
	readonly handleLabel: string;
	readonly avatarSeed: string;
	readonly direction: "bull" | "bear" | null;
	readonly likes: number;
}

export interface ThesisMarker extends MarkerThesis {
	/** The candle this post is pinned to, in UNIX seconds. */
	readonly time: number;
	/** That candle's close — where the marker sits vertically. */
	readonly price: number;
}

export interface MarkerPlacement {
	readonly markers: readonly ThesisMarker[];
	/** Posts that fall outside the charted window, and so cannot be placed. */
	readonly outsideWindow: number;
}

/**
 * Pin each thesis to the candle it happened in.
 *
 * Binary search for the last candle at or before the post's timestamp: a post
 * belongs to the hour it was written in, not to the nearest hour, which for a
 * post at 10:59 would be the 11:00 candle that had not opened yet.
 */
export function placeThesisMarkers(
	theses: readonly MarkerThesis[],
	candles: readonly Candle[],
): MarkerPlacement {
	if (candles.length === 0) return { markers: [], outsideWindow: theses.length };
	const first = candles[0];
	const last = candles[candles.length - 1];
	if (first === undefined || last === undefined) return { markers: [], outsideWindow: theses.length };

	const markers: ThesisMarker[] = [];
	let outsideWindow = 0;

	for (const thesis of theses) {
		const at = Date.parse(thesis.createdAt);
		if (!Number.isFinite(at)) {
			outsideWindow += 1;
			continue;
		}
		const seconds = Math.floor(at / 1000);
		// Before the window opens, or after the newest candle closes.
		if (seconds < first.time || seconds > last.time + candleSpacing(candles)) {
			outsideWindow += 1;
			continue;
		}
		const candle = candleAt(candles, seconds);
		if (candle === null) {
			outsideWindow += 1;
			continue;
		}
		markers.push({ ...thesis, time: candle.time, price: candle.close });
	}

	// Oldest first, so overlapping avatars stack in the order they were written.
	markers.sort((left, right) => left.time - right.time);
	return { markers, outsideWindow };
}

/** The gap between candles, from the data rather than assumed to be an hour. */
function candleSpacing(candles: readonly Candle[]): number {
	const first = candles[0];
	const second = candles[1];
	if (first === undefined || second === undefined) return 0;
	return Math.max(0, second.time - first.time);
}

/** The last candle at or before `seconds`. Binary search; candles are sorted. */
function candleAt(candles: readonly Candle[], seconds: number): Candle | null {
	let low = 0;
	let high = candles.length - 1;
	let found: Candle | null = null;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const candle = candles[middle];
		if (candle === undefined) break;
		if (candle.time <= seconds) {
			found = candle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return found;
}

/**
 * Group markers that would overlap, so a busy hour draws one avatar with a
 * count rather than a pile of unreadable circles.
 *
 * Keyed by candle, because that is the resolution the chart can actually
 * distinguish. TODO-OWNER: whether a busy hour shows a count or fans out.
 */
export interface MarkerCluster {
	readonly time: number;
	readonly price: number;
	readonly theses: readonly ThesisMarker[];
}

export function clusterMarkers(markers: readonly ThesisMarker[]): MarkerCluster[] {
	const byTime = new Map<number, ThesisMarker[]>();
	for (const marker of markers) {
		const bucket = byTime.get(marker.time);
		if (bucket === undefined) byTime.set(marker.time, [marker]);
		else bucket.push(marker);
	}
	return [...byTime.entries()]
		.map(([time, theses]) => ({ time, price: theses[0]?.price ?? 0, theses }))
		.sort((left, right) => left.time - right.time);
}
