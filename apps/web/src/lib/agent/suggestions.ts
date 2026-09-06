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
	// TODO-OWNER: the RFQ entry, and whether it belongs on the starter row at all.
	// Offered ONLY on ETH and BTC because that is what the owner put in scope
	// (2026-09-06 10:1x: BUY puts and put spreads, USDC collateral, ETH/BTC) —
	// a chip that leads to "I cannot do that here" is worse than no chip.
	startRfqLabel: (asset: string) => `Ask for a custom ${asset} option`,
	// TODO-OWNER: sent when the user presses the RFQ chip. It asks for the thing
	// an RFQ is FOR — a strike or expiry the book does not quote — rather than
	// naming the mechanism, which means nothing to a first-time reader.
	startRfqSend: (asset: string) =>
		`I want a put on ${asset} at a strike the order book does not have. Can market makers quote one for me?`,
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
	// PRD 10.7, verbatim. Answered by `whatIfAtExpiry`.
	prdExpiry: "What happens at expiry?",
	// PRD 10.7, verbatim. Answered by `previewOptionBookTrade` + `whatIfAtExpiry`.
	prdProfit: "What needs to happen for this position to profit?",
	// PRD 10.7, verbatim.
	prdStrikes: "Explain the strikes in simple terms.",

	// --- Signed in only. `getUserPositions` refuses a guest by design, so a
	//     chip offering it to one leads straight to "connect your wallet". ---

	// TODO-OWNER: the positions chip. Offered after a fill, and on any turn
	// where the reader is signed in.
	positionsLabel: "Show my positions",
	// TODO-OWNER: sent by the positions chip.
	positionsSend: "Show my positions and how they are doing.",
	// TODO-OWNER: the exposure chip. Different question from the one above: it
	// asks what is at stake, which `getUserPositions` answers per row.
	riskingLabel: "What am I risking right now?",
	// TODO-OWNER: sent by the exposure chip.
	riskingSend: "What am I risking right now across the positions I hold?",

	// --- After a confirmed fill. Deterministic: no model turn produced it. ---

	// TODO-OWNER: the post-fill share chip. Same destination as the market
	// ticket's own post-fill dialog (`lib/trade/record.ts` composePath).
	postFillPostLabel: "Write a post about it",

	// --- After an RFQ the wallet confirmed. Deterministic for the same reason. ---

	// TODO-OWNER: the "where is it up to" chip after a request is created.
	postRfqStatusLabel: "Check my request",
	// TODO-OWNER: sent by the status chip. The id is the row the card recorded,
	// so the agent reads THAT request rather than guessing which one is meant.
	postRfqStatusSend: (rfqRequestId: string) => `What is the status of my request ${rfqRequestId}?`,
	// TODO-OWNER: the cancel chip. Cancelling is requester-only and refunds the
	// escrow, which is why it is offered as plainly as the status chip.
	postRfqCancelLabel: "Cancel it",
	// TODO-OWNER: sent by the cancel chip. It asks; the wallet still confirms.
	postRfqCancelSend: (rfqRequestId: string) =>
		`Cancel my request ${rfqRequestId} and return the escrow.`,
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

/* ------------------------------------------------------------------ *
 * Rotation and state
 * ------------------------------------------------------------------ */

/**
 * What the deterministic layers know about the conversation they sit under.
 *
 * Owner 2026-09-06 12:4x, verbatim: "the suggested msg is always the same here
 * it need to be diff everytime depends on the output and like it shud have also
 * like help user trade, show active position etc that are related".
 *
 * Two separate problems, and this type is the second one's answer. The chips are
 * MODEL-WRITTEN on a normal turn (the `SUGGEST:` trailer), so they already vary;
 * what did not vary was the deterministic row under them, which is the row a
 * reader sees whenever the model skips the trailer — the same three sentences
 * every single time. `turn` rotates a POOL so two turns running never show the
 * same row, and `signedIn` decides whether a wallet-only chip may be offered at
 * all.
 */
export interface ChipState {
	/** How many assistant messages exist. Any integer; only its remainder matters. */
	readonly turn?: number;
	/**
	 * Is there a wallet the position tools would accept?
	 *
	 * `getUserPositions` answers `signedIn: false` to a guest by design, so a
	 * chip offering it to one is a chip that leads to "connect your wallet".
	 */
	readonly signedIn?: boolean;
	/** The market this conversation is about, if any. */
	readonly asset?: string | null;
}

