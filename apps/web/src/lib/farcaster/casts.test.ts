import { expect, test } from "bun:test";

// `@nuts/env/server` validates at import time, so the two required keys are
// supplied before the module under test pulls it in. Same idiom as
// `lib/thetanuts/orders.test.ts`.
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

const {
	FARCASTER_REVALIDATE_SECONDS,
	FARCASTER_TEXT_LIMIT,
	farcasterCastUrl,
	loadFarcasterRail,
	parseCast,
	parseFarcasterFeed,
	truncateCastText,
} = await import("./casts");

/**
 * One cast in the shape the published Neynar OpenAPI documents
 * (docs.neynar.com/reference/fetch-feed-by-channel-ids.md). It is a FIXTURE FOR
 * THE PARSER, not sample content for the UI: nothing in this file reaches a page.
 */
function cast(overrides: Record<string, unknown> = {}) {
	return {
		object: "cast",
		hash: "0x029f7cce1234567890abcdef",
		thread_hash: "0x029f7cce1234567890abcdef",
		parent_hash: null,
		text: "Basis on the Sep expiry is back to 4.1%.",
		timestamp: "2026-09-06T01:00:00.000Z",
		author: {
			object: "user",
			fid: 3,
			username: "dwr.eth",
			display_name: "Dan Romero",
			pfp_url: "https://example.invalid/pfp.png",
			follower_count: 1234,
		},
		channel: { object: "channel_dehydrated", id: "base", name: "Base" },
		embeds: [],
		reactions: { likes_count: 1, recasts_count: 0 },
		replies: { count: 0 },
		...overrides,
	};
}

// ── truncation ──────────────────────────────────────────────────────────────

test("short text is returned whole, with no ellipsis", () => {
	expect(truncateCastText("gm", 180)).toBe("gm");
	expect(truncateCastText("")).toBe("");
});

test("whitespace is collapsed so a multi-line cast stays one rail line", () => {
	expect(truncateCastText("one\n\ntwo   three\t four")).toBe("one two three four");
});

test("long text is cut on a word boundary and ends in exactly one ellipsis", () => {
	const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
	const cut = truncateCastText(text, 30);
	expect(cut.endsWith("…")).toBe(true);
	expect(cut.split("…").length - 1).toBe(1);
	// The boundary is honoured, so no half word survives.
	expect(text.startsWith(cut.slice(0, -1))).toBe(true);
	expect(cut.slice(0, -1).trimEnd()).toBe(cut.slice(0, -1));
	expect(cut.length).toBeLessThanOrEqual(31);
});

test("an unbroken token is cut mid-word rather than collapsing the line", () => {
	const cut = truncateCastText("a".repeat(400), 20);
	expect(cut).toBe(`${"a".repeat(20)}…`);
});

test("a boundary in the first quarter of the window is ignored", () => {
	// "hi" then a 60-character token: honouring the space would leave "hi…".
	const cut = truncateCastText(`hi ${"z".repeat(60)}`, 40);
	expect(cut.startsWith("hi zzz")).toBe(true);
});

test("a zero or negative limit yields nothing rather than a bare ellipsis", () => {
	expect(truncateCastText("anything", 0)).toBe("");
	expect(truncateCastText("anything", -5)).toBe("");
});

test("the default limit is the exported one", () => {
	const text = "b".repeat(FARCASTER_TEXT_LIMIT + 50);
	expect(truncateCastText(text)).toBe(`${"b".repeat(FARCASTER_TEXT_LIMIT)}…`);
});

// ── permalink ───────────────────────────────────────────────────────────────

test("a cast permalink is farcaster.xyz/<username>/<0x + 8 hex>", () => {
	expect(farcasterCastUrl("dwr.eth", "0x029f7cce1234567890abcdef")).toBe(
		"https://farcaster.xyz/dwr.eth/0x029f7cce",
	);
});

test("a username is percent-encoded into the path", () => {
	expect(farcasterCastUrl("a/b", "0x029f7cce")).toBe("https://farcaster.xyz/a%2Fb/0x029f7cce");
});

test("an unusable hash or username yields no link rather than a broken one", () => {
	expect(farcasterCastUrl("dwr.eth", "0x029f")).toBeNull();
	expect(farcasterCastUrl("dwr.eth", "029f7cce12")).toBeNull();
	expect(farcasterCastUrl("dwr.eth", "0xzzzzzzzz")).toBeNull();
	expect(farcasterCastUrl("  ", "0x029f7cce")).toBeNull();
});

