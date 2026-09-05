import "server-only";
import { z } from "zod";
import { env } from "@nuts/env/server";

/**
 * The "From Farcaster" rail: REAL casts read from Neynar, kept visibly separate
 * from this app's own thesis feed so a visitor never mistakes one for the other.
 *
 * ── What is verified, and what is not ────────────────────────────────────────
 * Every path, header and field name below was read out of the PUBLISHED Neynar
 * OpenAPI on 2026-09-06 (see citations per item). No API key exists in this
 * repository, so the request has NEVER BEEN EXERCISED against the live service:
 * the shape is documented-but-unexercised, and this module is written to survive
 * being wrong about it — a payload that does not match yields "no rail", never a
 * crash and never a fabricated cast.
 *
 *   host + path   GET https://api.neynar.com/v2/farcaster/feed/channels/
 *                 docs.neynar.com/reference/fetch-feed-by-channel-ids.md
 *                 (OpenAPI `servers: [{url: https://api.neynar.com}]`,
 *                  `paths: /v2/farcaster/feed/channels/`, method `get`)
 *   auth header   `x-api-key` — same document, `components.securitySchemes`:
 *                 `ApiKeyAuth: {in: header, name: x-api-key, type: apiKey}`
 *   parameters    `channel_ids` required, "Comma separated list of up to 10
 *                 channel IDs e.g. neynar,farcaster"; `limit` default 25,
 *                 minimum 1, maximum 100; `with_replies` default false;
 *                 `with_recasts` default true; `cursor`; `viewer_fid`;
 *                 `members_only` default true
 *   response      `FeedResponse { casts: Cast[], next: NextCursor }`
 *                 (both `required`)
 *   Cast          `required` includes `hash`, `text`, `timestamp`, `author`,
 *                 `channel` (channel is `nullable: true`)
 *   author (User) `required` lists `object, fid, username, custody_address,
 *                 registered_at, profile, follower_count, following_count,
 *                 verifications, auth_addresses, verified_addresses,
 *                 verified_accounts`. `display_name` and `pfp_url` are BOTH
 *                 `nullable: true` and BOTH ABSENT from `required` — so neither
 *                 may be assumed present, and the parser below does not.
 *
 * ── Rate and credit budget ──────────────────────────────────────────────────
 * docs.neynar.com/reference/what-are-the-rate-limits-on-neynar-apis.md:
 * the Free plan is 600 RPM / 10 RPS per API endpoint and 1000 RPM across all
 * APIs, with 10M credits/month. Only `GET v2/farcaster/cast/search` carries a
 * lower per-endpoint limit (120 RPM on Free); this endpoint falls under "All
 * others" at 600 RPM. The per-request CREDIT cost is NOT published anywhere in
 * the documentation — see the module's TODO-OWNER on the revalidate window.
 */

/**
 * TODO-OWNER: which Farcaster channels the rail reads.
 *
 * Both ids VERIFIED to exist 2026-09-06 against Farcaster's own public channel
 * directory (GET https://api.farcaster.xyz/v2/all-channels, 16,452 channels):
 * "base" (Base, 481,220 followers) and "farcaster" (Farcaster, 445,607). That
 * check is a one-off by hand, not something this code performs — a channel id
 * that stops existing produces an empty or rejected response, which renders the
 * honest line below, never an invented cast.
 */
export const FARCASTER_CHANNEL_IDS = "base,farcaster";

/** TODO-OWNER: how many casts the rail shows. The mockup's rail draws five rows. */
export const FARCASTER_RAIL_LIMIT = 5;

/**
 * TODO-OWNER: cache window, in seconds, for the Neynar read.
 *
 * Chosen against the MEASURED rate limit and against an UNMEASURABLE credit
 * cost. 300 s is one request per five minutes per cache key — 0.2 RPM against a
 * documented 600 RPM per-endpoint ceiling, roughly 8,640 requests in a 30-day
 * month. Neynar publishes no per-request credit price for this endpoint, so the
 * share of the 10M monthly credits this spends CANNOT be computed here; the
 * number is deliberately conservative rather than tuned.
 */
export const FARCASTER_REVALIDATE_SECONDS = 300;

/** TODO-OWNER: how much of a cast body the rail prints before it is cut. */
export const FARCASTER_TEXT_LIMIT = 180;

const NEYNAR_SEARCH_URL = "https://api.neynar.com/v2/farcaster/cast/search";

