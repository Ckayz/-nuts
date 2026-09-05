/**
 * `/p/<uuid>` links inside a post's text.
 *
 * Owner 2026-09-05: "when a user post it's trade (could be a link to his own
 * live pnl card) in the trade then we render a nice card. u know how like if i
 * share my own posts' link in x, x will render the posts' as a card? and not
 * just the link? and it's clickable cuz issa link". So a post stays plain text;
 * a link to a position is what unfurls into a trade card.
 *
 * Pure module: no React, no database, no `process.env`, no network. Everything
 * here is a function of its arguments so the whole grammar is unit-testable.
 *
 * Two safety rules the tests pin:
 *  1. The emitted href is always REBUILT as `/p/<lowercased uuid>`. It is never
 *     the matched text, so a link whose query string carries another URL
 *     (`/p/<uuid>?to=https://evil.example`) cannot become an open redirect.
 *  2. Everything that is not an exact same-origin `/p/<uuid>` stays text —
 *     another host, a `javascript:` URL, a protocol-relative `//host/p/<uuid>`,
 *     a deeper path `/p/<uuid>/edit`. Nothing is "repaired" into a link.
 *
 * The token list is rendered by React as text nodes and `<a>` elements, so no
 * caller ever needs `dangerouslySetInnerHTML`.
 */

/** Same UUID grammar as `lib/data/reads.ts` and `lib/social/guards.ts`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TODO-OWNER: placeholder cap on how many trade cards one post unfurls. The
 * owner has set no limit; 4 is a bound so a post cannot render an unbounded
 * number of cards, not an approved product number.
 *
 * The cap bounds CARDS, not anchors: every valid `/p/<uuid>` in the text stays
 * clickable (silently un-linking text the author wrote would be worse), and the
 * first `MAX_TRADE_CARDS_PER_POST` distinct positions get a card.
 */
export const MAX_TRADE_CARDS_PER_POST = 4;

/** One piece of a post's text: literal text, or a link to a position. */
export type TextToken =
	| { kind: "text"; value: string }
	| {
			kind: "link";
			/** The text exactly as the author typed it. */
			label: string;
			/** Rebuilt canonical path, never the input. */
			href: string;
			/** Lowercased `positions.id`. */
			positionId: string;
	  };

/** The canonical path a trade link points at. */
export function tradeLinkHref(positionId: string): string {
	return `/p/${positionId.toLowerCase()}`;
}

/**
 * Wrapping characters stripped before matching and re-emitted as text, so
 * "(see /p/<uuid>)" and "/p/<uuid>." link the URL and keep the punctuation.
 */
const LEADING = /^[([{<"'`]+/;
const TRAILING = /[)\]}>"'`.,;:!?]+$/;

/**
 * Lowercase scheme+host with any trailing slash removed, for every origin the
 * site answers on.
 *
 * 9(b). One origin is not enough. `CopyLink` builds the copied address from the
 * BROWSER's `window.location.origin`, so a visitor on a custom domain or a
 * branch alias copies a link on that host — while the server used to match only
 * `VERCEL_URL`, the per-deployment URL. The link then stayed plain text and the
 * trade card never unfurled. Every origin the request could legitimately have
 * been served from is accepted; duplicates and unusable entries are dropped.
 */
function normalizeOrigins(origin: string | readonly string[] | undefined): string[] {
	if (origin === undefined) return [];
	const list = typeof origin === "string" ? [origin] : origin;
	const seen: string[] = [];
	for (const entry of list) {
		const trimmed = entry.trim().toLowerCase().replace(/\/+$/, "");
		if (trimmed !== "" && !seen.includes(trimmed)) seen.push(trimmed);
	}
	return seen;
}

/**
 * The position id a candidate word points at, or null.
 *
 * An absolute URL is accepted only when it starts with ONE OF the site's own
 * origins followed by `/` — `https://thesis.fun.evil.example/p/<uuid>` fails
 * that test because the character after the origin is `.`, not `/`.
 */
function tradeLinkTarget(candidate: string, origins: readonly string[]): string | null {
	let path = candidate;
	const lower = candidate.toLowerCase();
	const matched = origins.find(origin => lower.startsWith(`${origin}/`));
	if (matched !== undefined) {
		path = candidate.slice(matched.length);
	}
	// Exactly one path segment after /p/, optionally followed by a query or
	// fragment. A deeper path, another scheme or another host never matches.
	const match = /^\/p\/([0-9a-f-]{36})(?:[?#][^]*)?$/i.exec(path);
	const id = match?.[1]?.toLowerCase();
	return id !== undefined && UUID.test(id) ? id : null;
}

/**
 * Split a post's text into text and link tokens.
 *
 * Invariant (pinned by a test): concatenating every token's rendered characters
 * reproduces the input byte for byte, so this can neither drop the author's
 * words nor inject any.
 *
 * `origin` is the site's own origin — or, on a deployment reachable under more
 * than one name, every origin it answers on. Omitted, only path-only links are
 * recognised: an absolute URL cannot be proven same-origin without one, and
 * guessing would be the open-redirect bug.
 */
export function renderTextWithLinks(text: string, origin?: string | readonly string[]): TextToken[] {
	const sites = normalizeOrigins(origin);
	const tokens: TextToken[] = [];
	const push = (value: string) => {
		if (value !== "") tokens.push({ kind: "text", value });
	};

	let cursor = 0;
	// Words are whitespace-separated; a URL never contains whitespace.
	for (const word of text.matchAll(/\S+/g)) {
		const start = word.index;
		push(text.slice(cursor, start));
		cursor = start + word[0].length;

		const lead = LEADING.exec(word[0])?.[0] ?? "";
		const withoutLead = word[0].slice(lead.length);
		const tail = TRAILING.exec(withoutLead)?.[0] ?? "";
		const core = tail === "" ? withoutLead : withoutLead.slice(0, -tail.length);

		const positionId = core === "" ? null : tradeLinkTarget(core, sites);
		if (positionId === null) {
			push(word[0]);
			continue;
		}
		push(lead);
		tokens.push({ kind: "link", label: core, href: tradeLinkHref(positionId), positionId });
		push(tail);
	}
	push(text.slice(cursor));
	return tokens;
}

/**
 * The distinct positions a post's text links, in the order they appear, capped
 * at `MAX_TRADE_CARDS_PER_POST`. Built from the same tokens the text renders
 * from, so the cards and the anchors can never disagree about what a link is.
 */
export function extractTradeLinks(text: string, origin?: string | readonly string[]): string[] {
	const found: string[] = [];
	for (const token of renderTextWithLinks(text, origin)) {
		if (token.kind !== "link" || found.includes(token.positionId)) continue;
		found.push(token.positionId);
		if (found.length === MAX_TRADE_CARDS_PER_POST) break;
	}
	return found;
}
