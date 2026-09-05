import { Avatar } from "@/components/primitives";
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
 */
export function PostText({
	text,
	tokens,
	className = "t",
}: {
	text: string;
	tokens: readonly TextToken[] | undefined;
	className?: string;
}) {
	if (tokens === undefined) return <p className={className}>{text}</p>;
	return (
		<p className={className}>
			{tokens.map((token, index) =>
				// Tokens are positional slices of one immutable string rebuilt
				// deterministically on every render, so the index is a stable key.
				token.kind === "text" ? (
					<span key={index}>{token.value}</span>
				) : (
					<a key={index} href={token.href} className="mono">
						{token.label}
					</a>
				),
			)}
		</p>
	);
}

/**
 * The compact trade card a post's `/p/<uuid>` link unfurls into, X-style: the
 * link stays in the text and the position it points at renders as a clickable
 * card underneath (owner 2026-09-05).
 *
 * Layout follows the share card the owner sent (`.demo/fomo-share-card.png`):
 * owner + status, the instrument, one big signed P&L with a percent, and three
 * stat tiles. No chart and no price line — Thetanuts publishes no price history
 * and the owner removed the charts.
 *
 * WHY `<a>` AND NOT `<Link>`: `typedRoutes` is on and `/p/[id]` is built by
 * another worker this round, so `<Link href={`/p/${id}`}>` does not type-check
 * here — measured: "Type '`/p/${string}`' is not assignable to type
 * 'UrlObject | RouteImpl<`/p/${string}`>'". Once that route lands this becomes a
 * one-word swap to `<Link>` for client-side navigation.
 *
 * WHY INLINE STYLES: `src/index.css` belongs to another worker's fence this
 * round. Every value below is an existing design token, and the card surface
 * repeats the mockup's `.poscard` surface exactly (background `--tn-s`, border
 * `--tn-l`, radius 12px, padding 12px 14px). Neutral labels, colour only on
 * numbers — the house colour rule.
 */
export function TradeCard({ card }: { card: TradeCardView }) {
	return (
		<a
			href={card.href}
			aria-label={`Position by ${card.owner.displayName}: ${card.instrumentLabel}, ${card.pnlLabel} ${card.pnlUsd.signed}`}
			style={{
				display: "block",
				background: "var(--tn-s)",
				border: "1px solid var(--tn-l)",
				borderRadius: "12px",
				padding: "12px 14px",
				color: "inherit",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
				<Avatar initials={card.owner.initials} size="s" />
				<b style={{ fontWeight: 600 }}>{card.owner.displayName}</b>
				<span className="mono mut" style={{ fontSize: "12px" }}>
					@{card.owner.handle}
				</span>
				<span className="tag" style={{ marginLeft: "auto" }}>
					{card.sideLabel}
				</span>
				<span className="tag">{card.statusLabel}</span>
			</div>

			<div className="lbl" style={{ marginTop: "10px" }}>
				{card.instrumentLabel}
			</div>

			<div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
				<span
					className={`mono ${card.pnlUsd.pnlClass}`}
					style={{ fontSize: "26px", fontWeight: 600, letterSpacing: "-.01em" }}
				>
					{card.pnlUsd.signed}
				</span>
				{card.pnlPct === null ? null : (
					<span className="mono" style={{ fontSize: "12px" }}>
						<span className={card.pnlUsd.pnlClass}>{card.pnlPct.value}</span>
						<span className="mut"> {card.pnlPct.basis}</span>
					</span>
				)}
				<span className="mut" style={{ fontSize: "12px", marginLeft: "auto" }}>
					{card.pnlLabel}
				</span>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
					gap: "10px",
					marginTop: "10px",
					paddingTop: "10px",
					borderTop: "1px solid var(--tn-l)",
				}}
			>
				{card.stats.map((stat) => (
					<div key={stat.label} style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
						<span className="lbl">{stat.label}</span>
						<span className="mono" style={{ fontSize: "14px", fontWeight: 600 }}>
							{stat.value}
						</span>
					</div>
				))}
			</div>
		</a>
	);
}

/** The linked cards under a post's text; renders nothing when there are none. */
export function TradeCards({ cards }: { cards: readonly TradeCardView[] | undefined }) {
	if (cards === undefined || cards.length === 0) return null;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
			{cards.map((card) => (
				<TradeCard key={card.positionId} card={card} />
			))}
		</div>
	);
}