/**
 * What the rail asks Farcaster for.
 *
 * MEASURED 2026-09-06 against the live API, because the obvious approaches are
 * worse and it is not obvious why:
 *
 *   channel feed `base,farcaster`  five casts, five of them airdrop, whitelist
 *                                  and referral spam — including a Honeygain
 *                                  affiliate link.
 *   channel feed `base` alone      six casts, all by ONE account, and all reply
 *                                  fragments ("i guess so yeah").
 *   `mode=semantic`                on-topic but ancient: 470-511 days old, from
 *                                  accounts with 0-23 followers. `sort_type`
 *                                  made no difference to it.
 *   `mode=hybrid` + `after:`       fresh AND on-topic. What this uses.
 *
 * The query is TWO WORDS on purpose. Hybrid mode ANDs its terms, and the live
 * shelf is thin: "options" alone returns 40 casts, "options implied volatility"
 * returns 9, and "options implied volatility strike" returns ZERO. Adding a
 * fifth term does not sharpen the rail, it empties it.
 *
 * Of the queries that return anything, this one is the only one whose results
 * survive `citesALevel` — "options trading calls puts" returns 40 casts and
 * NONE of them clear it, because that phrasing retrieves explainers rather than
 * observations. TODO-OWNER: the query text.
 */
export const FARCASTER_SEARCH_QUERY = "implied volatility";

/**
 * How far back the rail will look, as an `after:YYYY-MM-DD` operator.
 *
 * MEASURED: the newest genuine options post found in any probe was 30 days old.
 * Farcaster does not carry a live options conversation, so a 7-day window
 * returns nothing at all. TODO-OWNER: the window.
 */
export const FARCASTER_MAX_AGE_DAYS = 45;

/**
 * A follower floor, which is NOT the main defence and cannot be.
 *
 * MEASURED: the bot farm posting "Unlock the power of crypto options!" across
 * @xyeuli, @q1uiver15, @bl4de22, @tr4nquil19, @p1oneer2, @m4ximum and
 * @c0rridor16 carries 325-404 followers each, while the one genuinely useful
 * post in the whole probe (@preetrank, "$BTC upside implied volatility has hit
 * a record low of 23%") carries 162. A follower floor set high enough to catch
 * the farm would delete the good post first. It is set low, to drop only the
 * 0-2 follower throwaway accounts, and `dedupeKey` does the real work.
 * TODO-OWNER: the floor.
 */
export const FARCASTER_MIN_FOLLOWERS = 25;

/**
 * How many casts to ask for per rail slot. The filters reject most of a page —
 * one probe returned seven casts that collapsed to a single row after dedupe —
 * so asking for exactly five would reliably render one. TODO-OWNER.
 */
const OVERFETCH = 8;

/**
 * Characters of normalised text compared when collapsing duplicates.
 *
 * MEASURED: 28, not 40. The farm's shared opening "Unlock the power of crypto
 * options!" normalises to 33 characters, so a 40-character key reaches past it
 * into the part they vary ("…Learn about calls", "…Understand the Greeks") and
 * every copy hashes differently. 28 stops inside the shared run.
 */
const DEDUPE_PREFIX = 28;

/**
 * The farm's signature is that many accounts post the SAME sentence. Normalise
 * away case, punctuation and spacing, then key on the opening; the seven
 * "Unlock the power of crypto options!" casts collapse to one.
 */
export function dedupeKey(text: string): string {
	return text
		.toLowerCase()
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[^a-z0-9 ]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, DEDUPE_PREFIX);
}

/**
 * Does this cast cite a level?
 *
 * This is the filter that actually works, and it is worth saying why. Farcaster
 * has very little genuine options conversation, and what fills the query
 * instead is a content farm writing explainers: "Calls give you the right to
 * buy, Puts the right to sell." Those accounts carry 325-445 followers — MORE
 * than the one genuinely useful poster found in any probe — so no follower
 * floor separates them.
 *
 * What separates them is that a market observation cites something: a $TICKER,
 * a percentage, or a price. "$BTC upside implied volatility has hit a record
 * low of 23%" cites; "Unlock the power of crypto options!" does not.
 *
 * MEASURED 2026-09-06: on `implied volatility` this keeps 2 of 5 and both are
 * real; on `options trading calls puts` it keeps 0 of 40, which is the correct
 * answer for a page containing no observations at all.
 */
