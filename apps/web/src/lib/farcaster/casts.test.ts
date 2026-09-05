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
		text: "Basis on the Sep expiry finally looks sane again.",
		timestamp: "2026-09-06T01:00:00.000Z",
		author: {
			object: "user",
			fid: 3,
			username: "dwr.eth",
			display_name: "Dan Romero",
			pfp_url: "https://example.invalid/pfp.png",
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
		text: "Basis on the Sep expiry finally looks sane again.",
		channelId: "base",
		url: "https://farcaster.xyz/dwr.eth/0x029f7cce",
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
	const body = { casts: [cast(), cast({ hash: "0xabcdef0123456789" }), cast({ hash: "0x1111222233334444" })], next: { cursor: null } };
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
	for (const body of [null, undefined, 42, "{}", {}, { casts: null }, { casts: {} }, { result: { casts: [] } }]) {
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
		channelIds: "base",
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
	expect(call.url.origin + call.url.pathname).toBe("https://api.neynar.com/v2/farcaster/feed/channels/");
	expect(call.url.searchParams.get("channel_ids")).toBe("base");
	expect(call.url.searchParams.get("limit")).toBe("3");
	expect(call.url.searchParams.get("with_replies")).toBe("false");
	expect(call.url.searchParams.get("with_recasts")).toBe("false");
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