/** The pool, read from `turn`, wrapping. A non-finite turn reads as 0. */
function rotate<T>(pool: readonly T[], turn: number | undefined): T[] {
	if (pool.length === 0) return [];
	const n = typeof turn === "number" && Number.isFinite(turn) ? Math.trunc(turn) : 0;
	const at = ((n % pool.length) + pool.length) % pool.length;
	return [...pool.slice(at), ...pool.slice(0, at)];
}

/**
 * `MAX_SUGGESTIONS` entries from a pool, rotated by the turn.
 *
 * `required` is the one chip a stage must always offer whatever the rotation
 * says — after a priced trade that is "Prepare this trade", because the owner's
 * ask was for chips that MOVE THE TRADE FORWARD, and a rotation that hid the
 * commitment two turns out of three would defeat the point. It takes the last
 * slot when the rotation has pushed it out.
 */
function pick(pool: readonly Suggestion[], turn: number | undefined, required?: Suggestion): Suggestion[] {
	const chosen = rotate(pool, turn).slice(0, MAX_SUGGESTIONS);
	if (required === undefined || chosen.some((chip) => chip.label === required.label)) return chosen;
	if (chosen.length < MAX_SUGGESTIONS) return [...chosen, required];
	return [...chosen.slice(0, -1), required];
}

/**
 * The same chip, pinned to one asset.
 *
 * Composed from COPY rather than worded here — the label gains the ticker in
 * brackets and the message gains it as a prefix, which is what this file has
 * always done for a search that proved exactly one asset is quoted. Written
 * with shorthand properties so the fence in `copy.test.ts` — no chip property
 * takes a string literal outside the COPY block — still means what it says.
 */
function forAsset(chip: Suggestion, asset: string): Suggestion {
	const label = `${chip.label} (${asset})`;
	const send = `${asset}: ${chip.send}`;
	return { label, send };
}

/** The chips that only make sense once a wallet is attached. */
function walletChips(state: ChipState): Suggestion[] {
	if (state.signedIn !== true) return [];
	return [
		{ label: COPY.positionsLabel, send: COPY.positionsSend },
		{ label: COPY.riskingLabel, send: COPY.riskingSend },
	];
}

/**
 * The RFQ entry, where the factory actually prices one.
 *
 * Same gate as `starterSuggestions`: ETH and BTC only (owner 2026-09-06 10:1x).
 */
function rfqChips(asset: string | null): Suggestion[] {
	if (asset === null || !RFQ_UNDERLYINGS.has(asset)) return [];
	return [{ label: COPY.startRfqLabel(asset), send: COPY.startRfqSend(asset) }];
}

/**
 * Chips for one assistant message, newest tool result first.
 *
 * Returns nothing rather than guessing when a message carried no usable tool
 * result: a chip that leads nowhere is worse than no chip.
 *
 * `state` is optional so every existing caller and test reads as before — with
 * no turn the rotation sits at offset 0, which is the order these chips have
 * always had.
 */