// ── one cast ────────────────────────────────────────────────────────────────

test("a documented cast maps to exactly what the rail draws", () => {
	expect(parseCast(cast())).toEqual({
		hash: "0x029f7cce1234567890abcdef",
		username: "dwr.eth",
		displayName: "Dan Romero",
		avatarUrl: "https://example.invalid/pfp.png",
		text: "Basis on the Sep expiry is back to 4.1%.",
		channelId: "base",
		url: "https://farcaster.xyz/dwr.eth/0x029f7cce",
		timestamp: "2026-09-06T01:00:00.000Z",
		isReply: false,
		followerCount: 1234,
	});
});

test("display_name and pfp_url are optional AND nullable, as the schema says", () => {
	const missing = parseCast(cast({ author: { username: "nobody" } }));
	expect(missing?.displayName).toBeNull();
	expect(missing?.avatarUrl).toBeNull();
	const nulled = parseCast(cast({ author: { username: "nobody", display_name: null, pfp_url: null } }));
	expect(nulled?.displayName).toBeNull();
	expect(nulled?.avatarUrl).toBeNull();
});

test("a non-https avatar is dropped rather than rendered", () => {
	for (const pfp of ["http://example.invalid/a.png", "javascript:alert(1)", "data:image/png;base64,AA", "", "not a url"]) {
		expect(parseCast(cast({ author: { username: "u", pfp_url: pfp } }))?.avatarUrl).toBeNull();
	}
});

test("a missing channel is null, not invented", () => {
	expect(parseCast(cast({ channel: null }))?.channelId).toBeNull();
	expect(parseCast(cast({ channel: undefined }))?.channelId).toBeNull();
});

test("a row missing a required field is dropped, not defaulted", () => {
	expect(parseCast(cast({ hash: undefined }))).toBeNull();
	expect(parseCast(cast({ text: undefined }))).toBeNull();
	expect(parseCast(cast({ author: undefined }))).toBeNull();
	expect(parseCast(cast({ author: { display_name: "No handle" } }))).toBeNull();
	expect(parseCast(cast({ author: { username: "" } }))).toBeNull();
	expect(parseCast(cast({ text: 42 }))).toBeNull();
	expect(parseCast(null)).toBeNull();
	expect(parseCast("a string")).toBeNull();
});

test("a cast with no readable body is dropped", () => {
	expect(parseCast(cast({ text: "   \n  " }))).toBeNull();
});

// ── the page of casts ───────────────────────────────────────────────────────

test("a documented page yields ready casts, capped at the limit", () => {
	// Distinct authors and distinct bodies: three copies of one cast now collapse
	// to a single row by design, which `selectRelevantCasts` has its own tests for.
	const body = {
		casts: [
			cast(),
			cast({ hash: "0xabcdef0123456789", text: "Second, different body: $ETH at 12%.", author: { ...cast().author, username: "b.eth" } }),
			cast({ hash: "0x1111222233334444", text: "Third, different body: $SOL at 8%.", author: { ...cast().author, username: "c.eth" } }),
		],
		next: { cursor: null },
	};
	const state = parseFarcasterFeed(body, { limit: 2 });
	expect(state.status).toBe("ready");
	if (state.status !== "ready") throw new Error(state.status);
	expect(state.casts).toHaveLength(2);
	expect(state.casts.map((row) => row.hash)).toEqual(["0x029f7cce1234567890abcdef", "0xabcdef0123456789"]);
});

test("one malformed row costs one row, not the rail", () => {
	const state = parseFarcasterFeed({ casts: [{ nonsense: true }, cast()] });
	expect(state.status).toBe("ready");
	if (state.status !== "ready") throw new Error(state.status);
	expect(state.casts).toHaveLength(1);
});

test("a body with no casts array is UNAVAILABLE, never an empty rail", () => {
	for (const body of [null, undefined, 42, "{}", {}, { casts: null }, { casts: {} }, { result: {} }]) {
		const state = parseFarcasterFeed(body);
		expect(state.status).toBe("unavailable");
	}
});

