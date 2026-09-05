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
 * B-C4 / CL-4: this block used to document the CHANNEL FEED
 * (`/v2/farcaster/feed/channels/`), which the code stopped calling when the rail
 * moved to cast search, along with a `FARCASTER_CHANNEL_IDS` constant nothing
 * read. It now documents the endpoint the code actually calls.
 *
 *   host + path   GET https://api.neynar.com/v2/farcaster/cast/search
 *                 docs.neynar.com/reference/search-casts.md
 *                 (OpenAPI `servers: [{url: https://api.neynar.com}]`,
 *                  `paths: /v2/farcaster/cast/search`, method `get`)
 *                 — the URL this module builds; see NEYNAR_SEARCH_URL.
 *   auth header   `x-api-key` — same document, `components.securitySchemes`:
 *                 `ApiKeyAuth: {in: header, name: x-api-key, type: apiKey}`
 *   parameters    `q` (the search text), `mode` and `limit` (1..100) are the
 *                 three this module sends; their VALUES were chosen from live
 *                 probes, recorded on FARCASTER_SEARCH_QUERY and ASSET_TERMS.
 *   response      the page arrives nested under `result` — `{ result: { casts:
 *                 Cast[] } }` — which is why `feedResponseSchema` accepts BOTH
 *                 that shape and a bare `{ casts: [...] }`.
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
 * APIs, with 10M credits/month. `GET v2/farcaster/cast/search` — the endpoint
 * this module calls — is the ONE endpoint carrying a LOWER per-endpoint limit:
 * 120 RPM on Free. The budget is therefore computed against 120, not the 600
 * this comment used to cite.
 *
 * Recomputed for 120 RPM: one rail read issues FARCASTER_ASSET_COUNT × 2
 * requests (two terms per asset, see ASSET_TERMS), i.e. 4 today, once per
 * FARCASTER_REVALIDATE_SECONDS = 300 s per cache key. That is 0.8 requests per
 * minute against a 120 RPM ceiling — 0.67% of it — and about 34,560 requests in
 * a 30-day month. The per-request CREDIT cost is NOT published anywhere in the
 * documentation, so the share of the 10M monthly credits CANNOT be computed
 * here; see the TODO-OWNER on the revalidate window.
 */

/** TODO-OWNER: how many casts the rail shows. The mockup's rail draws five rows. */
export const FARCASTER_RAIL_LIMIT = 5;

/**
 * TODO-OWNER: cache window, in seconds, for the Neynar read.
 *
 * Chosen against the MEASURED rate limit and against an UNMEASURABLE credit
 * cost. B-C4: the ceiling that applies is cast search's 120 RPM, not the 600
 * RPM "All others" figure this comment used to cite. 300 s is one rail read per
 * five minutes per cache key, and one rail read is FARCASTER_ASSET_COUNT × 2
 * requests (4 today) — 0.8 RPM against 120 RPM, roughly 34,560 requests in a
 * 30-day month. Neynar publishes no per-request credit price for this endpoint,
 * so the share of the 10M monthly credits this spends CANNOT be computed here;
 * the number is deliberately conservative rather than tuned.
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
 * The two things asked about each asset, and why there are two.
 *
 * MEASURED 2026-09-06, each with the `after:` window and the filters below:
 *
 *   BTC volatility  40 raw -> 5 kept, 0-8 days     BTC price   40 -> 5, 1-4 days
 *   ETH volatility  40 raw -> 5 kept, 14-22 days   ETH price   40 -> 5, 4-6 days
 *   SOL volatility   0 raw -> 0                    SOL price   40 -> 5, 5-13 days
 *   AVAX volatility  0 raw -> 0                    AVAX price   9 -> 1
 *   XRP volatility   0 raw -> 0                    XRP price    1 -> 1
 *
 * `volatility` carries the better content — it is what surfaced an actual Base
 * options quote ("$ETH at $2,281 — Covered call ($2,300): 71% APR") — but it
 * returns NOTHING for SOL, AVAX or XRP. `price` returns something for all six
 * live assets. The asset list is derived from the book, so tomorrow's deepest
 * market may be one of those; asking both is what keeps the rail from going
 * empty on that day. TODO-OWNER: the two terms.
 */
