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
 *
 * D-8 (lane D). A run may not BEGIN part-way through a token. Group 1 is the
 * character before the figure and is not part of the run: it must not be a
 * digit, a letter, `_`, `.` or `,`, which is what left
 * `1e8 units, 1_000_000 USDC` rendering as `1_000_`+**`000 USDC`** — a number
 * split in half on screen. A capture group rather than a lookbehind on purpose:
 * lookbehind is a 2023 addition to Safari, and a SyntaxError in a module the
 * chat imports takes the whole page down.
 *
 * WHAT THIS DOES NOT DECIDE, stated because the reviewer raised it: a bare
 * integer followed by a ticker — "Block 12345678 ETH" — is still read as money.
 * Nothing in the string distinguishes it from an amount, and the rule that
 * would (a cap on the digits, or on the decimals) was measured to reject
 * figures the agent really prints: `9.999995 USDC` is a premium it quoted in a
 * captured turn. A false positive there costs emphasis on a number; a false
 * negative costs the colour on real money.
 */
const MONEY =
	/(^|[^0-9A-Za-z_.,])(\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:aBasUSDC|USDC|USD|cbBTC|WETH|ETH|BTC)\b)/g;

/** The same grammar, NOT global: for one-off "is there a figure in here" asks. */
const MONEY_ONE = new RegExp(MONEY.source);

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
 *
 * T-3 (Opus user-flow tester): a bare `premium` was added, replacing
 * `premium you.?d pay`. The agent draws a `PREMIUM PER CONTRACT` column and the
 * narrower cue did not match it, so the column-header feature this file
 * documents did not fire for the column the model actually writes.
 */
const LOSS_LABEL =
	/max(?:imum)? loss|you (?:could|would) lose|lose|cost|premium|escrow|deposit|you pay|risk/gi;

/**
 * The words that make the number beside them a GAIN.
 *
 * TODO-OWNER: same decision as the loss list above.
 *
 * T-3: "you would be up …" was added. It is how the model states a gain in
 * prose, and without it the ONE figure the colour exists for — the profit —
 * read neutral while a strike two sentences away read green.
 */
const GAIN_LABEL =
	/max(?:imum)? payout|profit|you (?:make|receive|get back)|payout|you would receive|proceeds|you(?:'d| would)? be up|you(?:'re| are) up/gi;

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
 * The part of the context that is still the CURRENT sentence.
 *
 * T-3 (Opus user-flow tester). "Nearest wins" was applied to the whole
 * preceding block, so one cue coloured every figure after it to the end of the
 * paragraph. Measured in a browser: a reply that said "profit" once printed
 * `$2540` — a STRIKE — in the gain colour, which is not money made and, by the
 * design rule ("colour only on money"), not money at all.
 *
 * A sentence is the bound because it is the unit a cue actually describes. A
 * newline is NOT a boundary: the column header a table cell is given arrives
 * as `header\ncell`, and cutting there would silence the column-label feature
 * this file exists to provide. A full stop between two digits is not a boundary
 * either — that is a decimal point.
 */
function currentSentence(text: string): string {
	const digit = (at: number): boolean => {
		const char = text[at];
		return char !== undefined && char >= "0" && char <= "9";
	};
	for (let at = text.length - 1; at >= 0; at--) {
		const char = text[at];
		if (char === ";" || char === "!" || char === "?" || char === "\u2014") return text.slice(at + 1);
		if (char === "." && !(digit(at - 1) && digit(at + 1))) return text.slice(at + 1);
	}
	return text;
}

/**
 * Loss, gain, or neither, for one stretch of label text.
 *
 * NEAREST WINS, WITHIN THE SENTENCE: whichever of the two lists matched LAST in
 * the current sentence is the one that describes the number that comes after
 * it. "The most you can lose is the premium; the payout above the strike is"
 * ends in a gain word, so the figure after it is a gain — which is the reading
 * a person would give it.
 *
 * Backward. A cue that FOLLOWS a figure is handled separately and much more
 * narrowly by `trailingMoneyKind`, because an unrestricted forward scan reads
 * the cue belonging to the NEXT figure: measured on the reviewer's own sentence
 * — "The strike is $2,540 and the premium you'd pay is 9.99 USDC" — it colours
 * the STRIKE as a loss.
 */
export function moneyKind(label: string | null | undefined): "loss" | "gain" | null {
	if (typeof label !== "string" || label === "") return null;
	const sentence = currentSentence(label);
	const loss = lastMatchAt(sentence, LOSS_LABEL);
	const gain = lastMatchAt(sentence, GAIN_LABEL);
	if (loss === -1 && gain === -1) return null;
	return gain > loss ? "gain" : "loss";
}

/**
 * The cue that comes AFTER a figure, when there is nothing else for it to mean.
 *
 * T-3. The model writes both orders — "the most you can lose is $10" and
 * "capped at $10 of risk" — and sentence-bounding the backward scan (rightly)
 * took the colour off the second. The narrow rule that gives it back without
 * mis-colouring anything: a trailing cue describes the LAST figure of its
 * sentence, so it is used only when NO other money figure lies between it and
 * the end of that sentence. In "The strike is $2,540 and the premium you'd pay
 * is 9.99 USDC" the cue has a later figure to describe, so the strike is left
 * alone — measured, and the reason this is not a plain forward scan.
 *
 * `after` is the text following the figure, in the same text node.
 */
export function trailingMoneyKind(after: string): "loss" | "gain" | null {
	if (after === "") return null;
	// The rest of THIS sentence only.
	const digit = (at: number): boolean => {
		const char = after[at];
		return char !== undefined && char >= "0" && char <= "9";
	};
	let end = after.length;
	for (let at = 0; at < after.length; at++) {
		const char = after[at];
		if (char === ";" || char === "!" || char === "?" || char === "\u2014" || (char === "." && !(digit(at - 1) && digit(at + 1)))) {
			end = at;
			break;
		}
	}
	const rest = after.slice(0, end);
	// Another figure in the same sentence: the cue is that one's, not this one's.
	// A NON-GLOBAL copy: `MONEY` is sticky-by-`lastIndex` and this runs INSIDE
	// `moneyParts`'s own `MONEY.exec` loop — sharing it rewound that loop and
	// hung the render (measured: the test run never returned).
	if (MONEY_ONE.test(rest)) return null;
	// NEAREST wins again, which forwards means the FIRST cue rather than the last.
	const first = (pattern: RegExp): number => {
		pattern.lastIndex = 0;
		const match = pattern.exec(rest);
		return match === null ? -1 : match.index;
	};
	const loss = first(LOSS_LABEL);
	const gain = first(GAIN_LABEL);
	if (loss === -1 && gain === -1) return null;
	if (loss === -1) return "gain";
	if (gain === -1) return "loss";
	return gain < loss ? "gain" : "loss";
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
		// D-8: group 1 is the boundary character, which belongs to the prose.
		const run = match[2] ?? "";
		const start = match.index + (match[1]?.length ?? 0);
		if (start > at) parts.push({ text: text.slice(at, start), kind: "text" });
		const end = start + run.length;
		const kind = moneyKind(`${label ?? ""}\n${text.slice(0, start)}`) ?? trailingMoneyKind(text.slice(end));
		parts.push({ text: run, kind: kind ?? "neutral" });
		at = end;
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