export function suggestionsFor(parts: readonly ToolPart[], state: ChipState = {}): Suggestion[] {
	const suggestions: Suggestion[] = [];
	const seen = new Set<string>();
	const wallet = walletChips(state);

	const add = (chip: Suggestion) => {
		if (seen.has(chip.label) || suggestions.length >= MAX_SUGGESTIONS) return;
		seen.add(chip.label);
		suggestions.push(chip);
	};

	const maxLoss: Suggestion = { label: COPY.maxLossLabel, send: COPY.maxLossSend };
	const prepare: Suggestion = { label: COPY.prepareLabel, send: COPY.prepareSend };
	const cheaper: Suggestion = { label: COPY.cheaperLabel, send: COPY.cheaperSend };
	const explain: Suggestion = { label: COPY.explainLabel, send: COPY.explainSend };
	const cheapest: Suggestion = { label: COPY.cheapestLabel, send: COPY.cheapestSend };
	const up: Suggestion = { label: COPY.upLabel, send: COPY.upSend };
	const down: Suggestion = { label: COPY.downLabel, send: COPY.downSend };
	const expiry: Suggestion = { label: COPY.prdExpiry, send: COPY.prdExpiry };
	const profit: Suggestion = { label: COPY.prdProfit, send: COPY.prdProfit };
	const strikes: Suggestion = { label: COPY.prdStrikes, send: COPY.prdStrikes };
	const education: Suggestion = { label: COPY.fallbackEducationLabel, send: COPY.fallbackEducationSend };

	// Later results describe where the conversation actually is, so they lead.
	for (const part of [...parts].reverse()) {
		const output = outputOf(part);
		if (output === null) continue;

		if (part.type === "tool-previewOptionBookTrade") {
			if (output.executable === true) {
				// A trade was priced: the row must carry the risk AND the commitment,
				// and the rest rotates so a second priced trade does not repeat it.
				for (const chip of pick(
					[maxLoss, prepare, cheaper, explain, expiry, profit, strikes, ...wallet],
					state.turn,
					prepare,
				)) {
					add(chip);
				}
			} else {
				// The tool says it cannot be filled, so "Prepare this trade" would send
				// the reader into a refusal. Everything else still applies.
				for (const chip of pick([explain, cheaper, cheapest, strikes, expiry, education], state.turn)) {
					add(chip);
				}
			}
			continue;
		}

		if (part.type === "tool-searchOptionBookOrders") {
			const matched = output.totalMatched;
			if (matched === 0) {
				// Exactly one chip, and no rotation: a search that matched nothing has
				// exactly one useful next step, and offering a second would be filler.
				add({ label: COPY.widenLabel, send: COPY.widenSend });
				continue;
			}
			const asset = assetOf(output);
			// Naming the asset is the one place a chip gets specific, because the
			// tool result proved that asset is quoted.
			const directional: Suggestion[] =
				asset === null ? [up, down] : [forAsset(up, asset), forAsset(down, asset)];
			for (const chip of pick(
				[explain, cheapest, ...directional, ...rfqChips(asset), education, strikes, ...wallet],
				state.turn,
			)) {
				add(chip);
			}
			continue;
		}

		if (part.type === "tool-getMarketData") {
			for (const chip of pick([cheapest, up, down, explain, education, expiry, ...wallet], state.turn)) {
				add(chip);
			}
			continue;
		}

		if (part.type === "tool-getUserPositions" && output.signedIn === true) {
			// The one stage the owner named directly: after a positions list, one
			// chip is per position and one offers protection.
			const held = tickerOf(firstPositionAsset(output));
			const perPosition: Suggestion[] =
				held === null
					? []
					: [
							{ label: COPY.startHedgeLabel(held), send: COPY.startHedgeSend(held) },
							{ label: COPY.fallbackAssetLabel(held), send: COPY.fallbackAssetSend(held) },
						];
			for (const chip of pick(
				[...wallet, ...perPosition, expiry, profit, explain, education],
				state.turn,
			)) {
				add(chip);
			}
			continue;
		}

		if (part.type === "tool-getThesisContext" && output.found === true) {
			for (const chip of pick([explain, up, down, cheapest, education, strikes, ...wallet], state.turn)) {
				add(chip);
			}
		}
	}

	return suggestions;
}

