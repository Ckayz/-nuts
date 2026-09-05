"use client";

import { Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
 * 1. **Only `/m/<asset>` becomes a link.** `marketLinkParts` is deliberately
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
 */

/**
 * Every STRING child gets the market-link treatment, nothing else does.
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
 * must stay text. A URL wrapped in bold markers therefore stays text; that is
 * deliberate, not an oversight.
 */
function linkStrings(node: ReactNode, keyPrefix: string): ReactNode {
	if (typeof node === "string") {
		return marketLinkParts(node).map((piece, i) =>
			piece.href === null ? (
				<Fragment key={`${keyPrefix}.${i}`}>{piece.text}</Fragment>
			) : (
				<a key={`${keyPrefix}.${i}`} className="agent-md-link" href={piece.href}>
					{piece.text}
				</a>
			),
		);
	}
	if (Array.isArray(node)) {
		return node.map((child, i) => (
			<Fragment key={`${keyPrefix}.${i}`}>{linkStrings(child as ReactNode, `${keyPrefix}.${i}`)}</Fragment>
		));
	}
	// A fragment is not an element the caller owns — it is a grouping, so its
	// children are still this function's business.
	if (isValidElement(node) && node.type === Fragment) {
		const { children } = node.props as { children?: ReactNode };
		return <Fragment key={keyPrefix}>{linkStrings(children, `${keyPrefix}.f`)}</Fragment>;
	}
	return node;
}

function LinkedText({ children }: { readonly children?: ReactNode }) {
	return <>{linkStrings(children, "l")}</>;
}

/**
 * A markdown link. The model is only ever told to emit app-relative market
 * URLs, so anything else is rendered as its own text rather than followed —
 * a model-authored destination is not a destination this app offers.
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
					td: ({ children }) => (
						<td>
							<LinkedText>{children}</LinkedText>
						</td>
					),
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
