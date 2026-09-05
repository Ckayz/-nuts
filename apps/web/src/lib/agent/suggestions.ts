/**
 * Follow-up chips: what the user could ask next.
 *
 * Still pure and server-free — no network, no clock, and this file never calls a
 * model. What changed (owner 2026-09-06 05:4x, "every time a convo there will be
 * like pre message for user to choose"): the chips are now MODEL-WRITTEN on
 * every turn, carried as a trailer line inside the answer the turn already paid
 * for (`SUGGEST: ["…","…"]`, see `lib/agent/prompt.ts` "## Follow-ups"). That
 * costs zero extra generations. `splitSuggestionTrailer` cuts the trailer out of
 * the text before it is rendered, so the raw JSON is never shown.
 *
 * A model can suggest something the agent cannot do, so the trailer is not
 * trusted: it is validated (length, count, shape) and it is only ever a
 * QUESTION the user might send — pressing one sends its own text through the
 * ordinary input, and every guardrail (the scope gate, the tool grounding, the
 * 10 USD cap) runs on it exactly as if it had been typed.
 *
 * Three deterministic layers sit under it so the row is never empty:
 * `suggestionsFor(parts)` reads what the tools actually returned (a chip built
 * this way can only name an instrument that exists), `fallbackSuggestions`
 * covers a text-only turn, and `starterSuggestions` covers the empty
 * conversation. `postFillSuggestions` covers the one state no model turn
 * produces at all — a confirmed fill.
 *
 * The wording is intent-first and plain: someone who has never traded should be
 * able to press one. Instrument jargon stays out of the labels even when the
 * message sent behind them is specific.
 *
 * TODO-OWNER: every label below is the owner's to word, and so is how many chips
 * show at once.
 */

/** Most chips to offer at once. More than this reads as a menu, not a nudge. */
export const MAX_SUGGESTIONS = 4;

export interface Suggestion {
	/** What the chip says. */
	readonly label: string;
	/** What pressing it sends as the next user message. */
	readonly send: string;
}

/**
 * Every sentence a chip can show or send. One tagged block, matching the
 * convention `components/agent/copy.test.ts` fences for the other agent
 * surfaces: a bare literal further down the file is how untagged copy
 * accumulates.
 */
