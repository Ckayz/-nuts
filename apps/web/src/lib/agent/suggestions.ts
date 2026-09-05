/**
 * Follow-up chips, derived from what the tools actually returned.
 *
 * Deliberately pure and server-free: no model call, no network, no clock. The
 * model is not asked to invent follow-ups, because a model can suggest something
 * the agent cannot do, and because an extra generation on every message costs
 * tokens the owner pays for. Everything here is read out of a tool result that
 * already came back, so a chip can only ever name an instrument that exists.
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