export function citesALevel(text: string): boolean {
	return /\$[A-Za-z]{2,6}\b|\d+(?:[.,]\d+)?\s?%|\$\s?\d/.test(text);
}

/**
 * Choose what the rail shows, in the order Neynar returned it.
 *
 * Pure, so the rules are testable without the network. Every rejection is one
 * the live probes justified: replies read as fragments, throwaway accounts are
 * noise, stale casts misrepresent a feed as live, repeated text is a farm, and
 * one author filling the rail is what the `base` channel did.
 */
export function selectRelevantCasts(
	casts: readonly FarcasterRailCast[],
	options: { limit?: number; minFollowers?: number; maxAgeDays?: number; now?: Date } = {},
): FarcasterRailCast[] {
	const limit = options.limit ?? FARCASTER_RAIL_LIMIT;
	const minFollowers = options.minFollowers ?? FARCASTER_MIN_FOLLOWERS;
	const maxAgeDays = options.maxAgeDays ?? FARCASTER_MAX_AGE_DAYS;
	const now = options.now ?? new Date();
	const cutoff = now.getTime() - maxAgeDays * 86_400_000;

	const seenText = new Set<string>();
	const seenAuthor = new Set<string>();
	const kept: FarcasterRailCast[] = [];

	for (const cast of casts) {
		if (kept.length >= limit) break;
		if (cast.isReply) continue;
		// An absent follower count is not evidence of a real account.
		if ((cast.followerCount ?? 0) < minFollowers) continue;
		// An unreadable or absent timestamp cannot be shown as recent.
		const at = cast.timestamp === null ? Number.NaN : Date.parse(cast.timestamp);
		if (!Number.isFinite(at) || at < cutoff) continue;
		// An explainer is not a market observation; see citesALevel.
		if (!citesALevel(cast.text)) continue;
		const key = dedupeKey(cast.text);
		if (key === "" || seenText.has(key)) continue;
		const author = cast.username.toLowerCase();
		if (seenAuthor.has(author)) continue;
		seenText.add(key);
		seenAuthor.add(author);
		kept.push(cast);
	}
	return kept;
}

/** `after:` takes a plain date. Built from the window above, in UTC. */
export function searchQueryFor(now: Date = new Date(), maxAgeDays = FARCASTER_MAX_AGE_DAYS): string {
	const since = new Date(now.getTime() - maxAgeDays * 86_400_000);
	const day = since.toISOString().slice(0, 10);
	return `${FARCASTER_SEARCH_QUERY} after:${day}`;
}

const NEYNAR_CHANNEL_FEED_URL = "https://api.neynar.com/v2/farcaster/feed/channels/";

/** A cast reduced to exactly what the rail draws. Nothing here is derived or guessed. */
export interface FarcasterRailCast {
	/** Cast hash, e.g. `0x029f7cce…`. Used as the React key and to build the link. */
	hash: string;
	/** `author.username`, printed as `@username`. Required by the Cast schema's author. */
	username: string;
	/** `author.display_name`; null whenever the field is absent or null upstream. */
	displayName: string | null;
	/** `author.pfp_url`, kept ONLY when it is an https URL. Null otherwise. */
	avatarUrl: string | null;
	/** `text`, already truncated. */
	text: string;
	/** `channel.id` when the cast carries a channel; null otherwise. */
	channelId: string | null;
	/** ISO 8601 `timestamp`; null when absent. Used only to age it out. */
	timestamp: string | null;
	/** True when `parent_hash` is set — a reply, shown out of its thread. */
	isReply: boolean;
	/** `author.follower_count`; null when absent. */
	followerCount: number | null;
	/** Permalink to the cast, or null when the hash is too short to build one. */
	url: string | null;
}

/**
 * Three states, deliberately distinct. An unreadable feed is NEVER presented as
 * an empty one — the same rule `lib/thetanuts/orders.ts` follows for the order
 * book.
 */
export type FarcasterRailState =
	| { status: "unconfigured" }
	| { status: "unavailable"; detail: string }
	| { status: "ready"; casts: FarcasterRailCast[] };

/**
 * Only the fields the rail draws, each with the nullability the published schema
 * gives it. Unnamed fields are left alone, so a payload that GAINS fields still
 * parses. `passthrough` is not needed: zod objects strip unknown keys by default.
 */