const COPY = {
	// TODO-OWNER: the downside question, offered after any priced trade.
	maxLossLabel: "What's my max loss?",
	// TODO-OWNER: sent when the user presses the downside chip.
	maxLossSend: "What is the most I can lose on that, and when would that happen?",

	// TODO-OWNER: the cheaper-alternative chip, after a priced trade.
	cheaperLabel: "Show me a cheaper one",
	// TODO-OWNER: sent when the user asks for something cheaper.
	cheaperSend: "Is there a cheaper option with the same view? Show me the costs.",

	// TODO-OWNER: the commit chip, offered only when a trade was actually priced.
	prepareLabel: "Prepare this trade",
	// TODO-OWNER: sent when the user wants the transaction built.
	prepareSend: "Prepare that trade so I can approve it in my wallet.",

	// TODO-OWNER: the explain chip, offered whenever an instrument was named.
	explainLabel: "Explain this simply",
	// TODO-OWNER: sent when the user wants the plain-words version.
	explainSend: "Explain that in plain words, as if I have never traded an option.",

	// TODO-OWNER: the direction chips, offered after a market listing.
	upLabel: "I think it goes up",
	// TODO-OWNER: sent for the bullish direction.
	upSend: "I think it goes up. What can I buy, and what would it cost?",

	// TODO-OWNER: the bearish direction chip.
	downLabel: "I think it goes down",
	// TODO-OWNER: sent for the bearish direction.
	downSend: "I think it goes down. What can I buy, and what would it cost?",

	// TODO-OWNER: the cheapest-entry chip, after a market listing.
	cheapestLabel: "What's cheapest?",
	// TODO-OWNER: sent when the user wants the lowest-cost entry.
	cheapestSend: "What is the cheapest thing I could buy right now, and what does it need to happen?",

	// TODO-OWNER: offered when a search came back with nothing.
	widenLabel: "Show me anything tradeable",
	// TODO-OWNER: sent to widen an empty search.
	widenSend: "Nothing matched. Show me what is tradeable right now across all assets.",

	// --- Starters: the empty conversation, where no tool result exists yet. ---

	// TODO-OWNER: the opening "what is there" prompt, and whether an empty
	// conversation should offer four prompts at all.
	startTradeable: "What can I trade right now?",
	// TODO-OWNER: the opening view-and-budget prompt. The 10 USD figure is the
	// agent's own cap (PRD 10.2); the sentence around it is not the PRD's.
	startView: (asset: string) => `I think ${asset} goes up this week. I have $10.`,
	// TODO-OWNER: the opening education prompt.
	startEducation: "What is a put, in plain words?",
	// TODO-OWNER: the opening "keep it simple" prompt.
	startSimplest: (asset: string) => `Show me the simplest bet you have on ${asset}.`,
	// TODO-OWNER: the hedge entry, offered only where an asset is in context.
	// Level 1 (owner 2026-09-06 05:4x): the agent proposes, the wallet signs.
	startHedgeLabel: (asset: string) => `Protect my ${asset} from a drop`,
	// TODO-OWNER: sent when the user presses the hedge chip. Deliberately asks
	// for the cost too: protection that is never priced reads as free.
	startHedgeSend: (asset: string) =>
		`I hold ${asset}. What could I buy to protect it if the price drops, and what would that cost?`,

	// --- Fallback: a turn that produced no tool result and no trailer. ---

	// TODO-OWNER: the generic "what is on the book" chip.
	fallbackTradeableLabel: "What can I trade right now?",
	// TODO-OWNER: sent by the generic tradeable chip.
	fallbackTradeableSend: "What can I trade right now? Show me what is on the book.",
	// TODO-OWNER: the asset-aware version of the same chip.
	fallbackAssetLabel: (asset: string) => `What can I trade on ${asset}?`,
	// TODO-OWNER: sent by the asset-aware tradeable chip.
	fallbackAssetSend: (asset: string) => `What can I trade on ${asset} right now, and what would it cost?`,
	// TODO-OWNER: the education chip, offered whenever nothing else fits.
	fallbackEducationLabel: "What is a put, in plain words?",
	// TODO-OWNER: sent by the education chip.
	fallbackEducationSend: "What is a put, in plain words? Assume I have never traded an option.",
	// PRD 10.7, verbatim: one of the five suggested questions the product spec
	// already words, so this one is not the writer's invention.
	fallbackRiskLabel: "What is the maximum loss?",
	// PRD 10.7, verbatim (the same sentence is what pressing it sends).
	fallbackRiskSend: "What is the maximum loss?",

	// --- After a confirmed fill. Deterministic: no model turn produced it. ---

	// TODO-OWNER: the post-fill share chip. Same destination as the market
	// ticket's own post-fill dialog (`lib/trade/record.ts` composePath).
	postFillPostLabel: "Write a post about it",
	// TODO-OWNER: the post-fill positions chip.
	postFillPositionsLabel: "Show my positions",
	// TODO-OWNER: sent by the post-fill positions chip.
	postFillPositionsSend: "Show my positions and how they are doing.",
} as const;

/** A tool part as the chat renders it. Only the fields chips are built from. */
export interface ToolPart {
	readonly type: string;
	readonly state?: string;
	readonly output?: unknown;
}

function outputOf(part: ToolPart): Record<string, unknown> | null {
	if (part.state !== "output-available") return null;
	const output = part.output;
	return output !== null && typeof output === "object" ? (output as Record<string, unknown>) : null;
}

/** The asset a tool result is about, when it named exactly one. */
function assetOf(output: Record<string, unknown>): string | null {
	const orders = output.orders;
	if (Array.isArray(orders)) {
		const assets = new Set(
			orders
				.map((o) => (o as { asset?: unknown }).asset)
				.filter((a): a is string => typeof a === "string"),
		);
		if (assets.size === 1) return [...assets][0] ?? null;
	}
	const instrument = output.instrument;
	if (instrument !== null && typeof instrument === "object") {
		const asset = (instrument as { asset?: unknown }).asset;
		if (typeof asset === "string") return asset;
	}
	return null;
}

/**
 * Chips for one assistant message, newest tool result first.
 *
 * Returns nothing rather than guessing when a message carried no usable tool
 * result: a chip that leads nowhere is worse than no chip.
 */
