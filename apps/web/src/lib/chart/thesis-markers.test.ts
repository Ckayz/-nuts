import { expect, test } from "bun:test";
import { clusterMarkers, placeThesisMarkers, type MarkerThesis } from "./thesis-markers";
import type { Candle } from "./klines";

/** Four hourly candles, the shape the klines proxy returns. */
const H = 3600;
const T0 = 1788634800; // 2026-09-05T19:00:00Z
const candles: Candle[] = [0, 1, 2, 3].map((i) => ({
	time: T0 + i * H,
	open: 100 + i,
	high: 101 + i,
	low: 99 + i,
	close: 100.5 + i,
}));

function thesis(overrides: Partial<MarkerThesis> = {}): MarkerThesis {
	return {
		id: "t1",
		slug: "s1",
		createdAt: new Date((T0 + 30 * 60) * 1000).toISOString(), // 30 min into candle 0
		headline: "Basis looks sane again",
		handleLabel: "@alice",
		avatarSeed: "0xabc",
		direction: "bull",
		likes: 3,
		...overrides,
	};
}

test("a post is pinned to the candle it happened IN, not the nearest one", () => {
	// 10:59 belongs to the 10:00 candle. The 11:00 candle had not opened yet, so
	// placing it there would claim a timing the author never had.
	const late = thesis({ createdAt: new Date((T0 + 59 * 60) * 1000).toISOString() });
	const { markers } = placeThesisMarkers([late], candles);
	expect(markers).toHaveLength(1);
	expect(markers[0]?.time).toBe(T0);
	expect(markers[0]?.price).toBe(100.5);
});

test("the marker sits at that candle's close", () => {
	const second = thesis({ createdAt: new Date((T0 + H + 60) * 1000).toISOString() });
	const { markers } = placeThesisMarkers([second], candles);
	expect(markers[0]?.time).toBe(T0 + H);
	expect(markers[0]?.price).toBe(101.5);
});

test("posts outside the charted window are dropped and COUNTED, never clamped", () => {
	// Clamping an old post onto the first candle would put a call at a moment its
	// author never made it — the exact claim this feature exists to make.
	const old = thesis({ id: "old", createdAt: new Date((T0 - 10 * H) * 1000).toISOString() });
	const future = thesis({ id: "future", createdAt: new Date((T0 + 99 * H) * 1000).toISOString() });
	const inside = thesis({ id: "inside" });
	const placed = placeThesisMarkers([old, future, inside], candles);
	expect(placed.markers.map((m) => m.id)).toEqual(["inside"]);
	expect(placed.outsideWindow).toBe(2);
});

test("an unparseable timestamp is counted out, not placed at zero", () => {
	const bad = placeThesisMarkers([thesis({ createdAt: "not a date" })], candles);
	expect(bad.markers).toEqual([]);
	expect(bad.outsideWindow).toBe(1);
});

test("no candles means nothing can be placed, and every post is accounted for", () => {
	const placed = placeThesisMarkers([thesis(), thesis({ id: "t2" })], []);
	expect(placed.markers).toEqual([]);
	expect(placed.outsideWindow).toBe(2);
});

test("a post inside the newest candle still places", () => {
	// The last candle is open; a post made during it belongs to it.
	const now = thesis({ createdAt: new Date((T0 + 3 * H + 40 * 60) * 1000).toISOString() });
	const { markers, outsideWindow } = placeThesisMarkers([now], candles);
	expect(outsideWindow).toBe(0);
	expect(markers[0]?.time).toBe(T0 + 3 * H);
});

test("markers come back oldest first, so overlapping avatars stack in order", () => {
	const a = thesis({ id: "a", createdAt: new Date((T0 + 2 * H) * 1000).toISOString() });
	const b = thesis({ id: "b", createdAt: new Date((T0 + 1 * H) * 1000).toISOString() });
	const { markers } = placeThesisMarkers([a, b], candles);
	expect(markers.map((m) => m.id)).toEqual(["b", "a"]);
});

test("a busy hour clusters into one point instead of a pile of circles", () => {
	const one = thesis({ id: "one" });
	const two = thesis({ id: "two", createdAt: new Date((T0 + 45 * 60) * 1000).toISOString() });
	const later = thesis({ id: "later", createdAt: new Date((T0 + 2 * H) * 1000).toISOString() });
	const { markers } = placeThesisMarkers([one, two, later], candles);
	const clusters = clusterMarkers(markers);
	expect(clusters).toHaveLength(2);
	expect(clusters[0]?.theses.map((t) => t.id)).toEqual(["one", "two"]);
	expect(clusters[0]?.price).toBe(100.5);
	expect(clusters[1]?.theses.map((t) => t.id)).toEqual(["later"]);
});