const castSchema = z.object({
	hash: z.string().min(1),
	text: z.string(),
	// ISO 8601 upstream. Kept nullish: a row without one simply cannot be
	// age-filtered, and is dropped rather than assumed recent.
	timestamp: z.string().nullish(),
	// Present and non-null only on replies. A reply out of its thread reads as a
	// fragment ("i guess so yeah"), which is what the channel feed was full of.
	parent_hash: z.string().nullish(),
	author: z.object({
		username: z.string().min(1),
		// nullable AND not required upstream, so `nullish`, not `nullable`.
		display_name: z.string().nullish(),
		pfp_url: z.string().nullish(),
		follower_count: z.number().nullish(),
	}),
	channel: z.object({ id: z.string().min(1) }).nullish(),
});

/** `FeedResponse` requires both keys; only `casts` is read, and only as a list. */
const feedResponseSchema = z.union([
	// Cast search nests its page under `result`; the channel feed does not.
	z.object({ result: z.object({ casts: z.array(z.unknown()) }) }).transform((v) => v.result),
	z.object({ casts: z.array(z.unknown()) }),
]);

/**
 * Cut a cast body to `limit` characters on a word boundary where one is close
 * enough, appending a single ellipsis. Pure; the ellipsis is not counted against
 * `limit`, so the returned string is at most `limit + 1` characters.
 */
export function truncateCastText(text: string, limit = FARCASTER_TEXT_LIMIT): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (limit <= 0) return "";
	if (collapsed.length <= limit) return collapsed;
	const cut = collapsed.slice(0, limit);
	const lastSpace = cut.lastIndexOf(" ");
	// Only honour a word boundary in the last quarter of the window; otherwise a
	// long unbroken token would collapse the line to almost nothing.
	const body = lastSpace > limit * 0.75 ? cut.slice(0, lastSpace) : cut;
	return `${body.trimEnd()}…`;
}

/**
 * Permalink to a cast on Farcaster.
 *
 * The host is `farcaster.xyz`, NOT `warpcast.com`: Neynar's own current guide
 * (docs.neynar.com/docs/how-to-get-cast-information-from-url.md) states "Cast url
 * doesn't contain all the full cast hash value, it usually looks like this:
 * `https://farcaster.xyz/dwr.eth/0x029f7cce`" — a `0x` prefix plus eight hex
 * characters, i.e. the first ten characters of the full hash. `warpcast.com` is
 * the pre-rename host and appears in that page only in a legacy comment.
 *
 * Returns null rather than a broken link when the hash is not long enough.
 */
export function farcasterCastUrl(username: string, hash: string): string | null {
	if (!/^0x[0-9a-fA-F]{8,}$/.test(hash)) return null;
	if (username.trim() === "") return null;
	return `https://farcaster.xyz/${encodeURIComponent(username)}/${hash.slice(0, 10)}`;
}

/**
 * Keep a profile picture URL only when it is https. An http URL would be blocked
 * as mixed content and a `data:`/`javascript:` value has no business in `src`.
 */
function httpsAvatar(raw: string | null | undefined): string | null {
	if (typeof raw !== "string" || raw === "") return null;
	try {
		return new URL(raw).protocol === "https:" ? raw : null;
	} catch {
		return null;
	}
}

/**
 * Validate one row and reduce it to what the rail draws. Returns null for a row
 * this code cannot read, so one malformed cast costs one row rather than the
 * whole rail.
 */
export function parseCast(row: unknown, limit = FARCASTER_TEXT_LIMIT): FarcasterRailCast | null {
	const parsed = castSchema.safeParse(row);
	if (!parsed.success) return null;
	const { hash, text, timestamp, parent_hash, author, channel } = parsed.data;
	const body = truncateCastText(text, limit);
	// A cast with no readable body is not something to show a visitor.
	if (body === "") return null;
	return {
		hash,
		username: author.username,
		displayName: author.display_name ?? null,
		avatarUrl: httpsAvatar(author.pfp_url),
		text: body,
		channelId: channel?.id ?? null,
		url: farcasterCastUrl(author.username, hash),
		timestamp: timestamp ?? null,
		isReply: typeof parent_hash === "string" && parent_hash !== "",
		followerCount: typeof author.follower_count === "number" ? author.follower_count : null,
	};
}

/**
 * Turn a decoded response body into rail state.
 *
 * A body that is not a `{casts: [...]}` object is a shape this adapter does not
 * understand, and a page of rows that ALL fail validation is a feed this adapter
 * cannot read. Both are `unavailable`, never an empty rail: reporting them as
 * "no casts" would read to a visitor as "Farcaster is quiet", which is a claim
 * this code has no evidence for.
 */
