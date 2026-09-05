"use client";

import type { ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { marketLinkParts } from "./market-link";

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

/** Every text node in the tree gets the market-link treatment, nothing else does. */
function LinkedText({ children }: { readonly children?: unknown }) {
	if (typeof children !== "string") return <>{children as never}</>;
	return (
		<>
			{marketLinkParts(children).map((piece, i) =>
				piece.href === null ? (
					piece.text
				) : (
					<a key={i} className="agent-md-link" href={piece.href}>
						{piece.text}
					</a>
				),
			)}
		</>
	);
}

/**
 * A markdown link. The model is only ever told to emit app-relative market
 * URLs, so anything else is rendered as its own text rather than followed —
 * a model-authored destination is not a destination this app offers.
 */
function SafeAnchor({ href, children }: ComponentProps<"a">) {
	const internal = typeof href === "string" && href.startsWith("/m/");
	if (!internal) return <>{children}</>;
	return (
		<a className="agent-md-link" href={href}>
			{children}
		</a>
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
				}}
			>
				{text}
			</Markdown>
		</div>
	);
}