export function suggestionsFor(parts: readonly ToolPart[]): Suggestion[] {
	const suggestions: Suggestion[] = [];
	const seen = new Set<string>();

	const add = (label: string, send: string) => {
		if (seen.has(label) || suggestions.length >= MAX_SUGGESTIONS) return;
		seen.add(label);
		suggestions.push({ label, send });
	};

	// Later results describe where the conversation actually is, so they lead.
	for (const part of [...parts].reverse()) {
		const output = outputOf(part);
		if (output === null) continue;

		if (part.type === "tool-previewOptionBookTrade" && output.executable === true) {
			// A trade was priced: the next questions are about risk and commitment.
			add(COPY.maxLossLabel, COPY.maxLossSend);
			add(COPY.prepareLabel, COPY.prepareSend);
			add(COPY.cheaperLabel, COPY.cheaperSend);
			add(COPY.explainLabel, COPY.explainSend);
			continue;
		}

		if (part.type === "tool-searchOptionBookOrders") {
			const matched = output.totalMatched;
			if (matched === 0) {
				add(COPY.widenLabel, COPY.widenSend);
				continue;
			}
			const asset = assetOf(output);
			// Naming the asset is the one place a chip gets specific, because the
			// tool result proved that asset is quoted.
			add(COPY.explainLabel, COPY.explainSend);
			add(COPY.cheapestLabel, COPY.cheapestSend);
			if (asset !== null) {
				add(`${COPY.upLabel} (${asset})`, `${asset}: ${COPY.upSend}`);
				add(`${COPY.downLabel} (${asset})`, `${asset}: ${COPY.downSend}`);
			}
			continue;
		}

		if (part.type === "tool-getMarketData") {
			add(COPY.cheapestLabel, COPY.cheapestSend);
			add(COPY.upLabel, COPY.upSend);
			add(COPY.downLabel, COPY.downSend);
			continue;
		}

		if (part.type === "tool-getThesisContext" && output.found === true) {
			add(COPY.explainLabel, COPY.explainSend);
			add(COPY.upLabel, COPY.upSend);
			add(COPY.downLabel, COPY.downSend);
		}
	}

	return suggestions;
}

/* ------------------------------------------------------------------ *
 * The model-written trailer
 * ------------------------------------------------------------------ */

/**
 * The marker the system prompt tells the model to end every reply with.
 *
 * A marker rather than a structured output because the alternative — a second
 * generation, or a tool the model calls to "propose follow-ups" — costs another
 * model turn on every message. This rides inside the answer that was already
 * paid for.
 */
export const SUGGEST_MARKER = "SUGGEST:";

/**
 * Every character that may sit between the start of a line and the marker.
 *
 * Models decorate. A free model asked for a bare last line has emitted the
 * marker bolded (`**SUGGEST:** [...]`), inside a fenced block, and as a bullet;
 * none of that changes the meaning, and all of it must still be cut out of the
 * body. Anything OTHER than this noise means the marker is mid-sentence, and a
 * sentence about the word SUGGEST is not a trailer.
 */
const MARKER_NOISE = "[ \\t>*_`~#\\-]*";

/** Every marker that begins a line, in order. The LAST one is the trailer. */
const MARKER_LINE = new RegExp(`(^|\\n)(${MARKER_NOISE})${SUGGEST_MARKER}`, "g");

/** Where the trailer begins (the start of its line's content), or -1. */
function markerStart(text: string): number {
	let start = -1;
	MARKER_LINE.lastIndex = 0;
	for (let match = MARKER_LINE.exec(text); match !== null; match = MARKER_LINE.exec(text)) {
		// `match[1]` is the newline (absent at index 0); the cut point is the
		// noise, so `**` and a fence marker go with the trailer, not the body.
		start = match.index + (match[1] === "" ? 0 : 1);
	}
	return start;
}

/**
 * Cut a marker the stream has only half-emitted.
 *
 * Without this the reader watches `S`, `SU`, `SUGG` appear at the end of the
 * answer before the whole line disappears. Only a suffix that starts its own
 * line is cut, so a sentence ending in a capital S is left alone.
 */
