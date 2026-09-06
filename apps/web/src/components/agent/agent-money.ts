/**
 * Which numbers in a reply are MONEY, and whether that money is what the reader
 * stands to lose or what they stand to make.
 *
 * Owner 2026-09-06 12:4x, verbatim: "can you like make the font some bold some
 * diff colour etc? so it easier and nicer to see". Before this every figure in
 * a reply was the same white as the prose around it, so "you pay 9.999995 USDC
 * and can lose all of it" read exactly like "market makers have 60 minutes".
 *
 * The design rules bind and they are narrow (CLAUDE.md "Design direction"):
 * ONE accent, reserved for primary buttons, the active tab underline, the
 * selected side, the share-card frame and focus rings — so the accent is NOT
 * available here. Colour is for MONEY only, in the two money tokens `--gain`
 * and `--loss`, which is exactly what this file decides. A percentage is left
 * neutral, because the mockup's own rule is that the percent beside a P&L is
 * neutral with a coloured arrow.
 *
 * Pure, exported and tested rather than inlined in the renderer: the whole
 * question here is "does this sentence mean loss or gain", which is a judgement
 * about English, and a judgement about English is worth pinning to the exact
 * sentences the model actually writes.
 */

/**
 * What counts as money.
 *
 * A currency mark before the number, or a token symbol after it. Nothing else:
 * a bare number is a strike, a contract count, a block, a date or a percent,
 * and colouring those would break the "colour on money only" rule the same way
 * colouring a label would.
 *
 * `cbBTC`, `WETH` and `aBasUSDC` are collateral tokens the order book actually
 * quotes (`packages/thetanuts`); `USD` appears because the agent's own cap is
 * stated in USD (PRD 10.2).
 */
const MONEY =
	/\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:aBasUSDC|USDC|USD|cbBTC|WETH|ETH|BTC)\b/g;

/**
 * The words that make the number beside them a LOSS.
 *
 * Taken from the sentences the agent writes today, not invented: the prompt
 * tells the model to "make the downside concrete and early" and to say what the
 * user "pays" and "can lose", and the RFQ section tells it to call the escrow
 * "the user's maximum loss".
 *
 * TODO-OWNER: which words count. This is a reading rule, not product copy, but
 * it decides what turns red on screen.
 */
const LOSS_LABEL = /max(?:imum)? loss|you (?:could|would) lose|lose|cost|premium you.?d pay|escrow|deposit|you pay|risk/gi;

/**
 * The words that make the number beside them a GAIN.
 *
 * TODO-OWNER: same decision as the loss list above.
 */
const GAIN_LABEL = /max(?:imum)? payout|profit|you (?:make|receive|get back)|payout|you would receive|proceeds/gi;

/** The last index at which `pattern` matches `text`, or -1. */
function lastMatchAt(text: string, pattern: RegExp): number {
	let at = -1;
	pattern.lastIndex = 0;
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		at = match.index;
		// A zero-width match cannot happen with either list, but a runaway loop
		// would hang the render, so the index is advanced defensively.
		if (match[0].length === 0) pattern.lastIndex += 1;
	}
	return at;
}

/**
 * Loss, gain, or neither, for one stretch of label text.
 *
 * NEAREST WINS: whichever of the two lists matched LAST in the string is the
 * one that describes the number that comes after it. "The most you can lose is
 * the premium; the payout above the strike is" ends in a gain word, so the
 * figure after it is a gain — which is the reading a person would give it.
 */
export function moneyKind(label: string | null | undefined): "loss" | "gain" | null {
	if (typeof label !== "string" || label === "") return null;
	const loss = lastMatchAt(label, LOSS_LABEL);
	const gain = lastMatchAt(label, GAIN_LABEL);
	if (loss === -1 && gain === -1) return null;
	return gain > loss ? "gain" : "loss";
}

/** One run of a text node: prose, or a money figure with its meaning. */
export interface MoneyPart {
	readonly text: string;
	/** `text` is prose; the other three are money. */
	readonly kind: "text" | "neutral" | "loss" | "gain";
}

/**
 * Split one text node into prose and money runs.
 *
 * `label` is the context the caller already knows and this node does not carry:
 * the earlier children of the same paragraph or list item, and — inside a table
 * — the COLUMN HEADER, so a "Max loss" column colours its cells even though the
 * cell itself says only "9.99 USDC". It is concatenated in front of the text
 * before each match, so "nearest wins" resolves the two sources with no extra
 * rule: anything the sentence itself says beats anything the row said.
 *
 * Never called for the children of a `code` element — the renderer does not
 * descend into elements it does not own, which is what keeps a quoted amount
 * quoted.
 */
export function moneyParts(text: string, label?: string | null): MoneyPart[] {
	const parts: MoneyPart[] = [];
	let at = 0;
	MONEY.lastIndex = 0;
	for (let match = MONEY.exec(text); match !== null; match = MONEY.exec(text)) {
		const start = match.index;
		if (start > at) parts.push({ text: text.slice(at, start), kind: "text" });
		const kind = moneyKind(`${label ?? ""}\n${text.slice(0, start)}`);
		parts.push({ text: match[0], kind: kind ?? "neutral" });
		at = start + match[0].length;
	}
	if (parts.length === 0) return [{ text, kind: "text" }];
	if (at < text.length) parts.push({ text: text.slice(at), kind: "text" });
	return parts;
}

/** The class a money run wears. Neutral money is still emphasised, not coloured. */
export function moneyClass(kind: MoneyPart["kind"]): string | null {
	if (kind === "text") return null;
	return kind === "neutral" ? "agent-money" : `agent-money agent-money--${kind}`;
}
