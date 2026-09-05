import { PnlCard } from "@/components/position/pnl-card";
import type { PnlCard as PnlCardView, TextToken } from "@/lib/display-types";

/**
 * A post's rationale with its `/p/<uuid>` links left clickable.
 *
 * Every token is rendered as a React child, so React escapes the author's text
 * and no caller needs `dangerouslySetInnerHTML`. A link token's `href` was
 * REBUILT by `lib/thesis/links.ts` as `/p/<uuid>`; it is never the matched
 * text, so a link carrying another URL in its query string redirects nowhere.
 *
 * `tokens` is absent for a post built by a producer that predates this round —
 * the plain `text` is then rendered unchanged.
 *
 * `as` exists because the mockup's post body is ONE paragraph whose second
 * block is the rationale (`.p-body .second`), and a `<p>` inside a `<p>` is not
 * parseable HTML. The default stays `p` for `/t/[slug]` and the composer.
 */
export function PostText({
	text,
	tokens,
	className = "t",
	as: As = "p",
}: {
	text: string;
	tokens: readonly TextToken[] | undefined;
	className?: string;
	as?: "p" | "span";
}) {
	if (tokens === undefined) return <As className={className}>{text}</As>;
	return (
		<As className={className}>
			{tokens.map((token, index) =>
				// Tokens are positional slices of one immutable string rebuilt
				// deterministically on every render, so the index is a stable key.
				token.kind === "text" ? (
					<span key={index}>{token.value}</span>
				) : (
					<a key={index} href={token.href}>
						{token.label}
					</a>
				),
			)}
		</As>
	);
}

/**
 * The cards a post's `/p/<uuid>` links unfurl into, X-style: the link stays in
 * the text and the position it points at renders as a clickable card underneath
 * (owner 2026-09-05).
 *
 * The card itself is `components/position/pnl-card.tsx` at its compact size —
 * ONE component and ONE builder for every card in the product (round-1 fold
 * item 9), so an unfurled position and its own `/p/[id]` page cannot state
 * different numbers about the same fill. Renders nothing when there are none.
 */
export function TradeCards({ cards }: { cards: readonly PnlCardView[] | undefined }) {
	if (cards === undefined || cards.length === 0) return null;
	return (
		<>
			{cards.map((card) => (
				<PnlCard key={card.id} card={card} compact href />
			))}
		</>
	);
}