const ASSET_TERMS = ["volatility", "price"] as const;

/**
 * How many markets the rail follows. Two, per the owner: the two deepest are
 * 74.6% of the live book. Each asset costs two search requests.
 * TODO-OWNER: how many markets the rail should follow.
 */
export const FARCASTER_ASSET_COUNT = 2;

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
 * TODO-OWNER: how long the rail waits for Neynar before giving up, in ms.
 *
 * B-C2 (lane B confirming pass). The read had NO deadline of any kind, and the
 * feed page awaits it in the same `Promise.all` as its own database reads
 * (`app/page.tsx`), so a stalled Neynar connection held the whole feed open
 * with nothing on screen. Measured before the fix, with an injected
 * never-resolving `fetchImpl` and with OK headers plus a never-resolving body:
 * both were still pending after 1,500 ms and would have stayed pending forever.
 *
 * The number is PROVISIONAL and picked to be defensible, not tuned: the rail is
 * a secondary panel, the four searches run in parallel so one timeout is the
 * whole added ceiling, and a serverless function's own budget is single-digit
 * seconds — 3 s leaves the page's own reads the rest of it. Nothing was
 * measured about Neynar's real latency (no API key in this repository), so
 * treat this as a bound, not an estimate.
 */
export const FARCASTER_TIMEOUT_MS = 3_000;

/**
 * Characters of normalised text compared when collapsing duplicates.
 *
 * TODO-OWNER: the number. B-C3 — this is a SELECTION RULE, not an
 * implementation detail: it decides which casts vanish from the rail, so it is
 * the owner's to set even though a measurement suggested it. A measurement is
 * evidence for a number, never approval of it.
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
 *
 * TODO-OWNER: the rule itself — the $TICKER / percentage / price formula below.
 * B-C3 — it is the strictest filter in the module, and it is what decides which
 * casts a visitor never sees. The measurement above is evidence for the rule,
 * not approval of it.
 */
export function citesALevel(text: string): boolean {
	return /\$[A-Za-z]{2,6}\b|\d+(?:[.,]\d+)?\s?%|\$\s?\d/.test(text);
}

/**
 * Round-robin the pages: first cast of each query, then the second of each.
 *
 * MEASURED 2026-09-06: concatenating the pages instead filled all five rail
 * slots with BTC and left ETH — the second-deepest market, a third of the book
 * — with none, because BTC's page is returned first and is never short. The
 * rail is supposed to reflect the markets this product trades, so it must not
 * be a queue.
 *
 * Deduped on `hash` here so a cast returned by two queries cannot consume two
 * positions before `selectRelevantCasts` ever sees it. No per-asset QUOTA is
 * imposed: an asset with nothing worth showing yields its turn rather than
 * holding a slot open for a worse cast.
 */