export function parseFarcasterFeed(
	body: unknown,
	options: {
		limit?: number;
		textLimit?: number;
		minFollowers?: number;
		maxAgeDays?: number;
		now?: Date;
	} = {},
): FarcasterRailState {
	const parsed = feedResponseSchema.safeParse(body);
	if (!parsed.success) {
		return {
			status: "unavailable",
			detail: "The Neynar response carried no `casts` array, so the Farcaster feed could not be read.",
		};
	}
	const rows = parsed.data.casts;
	// Parse everything first, THEN choose. Rejecting during the parse would
	// conflate "this row is not the documented shape" with "this row is a bot",
	// and only the first of those means the feed could not be read.
	const understood: FarcasterRailCast[] = [];
	for (const row of rows) {
		const cast = parseCast(row, options.textLimit ?? FARCASTER_TEXT_LIMIT);
		if (cast !== null) understood.push(cast);
	}
	if (understood.length === 0 && rows.length > 0) {
		return {
			status: "unavailable",
			detail: `Neynar returned ${rows.length} cast(s) and none matched the documented shape, so the Farcaster feed could not be read.`,
		};
	}
	const casts = selectRelevantCasts(understood, {
		limit: options.limit ?? FARCASTER_RAIL_LIMIT,
		minFollowers: options.minFollowers,
		maxAgeDays: options.maxAgeDays,
		now: options.now,
	});
	// Understood the answer, and nothing in it clears the bar. That is a quiet
	// result, not a broken one, and the rail says so rather than claiming a
	// failure it did not have.
	return { status: "ready", casts };
}

/**
 * The whole read, with the key passed in so the unconfigured path is testable
 * without a live environment. `farcasterRail()` below is what pages call.
 *
 * No key means no request is made at all — the rail says it is not configured
 * and nothing reaches the network.
 */
export async function loadFarcasterRail(
	apiKey: string | undefined,
	options: {
		limit?: number;
		query?: string;
		now?: Date;
		minFollowers?: number;
		maxAgeDays?: number;
		fetchImpl?: typeof fetch;
	} = {},
): Promise<FarcasterRailState> {
	if (apiKey === undefined || apiKey.trim() === "") return { status: "unconfigured" };
	const limit = options.limit ?? FARCASTER_RAIL_LIMIT;
	const url = new URL(NEYNAR_SEARCH_URL);
	url.searchParams.set("q", options.query ?? searchQueryFor(options.now));
	// hybrid, not semantic: semantic returned 470-511 day old casts from
	// 0-follower accounts, and ignored sort_type. See FARCASTER_SEARCH_QUERY.
	url.searchParams.set("mode", "hybrid");
	// Over-fetch, because the filters below reject most of a page: the seven
	// casts of one probe collapsed to one after dedupe. Documented bounds are
	// 1..100, and cast search is the one endpoint rate-limited at 120 RPM.
	url.searchParams.set("limit", String(Math.min(Math.max(limit * OVERFETCH, 1), 100)));

	const request = options.fetchImpl ?? fetch;
	let response: Response;
	try {
		response = await request(url, {
			headers: { "x-api-key": apiKey, accept: "application/json" },
			// Server-side cache window; see FARCASTER_REVALIDATE_SECONDS.
			next: { revalidate: FARCASTER_REVALIDATE_SECONDS },
		});
	} catch (error) {
		return {
			status: "unavailable",
			detail: `Neynar could not be reached (${error instanceof Error ? error.message : String(error)}), so the Farcaster feed could not be read.`,
		};
	}
	if (!response.ok) {
		// The status is deliberately not shown to visitors; the rail copy is fixed.
		return { status: "unavailable", detail: `Neynar returned HTTP ${response.status}.` };
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { status: "unavailable", detail: "Neynar returned a body that is not JSON." };
	}
	return parseFarcasterFeed(body, {
		limit,
		minFollowers: options.minFollowers,
		maxAgeDays: options.maxAgeDays,
		now: options.now,
	});
}

/**
 * What a page calls. The key is server-only and never reaches the browser: this
 * module is `server-only` and the rail component receives already-reduced casts.
 */
export async function farcasterRail(limit = FARCASTER_RAIL_LIMIT): Promise<FarcasterRailState> {
	return loadFarcasterRail(env.NEYNAR_API_KEY, { limit });
}