/** The asset of the first position a `getUserPositions` result listed, or null. */
function firstPositionAsset(output: Record<string, unknown>): string | null {
	const positions = output.positions;
	if (!Array.isArray(positions)) return null;
	for (const row of positions) {
		const asset = (row as { asset?: unknown }).asset;
		if (typeof asset === "string" && asset !== "") return asset;
	}
	return null;
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
			// Try the other shape, then the recovery below.
		}
	}

	/**
	 * MEASURED, not defensive: `minimax/minimax-m3:free` ended a real reply with
	 *
	 *   SUGGEST: ["Show me a put on ETH for under $10","Show me a put on BTC for
	 *   under $10","What is the maximum loss on a put?"
	 *
	 * — three complete strings and no closing bracket (`finishReason: "stop"`,
	 * 888 characters, local run 2026-09-06). Every ITEM is well-formed JSON; only
	 * the array around them is not. Reading the complete string literals out is
	 * not guessing at what the model meant, and half a string is still dropped:
	 * an unterminated literal matches nothing here.
	 */
	const items = [...tail.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((match) => {
		try {
			return JSON.parse(match[0]) as unknown;
		} catch {
			return null;
		}
	});
	return items.length === 0 ? null : items;
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
 * The underlyings an RFQ can be asked for.
 *
 * Owner decision 2026-09-06 10:1x, and the factory's own limit: `mmPricing`
 * prices ETH and BTC only. Uppercase, because `tickerOf` uppercases.
 */
const RFQ_UNDERLYINGS: ReadonlySet<string> = new Set(["ETH", "BTC"]);

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
	/**
	 * The RFQ starter replaces the generic "what can I trade" chip rather than
	 * being added beside it: `starterSuggestions` returns exactly
	 * `MAX_SUGGESTIONS` chips and a test pins that. On a page that is already
	 * about one market, a chip naming that market beats the generic one.
	 *
	 * ETH and BTC only — the factory prices no other underlying for an RFQ
	 * (owner 2026-09-06 10:1x), so nothing else may offer it.
	 */
	if (RFQ_UNDERLYINGS.has(asset)) {
		return [
			{ label: COPY.startView(asset), send: COPY.startView(asset) },
			{ label: COPY.startHedgeLabel(asset), send: COPY.startHedgeSend(asset) },
			{ label: COPY.startRfqLabel(asset), send: COPY.startRfqSend(asset) },
			{ label: COPY.startEducation, send: COPY.startEducation },
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
export function fallbackSuggestions(input: ChipState = {}): Suggestion[] {
	const asset = tickerOf(input.asset);
	/**
	 * The ANCHOR never rotates. It is the one chip that names the market on
	 * screen (or, with no market, the way into the book), so dropping it on
	 * every third turn would make the row worse, not more varied. Everything
	 * after it does rotate, which is what stops two consecutive turns showing
	 * the identical row — the thing the owner actually complained about.
	 */
	const anchor: Suggestion =
		asset === null
			? { label: COPY.fallbackTradeableLabel, send: COPY.fallbackTradeableSend }
			: { label: COPY.fallbackAssetLabel(asset), send: COPY.fallbackAssetSend(asset) };
	const pool: Suggestion[] = [
		{ label: COPY.fallbackEducationLabel, send: COPY.fallbackEducationSend },
		{ label: COPY.fallbackRiskLabel, send: COPY.fallbackRiskSend },
		{ label: COPY.cheapestLabel, send: COPY.cheapestSend },
		{ label: COPY.explainLabel, send: COPY.explainSend },
		{ label: COPY.prdExpiry, send: COPY.prdExpiry },
		{ label: COPY.prdProfit, send: COPY.prdProfit },
		...(asset === null ? [] : [{ label: COPY.startHedgeLabel(asset), send: COPY.startHedgeSend(asset) }]),
		...rfqChips(asset),
		...walletChips(input),
	];
	const tail = rotate(pool, input.turn)
		.filter((chip) => chip.label !== anchor.label)
		.slice(0, MAX_SUGGESTIONS - 2);
	return [anchor, ...tail];
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
		{ label: COPY.positionsLabel, send: COPY.positionsSend },
	];
}

/**
 * The two chips a confirmed RFQ earns.
 *
 * Deterministic, like `postFillSuggestions`: the row id comes back from the
 * recording call inside `RfqExecution`, so no model turn ever sees it and no
 * trailer can propose these. Both SEND text rather than linking, because there
 * is no RFQ route in this app — the request lives in the conversation and in the
 * card, and W2's tools read it by id.
 */
export function postRfqSuggestions(rfqRequestId: string): Chip[] {
	return [
		{ label: COPY.postRfqStatusLabel, send: COPY.postRfqStatusSend(rfqRequestId) },
		{ label: COPY.postRfqCancelLabel, send: COPY.postRfqCancelSend(rfqRequestId) },
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
export function chipsForTurn(
	input: ChipState & {
		readonly parts: readonly TurnPart[] | null | undefined;
		readonly streaming?: boolean;
	},
): Suggestion[] {
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

	const state: ChipState = { turn: input.turn, signedIn: input.signedIn, asset: input.asset };
	const fromTools = suggestionsFor(parts, state);
	if (fromTools.length > 0) return fromTools;

	return fallbackSuggestions(state);
}
