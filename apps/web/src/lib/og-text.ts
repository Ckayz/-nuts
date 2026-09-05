/**
 * Emoji stripping for the two Open Graph image routes.
 *
 * `next/og` renders through Satori, and Satori draws an emoji by FETCHING a
 * twemoji SVG from `cdn.jsdelivr.net` at request time (measured in the installed
 * bundle: `next/dist/compiled/@vercel/og/index.edge.js`, `apis.twemoji` and
 * `loadEmoji`). So one rocket in a headline turns a share card into a
 * third-party network call: slower always, and a 500 during a CDN outage or on
 * an egress-restricted runtime. The vendored fonts removed the other outbound
 * request (`lib/og-fonts.ts`); this removes the last one.
 *
 * TODO-OWNER: the alternative the owner may prefer is to keep the emoji and
 * accept the CDN dependency (or to ship an emoji font). Today the card drops
 * the emoji and keeps the words.
 *
 * The matcher is Satori's OWN emoji pattern, transcribed from that same bundle
 * (`hu`/`gu`/`$d` there, `io.emoji` the detector), so what survives cannot be
 * classified as an emoji by the code that would fetch for it. A second pass on
 * `\p{Extended_Pictographic}` catches anything the first pattern would leave in
 * a partial sequence. `og-text.test.ts` pins both against the installed bytes.
 *
 * Every code point below is written as an escape on purpose: an invisible
 * literal ZWJ or variation selector in source is unreviewable.
 */

/** Satori's `hu`: one emoji base plus its modifier / tag / variation suffix. */
const EMOJI_SEQUENCE = String.raw`\p{Emoji}(?:\p{EMod}|[\u{E0020}-\u{E007E}]+\u{E007F}|\uFE0F?\u20E3?)`;

/**
 * Satori's `gu()`: a flag pair, or a ZWJ-joined run of the sequence above. The
 * lookahead is Satori's own: `#`, `*` and the digits are `\p{Emoji}` but are
 * only emoji when a keycap follows, so plain numbers survive — which matters,
 * because every card here is mostly numbers.
 */
const SATORI_EMOJI = String.raw`\p{RI}{2}|(?![#*\d](?!\uFE0F?\u20E3))${EMOJI_SEQUENCE}(?:\u200D${EMOJI_SEQUENCE})*`;

export const SATORI_EMOJI_SOURCE = SATORI_EMOJI;
export const EMOJI_SEQUENCE_SOURCE = EMOJI_SEQUENCE;

const LEFTOVER_PICTOGRAPHIC = String.raw`\p{Extended_Pictographic}\uFE0F?`;

/**
 * Strip every emoji from a string bound for an `ImageResponse`.
 *
 * Runs of spaces and tabs left behind are collapsed and the result trimmed, so
 * "BTC 🚀 breaks out" reads "BTC breaks out" rather than keeping a hole. Line
 * breaks are left alone. A string with no emoji comes back with only that
 * whitespace tidying applied.
 */
export function ogText(value: string): string {
	return value
		.replace(new RegExp(SATORI_EMOJI, "gu"), "")
		.replace(new RegExp(LEFTOVER_PICTOGRAPHIC, "gu"), "")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

/** The same, for the many optional strings the cards interpolate. */
export function ogTextOrNull(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const stripped = ogText(value);
	return stripped === "" ? null : stripped;
}
