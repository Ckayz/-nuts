import { Avatar, Chip } from "@/components/primitives";
import type { TextToken, TradeCard as TradeCardView } from "@/lib/display-types";

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

/** The coloured arrow beside a percent; the number itself stays neutral. */
export function PnlArrow({ pnlClass }: { pnlClass: string }) {
	if (pnlClass === "") return null;
	return <em className={pnlClass}>{pnlClass === "bear" ? "▼" : "▲"}</em>;
}

/**
 * The compact trade card a post's `/p/<uuid>` link unfurls into, X-style: the
 * link stays in the text and the position it points at renders as a clickable
 * card underneath (owner 2026-09-05).
 *
 * Shape is the mockup's `.tcard` (docs/mockups/thesis-fun-mockup.html): asset
 * avatar, instrument, status chip and date on top; one sub-line; the big signed
 * P&L with its percent; three stat tiles. No chart and no price line —
 * Thetanuts publishes no price history and the owner removed the charts.
 *
 * DIVERGENCE, reported: the mockup's top-right slot is the expiry date, and
 * `View.TradeCard` carries no date. It shows the position's OWNER instead,
 * which the shape does carry and which matters here — a post can link somebody
 * else's position.
 */
export function TradeCard({ card }: { card: TradeCardView }) {
	return (
		<a
			className="tcard"
			href={card.href}
			aria-label={`Position by ${card.owner.displayName}: ${card.instrumentLabel}, ${card.pnlLabel} ${card.pnlUsd.signed}`}
		>
			<div className="tc-top">
				{/* The owner, not the asset: `View.TradeCard`'s instrument label IS
				    the ticker, so an asset avatar beside it would print it twice —
				    and an unfurled link can point at somebody else's position. */}
				<Avatar initials={card.owner.initials} size={26} />
				<span className="tc-inst">{card.instrumentLabel}</span>
				<Chip flat={card.settled}>{card.statusLabel}</Chip>
				<span className="tc-date">@{card.owner.handle}</span>
			</div>
			<div className="tc-sub">
				{card.sideLabel} · {card.pnlLabel}
			</div>
			<div className="tc-pnl">
				<b className={`num ${card.pnlUsd.pnlClass}`}>{card.pnlUsd.signed}</b>
				{card.pnlPct === null ? null : (
					<span className="num">
						<PnlArrow pnlClass={card.pnlUsd.pnlClass} /> {card.pnlPct.value}{" "}
						<span className="mut">{card.pnlPct.basis}</span>
					</span>
				)}
			</div>
			<div className="tiles">
				{card.stats.map((stat) => (
					<span className="tile" key={stat.label}>
						<i>{stat.label}</i>
						<b className="num">{stat.value}</b>
					</span>
				))}
			</div>
		</a>
	);
}

/** The linked cards under a post's text; renders nothing when there are none. */
export function TradeCards({ cards }: { cards: readonly TradeCardView[] | undefined }) {
	if (cards === undefined || cards.length === 0) return null;
	return (
		<>
			{cards.map((card) => (
				<TradeCard key={card.positionId} card={card} />
			))}
		</>
	);
}
