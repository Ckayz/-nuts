/**
 * The market URL the agent is instructed to end with, as the tool builds it:
 * `/m/<asset>?thesis=<uuid>`, or `/m/<asset>` on its own.
 *
 * Deliberately narrow. Only THIS shape becomes a link — an app-relative market
 * path with an optional uuid — so no other text the model produces can be
 * turned into a destination. The asset segment is the lowercase ticker
 * `lib/agent/tools.ts` writes.
 *
 * Extracted from `agent-chat.tsx` so the markdown renderer can apply the same
 * rule to every text node without importing the chat component. `agent-chat`
 * re-exports it, because `agent-fold-r2.test.ts` imports it from there and that
 * import is the contract.
 */
const MARKET_URL = /\/m\/[a-z0-9]{1,12}(?:\?thesis=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?/gi;

export function marketLinkParts(text: string): { text: string; href: string | null }[] {
	const pieces: { text: string; href: string | null }[] = [];
	let cursor = 0;
	for (const match of text.matchAll(MARKET_URL)) {
		const start = match.index;
		if (start > cursor) pieces.push({ text: text.slice(cursor, start), href: null });
		pieces.push({ text: match[0], href: match[0] });
		cursor = start + match[0].length;
	}
	if (cursor < text.length) pieces.push({ text: text.slice(cursor), href: null });
	return pieces;
}