function stripPartialMarker(text: string): string {
	for (let length = SUGGEST_MARKER.length - 1; length > 0; length--) {
		if (!text.endsWith(SUGGEST_MARKER.slice(0, length))) continue;
		const at = text.length - length;
		const lineStart = text.lastIndexOf("\n", at - 1) + 1;
		if (new RegExp(`^${MARKER_NOISE}$`).test(text.slice(lineStart, at))) {
			return text.slice(0, lineStart).replace(/\s+$/, "");
		}
	}
	return text;
}

/**
 * Drop a code fence the model opened for the trailer alone.
 *
 * ```` ```json\nSUGGEST: […]\n``` ```` cuts at the marker line and would leave
 * the opening fence dangling at the end of the answer, which renders as an
 * empty code block.
 */
function stripOpenFence(body: string): string {
	return body.replace(/(^|\n)[ \t]*`{3,}[A-Za-z]*[ \t]*$/, "").replace(/\s+$/, "");
}

/** The JSON array after the marker, or null. */
function parseArray(rest: string): unknown[] | null {
	const opens = rest.indexOf("[");
	if (opens === -1) return null;
	const tail = rest.slice(opens);
	// Greedy first: a label may contain "]", and nothing the model writes after
	// the array (a stray fence, a newline) does. Lazy second, for a trailing
	// `]` that belongs to something else.
	for (const pattern of [/^\[[\s\S]*\]/, /^\[[\s\S]*?\]/]) {
		const match = tail.match(pattern);
		if (match === null) continue;
		try {
			const parsed: unknown = JSON.parse(match[0]);
			if (Array.isArray(parsed)) return parsed;
		} catch {
			// Try the other shape, then give up: a malformed trailer is a missing
			// trailer, and the caller falls back.
		}
	}
	return null;
}

/**
 * TODO-OWNER: the longest a chip may be. Past this a chip stops being a nudge
 * and becomes a paragraph the row cannot lay out.
 */
export const MAX_SUGGESTION_LENGTH = 80;

/** Validate, trim, dedupe and cap what the model proposed. */
function chipsFromArray(items: readonly unknown[]): Suggestion[] {
	const chips: Suggestion[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (typeof item !== "string") continue;
		const label = item.trim();
		if (label === "" || label.length > MAX_SUGGESTION_LENGTH) continue;
		const key = label.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		chips.push({ label, send: label });
		if (chips.length >= MAX_SUGGESTIONS) break;
	}
	return chips;
}

/**
 * Split a reply into the text to render and the chips the model proposed.
 *
 * `streaming` is the state of the text part (`TextUIPart.state`, `ai@7.0.92`
 * `dist/index.d.ts:1870-1881`): while it is `"streaming"` the trailer is cut and
 * NO chips are returned, because a half-written array is not a proposal.
 *
 * A marker that is present but malformed still gets cut: raw JSON, or the word
 * SUGGEST followed by rubbish, must never reach the screen.
 */
export function splitSuggestionTrailer(
	text: string,
	streaming = false,
): { body: string; chips: Suggestion[] } {
	const start = markerStart(text);
	if (start === -1) {
		if (!streaming) return { body: text, chips: [] };
		// Only a body that HAD a half-written marker gets the fence treatment: a
		// fence the model opened for real content is still being written.
		const cut = stripPartialMarker(text);
		return { body: cut === text ? text : stripOpenFence(cut), chips: [] };
	}
	const body = stripOpenFence(text.slice(0, start).replace(/\s+$/, ""));
	if (streaming) return { body, chips: [] };
	const rest = text.slice(start + text.slice(start).indexOf(SUGGEST_MARKER) + SUGGEST_MARKER.length);
	const array = parseArray(rest);
	return { body, chips: array === null ? [] : chipsFromArray(array) };
}

/* ------------------------------------------------------------------ *
 * The deterministic layers
 * ------------------------------------------------------------------ */

/**
 * An asset is only usable in a sentence if it looks like a ticker.
 *
 * The asset reaches this file from a route parameter by way of the market page,
 * so it is not trusted to be short, printable or non-empty.
 */
function tickerOf(asset: string | null | undefined): string | null {
	if (typeof asset !== "string") return null;
	const trimmed = asset.trim();
	return /^[A-Za-z0-9]{1,10}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

/**
 * The chips an empty conversation offers.
 *
 * Asset-aware on the market page and in the slide-over, where the reader is
 * already looking at one market: a starter that names some other asset there is
 * a worse prompt than one that names the one on screen.
 */
export function starterSuggestions(input: { readonly asset?: string | null } = {}): Suggestion[] {
	const asset = tickerOf(input.asset);
	if (asset === null) {
		return [
			{ label: COPY.startTradeable, send: COPY.startTradeable },
			{ label: COPY.startView("ETH"), send: COPY.startView("ETH") },
			{ label: COPY.startEducation, send: COPY.startEducation },
			{ label: COPY.startSimplest("BTC"), send: COPY.startSimplest("BTC") },
		];
	}
	return [
		{ label: COPY.startTradeable, send: COPY.startTradeable },
		{ label: COPY.startView(asset), send: COPY.startView(asset) },
		{ label: COPY.startHedgeLabel(asset), send: COPY.startHedgeSend(asset) },
		{ label: COPY.startEducation, send: COPY.startEducation },
	];
}

/**
 * The last resort: a turn that produced no trailer and no usable tool result.
 *
 * Every chip here is answerable by a tool the agent has, which is the same rule
 * the prompt gives the model — a chip that leads to "I can't do that" is worse
 * than no chip, and this row is the one that shows when the model said nothing
 * about what comes next (an out-of-scope redirect, a plain explanation, a
 * failure to follow the trailer format).
 */
export function fallbackSuggestions(input: { readonly asset?: string | null } = {}): Suggestion[] {
	const asset = tickerOf(input.asset);
	const first: Suggestion =
		asset === null
			? { label: COPY.fallbackTradeableLabel, send: COPY.fallbackTradeableSend }
			: { label: COPY.fallbackAssetLabel(asset), send: COPY.fallbackAssetSend(asset) };
	return [
		first,
		{ label: COPY.fallbackEducationLabel, send: COPY.fallbackEducationSend },
		{ label: COPY.fallbackRiskLabel, send: COPY.fallbackRiskSend },
	];
}

/** A chip that navigates instead of sending a message. */
export interface LinkSuggestion {
	readonly label: string;
	/** An app-relative path. Nothing here ever builds an external URL. */
	readonly href: string;
}

/** Either kind of chip. */
export type Chip = Suggestion | LinkSuggestion;

export function isLinkChip(chip: Chip): chip is LinkSuggestion {
	return "href" in chip;
}

/**
 * The two chips a confirmed fill earns.
 *
 * Deterministic on purpose: the fill is client state inside `TradeExecution`
 * (the recording call returns the id), not a message part, so no model turn ever
 * sees it and no trailer can propose these. The composer link is the SAME shape
 * the market ticket's own post-fill dialog builds — `lib/trade/record.ts`
 * `composePath: "/new?link=/p/<id>"` — so both routes into the composer prefill
 * the same way.
 */
export function postFillSuggestions(positionId: string): Chip[] {
	return [
		{ label: COPY.postFillPostLabel, href: `/new?link=/p/${positionId}` },
		{ label: COPY.postFillPositionsLabel, send: COPY.postFillPositionsSend },
	];
}

/** A message part as `chipsForTurn` reads it. */
export interface TurnPart extends ToolPart {
	readonly text?: string;
}

/**
 * The chips for one finished assistant turn, in priority order:
 * the model's own trailer → what its tools returned → the generic fallback.
 *
 * Never empty for a turn that exists, which is the whole point: the owner asked
 * for something to press on every message, and a text-only answer used to offer
 * nothing at all.
 */
export function chipsForTurn(input: {
	readonly parts: readonly TurnPart[] | null | undefined;
	readonly streaming?: boolean;
	readonly asset?: string | null;
}): Suggestion[] {
	const parts = input.parts;
	// No parts at all is not a turn: the message exists but has produced
	// nothing, which is what an assistant message looks like for one frame.
	if (parts === null || parts === undefined || parts.length === 0) return [];
	// A half-written trailer is not a proposal, and chips that appear mid-stream
	// move under the reader's cursor.
	if (input.streaming === true) return [];

	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (part === undefined || part.type !== "text" || typeof part.text !== "string") continue;
		const { chips } = splitSuggestionTrailer(part.text, false);
		if (chips.length > 0) return chips;
	}

	const fromTools = suggestionsFor(parts);
	if (fromTools.length > 0) return fromTools;

	return fallbackSuggestions({ asset: input.asset });
}
