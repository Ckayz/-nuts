"use client";

import {
	Children,
	Fragment,
	createContext,
	isValidElement,
	useContext,
	type ComponentProps,
	type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { moneyClass, moneyParts } from "./agent-money";
import { isMarketPath, marketLinkParts } from "./market-link";

/**
 * Renders an assistant reply.
 *
 * Until now the reply was one `<p className="whitespace-pre-wrap">`, so a model
 * that writes `**BTC** $79,734.89` displayed the asterisks. It writes markdown
 * because the system prompt is written in markdown.
 *
 * Two properties this must not lose:
 *
 * 1. **Only `/m/<asset>` and `/p/<uuid>` become links.** `marketLinkParts` is deliberately
 *    narrow so no other text the model produces can become a destination. That
 *    property is the reason it exists, so the renderer never autolinks: every
 *    text node goes through the same function, and the `a` element below is the
 *    only anchor this component can emit.
 * 2. **No raw HTML.** `react-markdown` does not render HTML unless
 *    `rehype-raw` is added. It is not installed, and must not be.
 *
 * Styling lives in `apps/web/src/styles/agent.css` on `.agent-md`, using the
 * app's own tokens. `@tailwindcss/typography` is deliberately not used: its
 * greys and serifs contradict the one-accent design rule.
 *
 * W4 (owner 2026-09-06 12:4x, "can you like make the font some bold some diff
 * colour etc?"): every money figure is wrapped in a `.agent-money` span and
 * coloured by what the sentence around it MEANS — see `./agent-money.ts`, which
 * holds the whole reading rule and is tested on real replies. Nothing else
 * gains colour: the accent list stays closed and labels stay neutral.
 */

/* ------------------------------------------------------------------ *
 * Table context: which column a cell is in, and what that column is called
 * ------------------------------------------------------------------ */

/**
 * The header cells of the table being rendered, in order.
 *
 * A `td` needs its COLUMN HEADER to know whether "9.99 USDC" is a cost or a
 * payout, and react-markdown hands a cell component no column index and no
 * sibling information. Two contexts carry it: the table publishes its headers,
 * and the row wraps each cell with its own position. Both render no DOM.
 */
const ColumnLabels = createContext<readonly string[]>([]);
const ColumnAt = createContext<number>(-1);

/** A hast node, as react-markdown hands it to a component. */
interface HastNode {
	readonly type?: string;
	readonly tagName?: string;
	readonly value?: string;
	readonly children?: readonly HastNode[];
}

function hastText(node: HastNode | undefined): string {
	if (node === undefined) return "";
	if (node.type === "text") return node.value ?? "";
	return (node.children ?? []).map(hastText).join("");
}

/** The first row's cell texts — GFM always emits the header row first. */
function headerTexts(node: unknown): string[] {
	const rows: HastNode[] = [];
	const collect = (current: HastNode | undefined) => {
		if (current === undefined || rows.length > 0) return;
		if (current.tagName === "tr") {
			rows.push(current);
			return;
		}
		for (const child of current.children ?? []) collect(child);
	};
	collect(node as HastNode | undefined);
	const first = rows[0];
	if (first === undefined) return [];
	return (first.children ?? [])
		.filter((cell) => cell.tagName === "th" || cell.tagName === "td")
		.map(hastText);
}

/* ------------------------------------------------------------------ *
 * Inline rendering
 * ------------------------------------------------------------------ */

/**
 * The text an element contributes as CONTEXT, without rewriting it.
 *
 * `**Max loss:** 9.99 USDC` puts the label inside a `<strong>` the walker below
 * deliberately does not descend into, so without this the figure beside it
 * would read as neutral. Read-only: nothing here returns an element.
 */
function plainText(node: ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map((child) => plainText(child as ReactNode)).join("");
	if (isValidElement(node)) return plainText((node.props as { children?: ReactNode }).children);
	return "";
}

/** Money runs of one prose fragment. */
function moneySpans(text: string, label: string, keyPrefix: string): ReactNode {
	const parts = moneyParts(text, label);
	if (parts.length === 1 && parts[0]?.kind === "text") return text;
	return parts.map((part, i) => {
		const className = moneyClass(part.kind);
		return className === null ? (
			<Fragment key={`${keyPrefix}.m${i}`}>{part.text}</Fragment>
		) : (
			<span key={`${keyPrefix}.m${i}`} className={className}>
				{part.text}
			</span>
		);
	});
}

/**
 * One string child: the market-link split first, then the money pass over the
 * pieces that did NOT become links. A destination is never re-styled.
 */
function renderString(text: string, keyPrefix: string, label: string): ReactNode {
	let offset = 0;
	return marketLinkParts(text).map((piece, i) => {
		// The label for a figure is everything before it, nearest last: the row's
		// own label, then whatever this string said before this piece.
		const pieceLabel = `${label}\n${text.slice(0, offset)}`;
		offset += piece.text.length;
		return piece.href === null ? (
			<Fragment key={`${keyPrefix}.${i}`}>{moneySpans(piece.text, pieceLabel, `${keyPrefix}.${i}`)}</Fragment>
		) : (
			<a key={`${keyPrefix}.${i}`} className="agent-md-link" href={piece.href}>
				{piece.text}
			</a>
		);
	});
}

/**
 * Every STRING child gets the market-link and money treatment, nothing else does.
 *
 * D-N1 (lane D confirming pass). This used to return its children untouched
 * unless they were ONE string, and react-markdown hands a paragraph an ARRAY as
 * soon as it contains any formatting. Measured before the fix:
 *
 *   "Trade /m/btc"             -> <p>Trade <a href="/m/btc">/m/btc</a></p>
 *   "Trade **BTC** at /m/btc"  -> <p>Trade <strong>BTC</strong> at /m/btc</p>
 *
 * i.e. one bold word anywhere in the paragraph silently killed the Explain ->
 * market handoff. Every string in the child list is treated on its own now.
 *
 * Elements OTHER than fragments are left alone: their own component (`p`, `li`,
 * `td`, `th`) does the same work when react-markdown renders them, and
 * descending into an arbitrary element would mean rewriting children this
 * component does not own — including `code`, where a URL is quoted text and
 * must stay text, and where an amount is a quoted amount and must not be
 * coloured. A URL wrapped in bold markers therefore stays text; that is
 * deliberate, not an oversight.
 *
 * `seen` accumulates, IN ORDER, the plain text of everything already walked, so
 * a label in an earlier sibling still governs the figure that follows it.
 */
function walk(node: ReactNode, keyPrefix: string, label: string, seen: { text: string }): ReactNode {
	if (typeof node === "string") {
		const rendered = renderString(node, keyPrefix, `${label}\n${seen.text}`);
		seen.text += node;
		return rendered;
	}
	if (Array.isArray(node)) {
		return node.map((child, i) => (
			<Fragment key={`${keyPrefix}.${i}`}>{walk(child as ReactNode, `${keyPrefix}.${i}`, label, seen)}</Fragment>
		));
	}
	// A fragment is not an element the caller owns — it is a grouping, so its
	// children are still this function's business.
	if (isValidElement(node) && node.type === Fragment) {
		const { children } = node.props as { children?: ReactNode };
		return <Fragment key={keyPrefix}>{walk(children, `${keyPrefix}.f`, label, seen)}</Fragment>;
	}
	if (isValidElement(node)) seen.text += plainText(node);
	return node;
}

function LinkedText({ children, label = "" }: { readonly children?: ReactNode; readonly label?: string }) {
	return <>{walk(children, "l", label, { text: "" })}</>;
}

/**
 * A markdown link. The model is only ever told to emit app-relative market
 * URLs, so anything else is rendered as its own text rather than followed —
 * a model-authored destination is not a destination this app offers.
 *
 * B2: the grammar now also admits `/p/<uuid>`, the position page
 * `lib/agent/positions.ts` returns as `path` on every row, so "open it" is a
 * link. It is exactly a uuid — `/p/x` and `/p/../portfolio` stay text.
 *
 * D-n1: the test used to be `href.startsWith("/m/")`, which is not the grammar.
 * Measured before the fix, both of these became live anchors:
 *
 *   [Trade](/m/../portfolio)          -> <a href="/m/../portfolio">
 *   [Trade](/m/btc?thesis=not-a-uuid) -> <a href="/m/btc?thesis=not-a-uuid">
 *
 * `isMarketPath` is the SAME expression `marketLinkParts` uses, anchored, so
 * the two entry points cannot drift apart.
 */
function SafeAnchor({ href, children }: ComponentProps<"a">) {
	const internal = typeof href === "string" && isMarketPath(href);
	if (!internal) return <>{children}</>;
	return (
		<a className="agent-md-link" href={href}>
			{children}
		</a>
	);
}

/**
 * A heading a model wrote, rendered as emphasised prose.
 *
 * `LinkedText` runs over it for the same reason it runs over paragraphs and
 * list items: a market path inside a heading is still a market path.
 */
function Heading({ children }: ComponentProps<"h1">) {
	return (
		<p className="agent-md-heading">
			<strong>
				<LinkedText>{children}</LinkedText>
			</strong>
		</p>
	);
}

function MdTable({ node, children }: { node?: unknown; children?: ReactNode }) {
	return (
		<ColumnLabels.Provider value={headerTexts(node)}>
			<table>{children}</table>
		</ColumnLabels.Provider>
	);
}

/** Publishes each cell's position so `MdCell` can look its column header up. */
function MdRow({ children }: { children?: ReactNode }) {
	let column = -1;
	return (
		<tr>
			{Children.map(children, (child) => {
				if (!isValidElement(child)) return child;
				column += 1;
				return <ColumnAt.Provider value={column}>{child}</ColumnAt.Provider>;
			})}
		</tr>
	);
}

function MdCell({ children }: { children?: ReactNode }) {
	const labels = useContext(ColumnLabels);
	const at = useContext(ColumnAt);
	const label = at < 0 ? "" : (labels[at] ?? "");
	return (
		<td>
			<LinkedText label={label}>{children}</LinkedText>
		</td>
	);
}

export function AgentMarkdown({ text }: { readonly text: string }) {
	return (
		<div className="agent-md">
			<Markdown
				remarkPlugins={[remarkGfm]}
				// Anything not listed renders as its children, never as an element.
				allowedElements={[
					"p",
					"strong",
					"em",
					"ul",
					"ol",
					"li",
					// D-minor (lane D pass 2): h1-h4 stay LISTED so `components` below can
					// rewrite them; removing them here instead was measured to unwrap a
					// reply's "# BTC" to a bare text node with no emphasis at all
					// (`<div class="agent-md">BTC\n<p>...</p></div>`).
					"h1",
					"h2",
					"h3",
					"h4",
					"code",
					"pre",
					"blockquote",
					"hr",
					"br",
					"a",
					"table",
					"thead",
					"tbody",
					"tr",
					"th",
					"td",
				]}
				unwrapDisallowed
				components={{
					a: SafeAnchor,
					// A MODEL REPLY OWNS NO HEADING. `/m/<asset>` already renders the
					// page's only `<h1>` and the panel beside it renders an `<h2>`
					// (`agent-heading.test.tsx`); a reply beginning "# BTC" put a SECOND
					// `<h1>` on that page (measured: `page {"h1":2}`), undoing that fold
					// from inside the conversation. Every heading level a reply writes is
					// rendered as emphasised paragraph text instead — no new element
					// types, and nothing joins the document outline.
					h1: Heading,
					h2: Heading,
					h3: Heading,
					h4: Heading,
					p: ({ children }) => (
						<p>
							<LinkedText>{children}</LinkedText>
						</p>
					),
					li: ({ children }) => (
						<li>
							<LinkedText>{children}</LinkedText>
						</li>
					),
					// Table cells and quotes carry the same prose, so they carry
					// the same treatment. A blockquote's children are normally a
					// `<p>` element, which `p` above already handles; wrapping it
					// costs nothing and covers the shape where they are not.
					//
					// W4: a `td` also reads its COLUMN HEADER, published by `MdTable`
					// and located by `MdRow`, so a "Max loss" column colours its own
					// cells even when the cell says only a number.
					table: MdTable,
					tr: MdRow,
					td: MdCell,
					th: ({ children }) => (
						<th>
							<LinkedText>{children}</LinkedText>
						</th>
					),
					blockquote: ({ children }) => (
						<blockquote>
							<LinkedText>{children}</LinkedText>
						</blockquote>
					),
				}}
			>
				{text}
			</Markdown>
		</div>
	);
}