export function interleavePages(pages: readonly (readonly FarcasterRailCast[])[]): FarcasterRailCast[] {
	const merged: FarcasterRailCast[] = [];
	const seen = new Set<string>();
	const deepest = pages.reduce((max, page) => Math.max(max, page.length), 0);
	for (let rank = 0; rank < deepest; rank++) {
		for (const page of pages) {
			const cast = page[rank];
			if (cast === undefined || seen.has(cast.hash)) continue;
			seen.add(cast.hash);
			merged.push(cast);
		}
	}
	return merged;
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

/**
 * One query per asset per term — never a combined one.
 *
 * MEASURED: hybrid mode ANDs its terms, so `BTC ETH volatility` returns ZERO
 * casts, as does any third term. Each query here is therefore exactly two words
 * plus the dated window, and asking about two assets means four requests.
 *
 * An empty asset list falls back to the generic query rather than emitting
 * none: the book being unreadable is not a reason for the rail to go blank, and
 * "implied volatility" is already proven to return real casts.
 */
export function searchQueriesFor(
	assets: readonly string[],
	now: Date = new Date(),
	maxAgeDays = FARCASTER_MAX_AGE_DAYS,
): string[] {
	const since = new Date(now.getTime() - maxAgeDays * 86_400_000);
	const day = since.toISOString().slice(0, 10);
	const clean = assets.map((asset) => asset.trim()).filter((asset) => asset !== "");
	if (clean.length === 0) return [searchQueryFor(now, maxAgeDays)];
	return clean.flatMap((asset) => ASSET_TERMS.map((term) => `${asset} ${term} after:${day}`));
}


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
 * One response page, understood but NOT yet chosen from.
 *
 * Split out because the rail now issues several queries and the dedupe and
 * one-cast-per-author rules have to apply ACROSS them: filtering each page on
 * its own would let `BTC price` and `BTC volatility` each contribute the same
 * cast, and the same author twice.
 */
export function readCastPage(
	body: unknown,
	textLimit = FARCASTER_TEXT_LIMIT,
): { ok: true; casts: FarcasterRailCast[] } | { ok: false; detail: string } {
	const parsed = feedResponseSchema.safeParse(body);
	if (!parsed.success) {
		return { ok: false, detail: "The Neynar response carried no `casts` array, so the Farcaster feed could not be read." };
	}
	const rows = parsed.data.casts;
	const understood: FarcasterRailCast[] = [];
	for (const row of rows) {
		const cast = parseCast(row, textLimit);
		if (cast !== null) understood.push(cast);
	}
	if (understood.length === 0 && rows.length > 0) {
		return {
			ok: false,
			detail: `Neynar returned ${rows.length} cast(s) and none matched the documented shape, so the Farcaster feed could not be read.`,
		};
	}
	return { ok: true, casts: understood };
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
/** One search request. Returns the page it understood, or why it could not. */
async function fetchOnePage(
	apiKey: string,
	query: string,
	limit: number,
	request: typeof fetch,
	timeoutMs: number,
): Promise<{ ok: true; casts: FarcasterRailCast[] } | { ok: false; detail: string }> {
	const url = new URL(NEYNAR_SEARCH_URL);
	url.searchParams.set("q", query);
	// hybrid, not semantic: semantic returned 470-511 day old casts from
	// 0-follower accounts, and ignored sort_type. See FARCASTER_SEARCH_QUERY.
	url.searchParams.set("mode", "hybrid");
	// Over-fetch, because the filters reject most of a page: one probe's seven
	// casts collapsed to one after dedupe. Documented bounds are 1..100, and
	// cast search is the one endpoint rate-limited at 120 RPM.
	url.searchParams.set("limit", String(Math.min(Math.max(limit * OVERFETCH, 1), 100)));

	// One deadline for the WHOLE exchange, headers and body alike. A response
	// whose headers arrive and whose body never does is the same stall to the
	// page as a connection that never answers, and only the body read below
	// puts the signal in front of it — `Response.text()` takes no signal of its
	// own, so it is raced against the same one.
	//
	// NOT VERIFIED: Next.js documents that passing a signal opts a fetch out of
	// per-render MEMOIZATION (node_modules/next/dist/docs/01-app/03-api-reference/
	// 04-functions/fetch.md), which it states is separate from the persistent
	// `next: { revalidate }` cache. Whether the data cache still applies here
	// was not measured — there is no API key in this repository. Memoization
	// itself is worth nothing to this module: every query is a different URL and
	// the rail is read once per render.
	const signal = AbortSignal.timeout(timeoutMs);
	const timedOut = () => `Neynar did not answer within ${timeoutMs} ms.`;

	// The signal is passed to the transport AND raced against, on purpose. The
	// signal alone only bounds a transport that honours it; the race bounds this
	// function whatever the transport does, which is what the page needs.
	let response: Response;
	try {
		response = await Promise.race([
			request(url, {
				headers: { "x-api-key": apiKey, accept: "application/json" },
				// Server-side cache window; see FARCASTER_REVALIDATE_SECONDS.
				next: { revalidate: FARCASTER_REVALIDATE_SECONDS },
				signal,
			}),
			aborted(signal),
		]);
	} catch (error) {
		if (signal.aborted) return { ok: false, detail: timedOut() };
		return { ok: false, detail: `Neynar could not be reached (${error instanceof Error ? error.message : String(error)}).` };
	}
	if (!response.ok) return { ok: false, detail: `Neynar returned HTTP ${response.status}.` };
	let body: unknown;
	try {
		body = await Promise.race([response.json(), aborted(signal)]);
	} catch {
		if (signal.aborted) return { ok: false, detail: timedOut() };
		return { ok: false, detail: "Neynar returned a body that is not JSON." };
	}
	return readCastPage(body);
}

/**
 * A promise that never resolves and rejects when `signal` aborts.
 *
 * Used only inside `Promise.race`, which attaches a handler to it, so its
 * rejection is always handled even when the body wins. `AbortSignal.timeout`'s
 * timer does not hold the event loop open, so a losing race costs nothing.
 */
function aborted(signal: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

/**
 * The whole read, with the key passed in so the unconfigured path is testable
 * without a live environment. `farcasterRail()` below is what pages call.
 *
 * No key means no request is made at all. Otherwise one request per query —
 * two per asset, because hybrid mode ANDs its terms and a combined query
 * returns zero — issued together, merged in query order, and filtered ONCE
 * over the merged pool so dedupe and one-cast-per-author apply across queries.
 *
 * A query that fails does not sink the rail: a partial answer is still a true
 * one. Only when EVERY query fails is the feed genuinely unreadable.
 *
 * Cost: 4 requests per 300s revalidate is 0.8/min against a documented 120 RPM
 * cast-search cap. Per-request credit price is NOT published by Neynar, so the
 * share of the monthly allowance is not estimated here.
 */
export async function loadFarcasterRail(
	apiKey: string | undefined,
	options: {
		limit?: number;
		assets?: readonly string[];
		queries?: readonly string[];
		now?: Date;
		minFollowers?: number;
		maxAgeDays?: number;
		fetchImpl?: typeof fetch;
		/** Only tests pass this; production uses `FARCASTER_TIMEOUT_MS`. */
		timeoutMs?: number;
	} = {},
): Promise<FarcasterRailState> {
	if (apiKey === undefined || apiKey.trim() === "") return { status: "unconfigured" };
	const limit = options.limit ?? FARCASTER_RAIL_LIMIT;
	const queries = options.queries ?? searchQueriesFor(options.assets ?? [], options.now, options.maxAgeDays);
	const request = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? FARCASTER_TIMEOUT_MS;

	const pages = await Promise.all(queries.map((query) => fetchOnePage(apiKey, query, limit, request, timeoutMs)));

	const understood: FarcasterRailCast[][] = [];
	let lastFailure: string | null = null;
	for (const page of pages) {
		if (page.ok) understood.push(page.casts);
		else lastFailure = page.detail;
	}
	// Interleaved, not concatenated: see interleavePages.
	const merged = interleavePages(understood);
	const anySucceeded = pages.some((page) => page.ok);
	if (!anySucceeded) {
		return {
			status: "unavailable",
			detail: lastFailure ?? "The Farcaster feed could not be read.",
		};
	}
	return {
		status: "ready",
		casts: selectRelevantCasts(merged, {
			limit,
			minFollowers: options.minFollowers,
			maxAgeDays: options.maxAgeDays,
			now: options.now,
		}),
	};
}

/**
 * What a page calls. The key is server-only and never reaches the browser: this
 * module is `server-only` and the rail component receives already-reduced casts.
 */
export async function farcasterRail(limit = FARCASTER_RAIL_LIMIT): Promise<FarcasterRailState> {
	// The assets are resolved HERE rather than passed down from the page, and
	// that costs nothing: `readRailAssets` reads the same `getOrderSnapshot`
	// cache the market summaries already read, so no second network round trip
	// happens and the page's three reads still run in parallel. Threading the
	// assets through the page would have serialised the rail behind the book.
	//
	// An empty list is the honest answer in mock mode and whenever the book is
	// unreadable; `searchQueriesFor` falls back to the generic query for it.
	const { getAvailableAssets, isFeedUnavailable } = await import("@/lib/thetanuts/orders");
	const { rankAssets } = await import("./assets");
	let assets: string[] = [];
	try {
		const rows = await getAvailableAssets();
		if (!isFeedUnavailable(rows)) assets = rankAssets(rows, FARCASTER_ASSET_COUNT);
	} catch {
		// The book being unreadable is not this rail's story to tell; it falls
		// back to the generic query rather than reporting somebody else's outage.
		assets = [];
	}
	return loadFarcasterRail(env.NEYNAR_API_KEY, { limit, assets });
}
