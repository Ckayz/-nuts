import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FarcasterRailState } from "./casts";

// `@nuts/env/server` validates at import time, so the two required keys are
// supplied before the module under test pulls it in. Same idiom as
// `lib/thetanuts/orders.test.ts`.
process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

const {
	FARCASTER_REVALIDATE_SECONDS,
	FARCASTER_TEXT_LIMIT,
	FARCASTER_TIMEOUT_MS,
	FARCASTER_ASSET_COUNT,
	FARCASTER_SEARCH_QUERY,
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

/**
 * B-C2 (lane B confirming pass). The read had no deadline at all, and
 * `app/page.tsx` awaits it in the same `Promise.all` as the feed's own reads,
 * so a stalled Neynar connection held the whole page open. Measured before the
 * fix, both of these were STILL PENDING after 1,500 ms:
 *
 *   fetchImpl returns a never-resolving promise      -> "still pending"
 *   OK headers, then a never-resolving json()        -> "still pending"
 *
 * `timeoutMs` is injected here only to keep the suite fast; production uses
 * `FARCASTER_TIMEOUT_MS`. Each test guards itself with a far longer timer, so a
 * regression fails loudly instead of hanging the run.
 */
async function withGuard(promise: Promise<FarcasterRailState>, guardMs: number): Promise<FarcasterRailState> {
	return Promise.race([
		promise,
		new Promise<FarcasterRailState>((resolve) =>
			setTimeout(() => resolve({ status: "unavailable", detail: "TEST GUARD: still pending" }), guardMs),
		),
	]);
}

test("B-C2: a request that never answers becomes UNAVAILABLE, it does not hang the page", async () => {
	const state = await withGuard(
		loadFarcasterRail("k", {
			queries: ["q"],
			timeoutMs: 25,
			fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
		}),
		2_000,
	);
	expect(state.status).toBe("unavailable");
	if (state.status !== "unavailable") throw new Error(state.status);
	expect(state.detail).toBe("Neynar did not answer within 25 ms.");
});

test("B-C2: headers that arrive with a body that never does is the same stall, and is bounded too", async () => {
	const state = await withGuard(
		loadFarcasterRail("k", {
			queries: ["q"],
			timeoutMs: 25,
			fetchImpl: (async () => ({
				ok: true,
				status: 200,
				json: () => new Promise(() => {}),
			})) as unknown as typeof fetch,
		}),
		2_000,
	);
	expect(state.status).toBe("unavailable");
	if (state.status !== "unavailable") throw new Error(state.status);
	expect(state.detail).toBe("Neynar did not answer within 25 ms.");
});

test("B-C2: the deadline is carried on the request as well as raced against it", async () => {
	let seen: RequestInit | null = null;
	await loadFarcasterRail("k", {
		queries: ["q"],
		timeoutMs: 500,
		fetchImpl: (async (_input: URL, init: RequestInit) => {
			seen = init;
			return new Response(JSON.stringify({ casts: [] }), { status: 200 });
		}) as unknown as typeof fetch,
	});
	const init = seen as unknown as { signal?: AbortSignal };
	expect(init.signal).toBeInstanceOf(AbortSignal);
	expect(init.signal?.aborted).toBe(false);
});

test("B-C2: one stalled query does not sink the queries that answered", async () => {
	const state = await withGuard(
		loadFarcasterRail("k", {
			queries: ["stalls", "answers"],
			timeoutMs: 25,
			now: new Date("2026-09-06T02:00:00.000Z"),
			fetchImpl: (async (input: URL) =>
				input.searchParams.get("q") === "stalls"
					? await new Promise<Response>(() => {})
					: new Response(
							JSON.stringify({
								casts: [cast({ text: "$BTC implied volatility is 23% here.", timestamp: "2026-09-05T02:00:00.000Z" })],
							}),
							{ status: 200 },
						)) as unknown as typeof fetch,
		}),
		2_000,
	);
	expect(state.status).toBe("ready");
	if (state.status !== "ready") throw new Error(state.status);
	expect(state.casts).toHaveLength(1);
});

test("B-C2: the production default is a real, finite deadline", () => {
	expect(Number.isFinite(FARCASTER_TIMEOUT_MS)).toBe(true);
	expect(FARCASTER_TIMEOUT_MS).toBeGreaterThan(0);
	// And the read uses it when no test override is supplied.
	expect(readFileSync(new URL("./casts.ts", import.meta.url), "utf8")).toContain(
		"const timeoutMs = options.timeoutMs ?? FARCASTER_TIMEOUT_MS;",
	);
});

test("B-C4: the request budget is computed against cast search's 120 RPM, not 600", () => {
	// docs.neynar.com/reference/what-are-the-rate-limits-on-neynar-apis.md:
	// Free plan is 600 RPM per endpoint for "All others", and `cast/search` — the
	// endpoint this module calls — is the ONE exception at 120 RPM. The comment
	// this test replaced cited the 600 figure for the wrong endpoint.
	const requestsPerRailRead = FARCASTER_ASSET_COUNT * 2; // two terms per asset
	const perMinute = (requestsPerRailRead * 60) / FARCASTER_REVALIDATE_SECONDS;
	expect(FARCASTER_REVALIDATE_SECONDS).toBeGreaterThan(0);
	expect(perMinute).toBeCloseTo(0.8, 10);
	expect(perMinute).toBeLessThan(120);
});

test("B-C4: the module documents the endpoint it actually calls, and nothing dead", async () => {
	const source = readFileSync(new URL("./casts.ts", import.meta.url), "utf8");
	// The header used to document the channel feed while the code called search.
	expect(source).toContain("GET https://api.neynar.com/v2/farcaster/cast/search");
	// The dead channel constants are gone (grep before: definition only).
	expect(source).not.toContain('export const FARCASTER_CHANNEL_IDS');
	expect(source).not.toContain("NEYNAR_CHANNEL_FEED_URL");
	// B-C3: the two eligibility rules that decide which casts vanish are tagged.
	const dedupe = source.slice(0, source.indexOf("const DEDUPE_PREFIX"));
	expect(dedupe.slice(dedupe.lastIndexOf("/**"))).toContain("TODO-OWNER");
	const cites = source.slice(0, source.indexOf("export function citesALevel"));
	expect(cites.slice(cites.lastIndexOf("/**"))).toContain("TODO-OWNER");
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

// ── several queries, one rail ───────────────────────────────────────────────

import { searchQueriesFor } from "./casts";

test("each query names ONE asset and carries exactly two terms", () => {
	// MEASURED 2026-09-06: hybrid mode ANDs its terms. `BTC ETH volatility`
	// returns ZERO casts, and so does any third term. This is the guard.
	const queries = searchQueriesFor(["BTC", "ETH"], new Date("2026-09-06T00:00:00.000Z"));
	expect(queries).toEqual([
		"BTC volatility after:2026-07-23",
		"BTC price after:2026-07-23",
		"ETH volatility after:2026-07-23",
		"ETH price after:2026-07-23",
	]);
	for (const query of queries) {
		expect(query.replace(/ after:.*$/, "").split(" ")).toHaveLength(2);
	}
});

test("an empty asset list falls back to the generic query, never to no query", () => {
	// The book being unreadable, or mock mode having no book, is not a reason
	// for the rail to go blank.
	expect(searchQueriesFor([], new Date("2026-09-06T00:00:00.000Z"))).toEqual([
		"implied volatility after:2026-07-23",
	]);
	expect(searchQueriesFor(["   ", ""], new Date("2026-09-06T00:00:00.000Z"))).toHaveLength(1);
});

test("dedupe and one-per-author apply ACROSS queries, not within each", () => {
	// `BTC price` and `BTC volatility` overlap heavily; filtering each page on
	// its own would let the same cast and the same author through twice.
	const shared = cast();
	const key = "test-key";
	let calls = 0;
	const both = (async () => {
		calls += 1;
		return new Response(JSON.stringify({ result: { casts: [shared], next: { cursor: null } } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return loadFarcasterRail(key, {
		assets: ["BTC"],
		now: new Date("2026-09-06T02:00:00.000Z"),
		fetchImpl: both,
	}).then((state) => {
		expect(calls).toBe(2); // one per term
		expect(state.status).toBe("ready");
		if (state.status !== "ready") throw new Error(state.status);
		expect(state.casts).toHaveLength(1); // not two
	});
});

test("one failing query still yields the other's casts", async () => {
	let n = 0;
	const flaky = (async () => {
		n += 1;
		if (n === 1) throw new Error("network down");
		return new Response(JSON.stringify({ result: { casts: [cast()], next: { cursor: null } } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
	const state = await loadFarcasterRail("k", {
		assets: ["BTC"],
		now: new Date("2026-09-06T02:00:00.000Z"),
		fetchImpl: flaky,
	});
	// A partial answer is still a true one.
	expect(state.status).toBe("ready");
	if (state.status !== "ready") throw new Error(state.status);
	expect(state.casts).toHaveLength(1);
});

test("only when EVERY query fails is the feed unreadable", async () => {
	const dead = (async () => {
		throw new Error("network down");
	}) as unknown as typeof fetch;
	const state = await loadFarcasterRail("k", {
		assets: ["BTC"],
		now: new Date("2026-09-06T02:00:00.000Z"),
		fetchImpl: dead,
	});
	expect(state.status).toBe("unavailable");
});

// ── merging several pages ───────────────────────────────────────────────────

import { interleavePages } from "./casts";

test("pages are round-robined, so a second market is not starved", () => {
	// MEASURED 2026-09-06: concatenating filled all five rail slots with BTC and
	// left ETH — a third of the live book — with none.
	const btc = [0, 1, 2, 3, 4].map((i) => railCast({ hash: `0xbtc${i}`, username: `btc${i}` }));
	const eth = [0, 1].map((i) => railCast({ hash: `0xeth${i}`, username: `eth${i}` }));
	expect(interleavePages([btc, eth]).map((c) => c.hash)).toEqual([
		"0xbtc0", "0xeth0", "0xbtc1", "0xeth1", "0xbtc2", "0xbtc3", "0xbtc4",
	]);
});

test("a cast returned by two queries takes one position, not two", () => {
	const shared = railCast({ hash: "0xsame", username: "both" });
	const merged = interleavePages([[shared], [shared]]);
	expect(merged).toHaveLength(1);
});

test("a short page yields its turn rather than holding a slot", () => {
	// No per-asset quota: an asset with nothing worth showing does not reserve a
	// row for a worse cast.
	const merged = interleavePages([[railCast({ hash: "0xa", username: "a" })], [], [railCast({ hash: "0xb", username: "b" })]]);
	expect(merged.map((c) => c.hash)).toEqual(["0xa", "0xb"]);
	expect(interleavePages([])).toEqual([]);
	expect(interleavePages([[], []])).toEqual([]);
});

// ── farcasterRail: the key is checked before anything is read ────────────────

import { env } from "@nuts/env/server";
import { farcasterRail } from "./casts";

/**
 * B-P4-1 (one-shot review pass 4). `farcasterRail` used to `await` the order
 * book — `getAvailableAssets()`, a live network read — and only then hand the
 * key to `loadFarcasterRail`, which returns `unconfigured` without it. So a
 * deployment with no `NEYNAR_API_KEY`, and every mock-mode render, paid for a
 * book read whose result was thrown away, on a path the Neynar timeout never
 * covered.
 *
 * The asset reader is injected rather than mocked: `mock.module` is
 * process-wide (measured by fold F-C) and would leak into every other file in
 * the run.
 */
test("no Neynar key means the order book is never read", async () => {
	// The premise of this test: this process really has no key, so the branch
	// under test is the one the real `env` takes.
	expect(env.NEYNAR_API_KEY ?? "").toBe("");
	let reads = 0;
	const state = await farcasterRail(5, {
		readAssets: async () => {
			reads += 1;
			return ["BTC"];
		},
	});
	expect(state.status).toBe("unconfigured");
	expect(reads).toBe(0);
});

/**
 * The other half of B-P4-1: when there IS a key the read happens, but bounded.
 * A book that never answers must not hold the render open — the rail falls back
 * to no assets, which `searchQueriesFor` answers with the single generic query.
 */
test("a hanging order book is bounded and the rail still runs with no assets", async () => {
	const urls: string[] = [];
	const fetchImpl = (async (input: string | URL | Request) => {
		urls.push(String(input));
		return new Response(JSON.stringify({ result: { casts: [] } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;

	const started = Date.now();
	const state = await farcasterRail(5, {
		apiKey: "test-key-not-a-real-neynar-key",
		readAssets: () => new Promise<readonly string[]>(() => {}),
		assetTimeoutMs: 50,
		fetchImpl,
	});
	const elapsed = Date.now() - started;

	expect(state.status).toBe("ready");
	// `assets: []` — exactly one query, the generic one, with no asset term.
	expect(urls).toHaveLength(1);
	const query = new URL(urls[0] ?? "").searchParams.get("q") ?? "";
	expect(query).toContain(FARCASTER_SEARCH_QUERY);
	// Bounded by `assetTimeoutMs`, not by the reader (which never resolves).
	expect(elapsed).toBeLessThan(FARCASTER_TIMEOUT_MS);
});