test("a page whose every row is unreadable is UNAVAILABLE, never an empty rail", () => {
	const state = parseFarcasterFeed({ casts: [{ a: 1 }, { b: 2 }] });
	expect(state.status).toBe("unavailable");
	if (state.status !== "unavailable") throw new Error(state.status);
	expect(state.detail).toContain("2 cast(s)");
});

test("a genuinely empty page stays ready with no casts — that is a quiet channel", () => {
	expect(parseFarcasterFeed({ casts: [], next: { cursor: null } })).toEqual({ status: "ready", casts: [] });
});

// ── the read ────────────────────────────────────────────────────────────────

test("no key means UNCONFIGURED and no network call at all", async () => {
	for (const key of [undefined, "", "   "]) {
		const state = await loadFarcasterRail(key, {
			fetchImpl: (() => {
				throw new Error("the unconfigured path must never reach the network");
			}) as unknown as typeof fetch,
		});
		expect(state).toEqual({ status: "unconfigured" });
	}
});

test("a configured read sends the documented path, header and parameters", async () => {
	let seen: { url: URL; init: RequestInit } | null = null;
	const state = await loadFarcasterRail("test-key", {
		limit: 3,
		now: new Date("2026-09-06T02:00:00.000Z"),
		fetchImpl: (async (input: URL, init: RequestInit) => {
			seen = { url: input, init };
			return new Response(JSON.stringify({ casts: [cast()], next: { cursor: null } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch,
	});
	expect(state.status).toBe("ready");
	const call = seen as unknown as { url: URL; init: Record<string, unknown> };
	expect(call.url.origin + call.url.pathname).toBe("https://api.neynar.com/v2/farcaster/cast/search");
	// hybrid, never semantic: semantic returned 470-day-old casts in the probes.
	expect(call.url.searchParams.get("mode")).toBe("hybrid");
	// The query carries the product's own vocabulary and an `after:` window.
	expect(call.url.searchParams.get("q")).toContain("implied volatility");
	expect(call.url.searchParams.get("q")).toContain("after:2026-07-23");
	// Over-fetched, because the filters reject most of a page.
	expect(call.url.searchParams.get("limit")).toBe("24");
	expect((call.init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
	// The key must travel in the header only; a query string would be logged.
	expect(call.url.toString()).not.toContain("test-key");
	expect(call.init.next).toEqual({ revalidate: FARCASTER_REVALIDATE_SECONDS });
});

test("the documented limit bounds are respected", async () => {
	const limits: string[] = [];
	const capture = (async (input: URL) => {
		limits.push(input.searchParams.get("limit") ?? "");
		return new Response(JSON.stringify({ casts: [] }), { status: 200 });
	}) as unknown as typeof fetch;
	await loadFarcasterRail("k", { limit: 0, fetchImpl: capture });
	await loadFarcasterRail("k", { limit: 5000, fetchImpl: capture });
	expect(limits).toEqual(["1", "100"]);
});

test("a transport failure is UNAVAILABLE and carries the reason", async () => {
	const state = await loadFarcasterRail("k", {
		fetchImpl: (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as unknown as typeof fetch,
	});
	expect(state.status).toBe("unavailable");
	if (state.status !== "unavailable") throw new Error(state.status);
	expect(state.detail).toContain("ENOTFOUND");
});

test("a non-2xx response is UNAVAILABLE, never an empty rail", async () => {
	for (const status of [401, 402, 429, 500]) {
		const state = await loadFarcasterRail("k", {
			fetchImpl: (() => Promise.resolve(new Response("nope", { status }))) as unknown as typeof fetch,
		});
		expect(state.status).toBe("unavailable");
		if (state.status !== "unavailable") throw new Error(state.status);
		expect(state.detail).toContain(String(status));
	}
});

test("a body that is not JSON is UNAVAILABLE, never an empty rail", async () => {
	const state = await loadFarcasterRail("k", {
		fetchImpl: (() =>
			Promise.resolve(new Response("<html>rate limited</html>", { status: 200 }))) as unknown as typeof fetch,
	});
	expect(state.status).toBe("unavailable");
});

test("the revalidate window stays well inside the documented 600 RPM ceiling", () => {
	// docs.neynar.com/reference/what-are-the-rate-limits-on-neynar-apis.md:
	// Free plan is 600 RPM per API endpoint for "All others".
	expect(60 / FARCASTER_REVALIDATE_SECONDS).toBeLessThan(600);
	expect(FARCASTER_REVALIDATE_SECONDS).toBeGreaterThan(0);
});

// ── choosing what to show ───────────────────────────────────────────────────
//
// Every rule below exists because a live probe on 2026-09-06 showed the rail
// filling with something a visitor should not be shown. The fixtures are the
// shapes actually observed, not invented ones.

import { citesALevel, dedupeKey, searchQueryFor, selectRelevantCasts } from "./casts";
import type { FarcasterRailCast } from "./casts";

const NOW = new Date("2026-09-06T00:00:00.000Z");

function railCast(overrides: Partial<FarcasterRailCast> = {}): FarcasterRailCast {
	return {
		hash: "0xaaaaaaaa1111",
		username: "preetrank",
		displayName: "preetrank",
		avatarUrl: null,
		text: "$BTC upside implied volatility has hit a record low of 23%.",
		channelId: null,
		url: "https://farcaster.xyz/preetrank/0xaaaaaaaa",
		timestamp: "2026-09-01T00:00:00.000Z",
		isReply: false,
		followerCount: 162,
		...overrides,
	};
}

test("the bot farm collapses to one row however many accounts post it", () => {
	// MEASURED: seven accounts (@xyeuli, @q1uiver15, @bl4de22, @tr4nquil19,
	// @p1oneer2, @m4ximum, @c0rridor16) posting the same sentence, 325-404
	// followers each, all within 27 days. A follower floor cannot catch this.
	const farm = ["xyeuli", "q1uiver15", "bl4de22", "tr4nquil19", "p1oneer2", "m4ximum", "c0rridor16"].map(
		(username, i) =>
			railCast({
				username,
				hash: `0xbbbb${i}111`,
				followerCount: 325 + i * 10,
				// Cites nothing, but the farm test is about DEDUPE; give it a level so
			// this test fails only if dedupe fails.
			text: "$BTC unlock the power of crypto options, calls give you the right to buy at 23%",
			}),
	);
	expect(selectRelevantCasts(farm, { now: NOW })).toHaveLength(1);
});

test("the farm does not crowd out the genuine post it outranks on followers", () => {
	const farm = ["xyeuli", "q1uiver15"].map((username, i) =>
		railCast({
			username,
			hash: `0xcccc${i}111`,
			followerCount: 400,
			text: "$BTC unlock the power of crypto options, calls give you the right to buy at 23%",
		}),
	);
	const kept = selectRelevantCasts([...farm, railCast()], { now: NOW });
	expect(kept.map((c) => c.username)).toEqual(["xyeuli", "preetrank"]);
});

test("replies are dropped, because out of their thread they are fragments", () => {
	// MEASURED: the `base` channel returned "i guess so yeah cause i never saw
	// anyone higher than us" as a top-level rail row.
	expect(selectRelevantCasts([railCast({ isReply: true })], { now: NOW })).toEqual([]);
});

test("one author cannot fill the rail", () => {
	// MEASURED: six of six casts from the `base` channel were by @road.
	const road = [0, 1, 2, 3].map((i) =>
		railCast({ username: "road", hash: `0xdddd${i}111`, followerCount: 6984, text: `$BTC distinct body number ${i} at 23%` }),
	);
	expect(selectRelevantCasts(road, { now: NOW })).toHaveLength(1);
});

test("stale casts are dropped, so a quiet feed never looks live", () => {
	// MEASURED: semantic mode returned casts 470-511 days old.
	const old = railCast({ timestamp: "2025-05-01T00:00:00.000Z" });
	expect(selectRelevantCasts([old], { now: NOW })).toEqual([]);
	expect(selectRelevantCasts([old], { now: NOW, maxAgeDays: 1000 })).toHaveLength(1);
});

test("a cast with no usable timestamp is dropped rather than assumed recent", () => {
	expect(selectRelevantCasts([railCast({ timestamp: null })], { now: NOW })).toEqual([]);
	expect(selectRelevantCasts([railCast({ timestamp: "not a date" })], { now: NOW })).toEqual([]);
});

test("throwaway accounts are dropped, and a missing count is not a pass", () => {
	// MEASURED: semantic mode's on-topic hits carried 0, 2, 10 and 23 followers.
	expect(selectRelevantCasts([railCast({ followerCount: 2 })], { now: NOW })).toEqual([]);
	expect(selectRelevantCasts([railCast({ followerCount: null })], { now: NOW })).toEqual([]);
	expect(selectRelevantCasts([railCast({ followerCount: 162 })], { now: NOW })).toHaveLength(1);
});

test("the limit is honoured and input order is preserved", () => {
	const many = [0, 1, 2, 3, 4, 5].map((i) =>
		railCast({ username: `user${i}`, hash: `0xeeee${i}111`, text: `$ETH body number ${i} at 12%` }),
	);
	const kept = selectRelevantCasts(many, { now: NOW, limit: 3 });
	expect(kept.map((c) => c.username)).toEqual(["user0", "user1", "user2"]);
});

test("dedupeKey ignores case, punctuation, spacing and links", () => {
	expect(dedupeKey("Unlock the POWER of crypto options!!!")).toBe(dedupeKey("unlock  the power of crypto options"));
	expect(dedupeKey("claim here https://spam.invalid/a?ref=1")).toBe(dedupeKey("claim here https://spam.invalid/b?ref=2"));
	expect(dedupeKey("   ")).toBe("");
});

test("the query names this product's vocabulary and a dated window", () => {
	const q = searchQueryFor(new Date("2026-09-06T00:00:00.000Z"), 45);
	expect(q).toContain("implied volatility");
	expect(q).toContain("after:2026-07-23");
	// Two terms, not five. Hybrid ANDs them and a fifth term returned zero casts
	// against the live API; the width of this query is a measurement, not taste.
	expect(q.replace(/ after:.*$/, "").split(" ")).toHaveLength(2);
});

test("an understood but empty page is a quiet rail, not a broken one", () => {
	// Cast search nests its page under `result`. An empty page means the query
	// matched nothing — which is a true statement about Farcaster, not a failure
	// to read it, and the rail must not claim otherwise.
	for (const body of [{ casts: [] }, { result: { casts: [] } }]) {
		expect(parseFarcasterFeed(body)).toEqual({ status: "ready", casts: [] });
	}
});

test("a cast-search page is read through its `result` wrapper", () => {
	const state = parseFarcasterFeed(
		{ result: { casts: [cast()], next: { cursor: null } } },
		{ now: new Date("2026-09-06T02:00:00.000Z") },
	);
	expect(state.status).toBe("ready");
	if (state.status !== "ready") throw new Error(state.status);
	expect(state.casts).toHaveLength(1);
	expect(state.casts[0]?.username).toBe("dwr.eth");
});

test("an explainer is rejected and an observation is kept", () => {
	// MEASURED 2026-09-06. Left column is the content farm, 325-445 followers
	// each; right column is the genuine posting the farm outranks.
	expect(citesALevel("Unlock the power of crypto options! Calls give you the right to buy.")).toBe(false);
	expect(citesALevel("Dive into crypto options! Calls give you the right to buy, puts the right to sell.")).toBe(false);
	expect(citesALevel("$BTC upside implied volatility has hit a record low of 23%")).toBe(true);
	expect(citesALevel("Bitcoin's annualized 30-day volatility sits at 41.2%")).toBe(true);
	expect(citesALevel("the 78,000 put is $79.40")).toBe(true);
});

test("the rail drops a page that is entirely explainers", () => {
	// MEASURED: `options trading calls puts` returns 40 casts, none of which
	// cite anything. An empty rail is the correct answer to that page.
	const farm = [0, 1, 2].map((i) =>
		railCast({
			username: `farm${i}`,
			hash: `0xffff${i}111`,
			followerCount: 400,
			text: `Unlock the power of crypto options! Variant number ${"x".repeat(i)} for traders.`,
		}),
	);
	expect(selectRelevantCasts(farm, { now: NOW })).toEqual([]);
});

test("the farm's shared opening collapses even when the tails differ", () => {
	// MEASURED: this is why DEDUPE_PREFIX is 28 and not 40.
	const a = "Unlock the power of crypto options! Learn about calls and puts. $BTC 23%";
	const b = "Unlock the power of crypto options! Understand the Greeks. $BTC 23%";
	expect(dedupeKey(a)).toBe(dedupeKey(b));
});
