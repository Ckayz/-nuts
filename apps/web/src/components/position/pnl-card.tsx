import { CheckIcon } from "@/components/icons";
import { Avatar, StatusChip } from "@/components/primitives";
import type { PnlBasis, PnlCard as PnlCardView } from "@/lib/display-types";

/**
 * The live P&L card a trader copies a link to.
 *
 * Shape from the owner's reference (fomo's post-trade share card, 2026-09-05):
 * owner + status chip + date, the instrument, one big signed figure with the
 * percent in brackets, then three stat tiles. fomo's wiggly price line is
 * deliberately absent — Thetanuts publishes a spot price and no history, and the
 * owner removed the charts rather than draw an example series.
 *
 * Colours follow the house rule: colour is for numbers only. The figure carries
 * `pnlClass`; the labels, the name and the tiles stay neutral.
 *
 * `compact` is a size, not a different card: the same values, tightened for a
 * feed unfurl, with the long basis sentence replaced by the one word that says
 * what kind of number it is. Nothing is hidden that changes its meaning.
 */
const BASIS_SHORT: Record<PnlBasis, string> = {
	settled: "settled result",
	estimate: "estimate",
	derived: "estimate at spot",
	unavailable: "unavailable",
};

export function PnlCard({ card, compact }: { card: PnlCardView; compact?: boolean }) {
	const figureSize = compact ? "28px" : "44px";
	return (
		<div
			className="panel"
			style={{ gap: compact ? "9px" : "14px", padding: compact ? "12px" : "18px" }}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
				<Avatar initials={card.owner.initials} size={compact ? "s" : undefined} />
				<span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 }}>
					<b style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
						{card.owner.displayName}
					</b>
					<span className="mono" style={{ fontSize: "12px", color: "var(--tn-m)" }}>
						@{card.owner.handle}
					</span>
				</span>
				<StatusChip status={card.statusTone} label={card.statusLabel} style={{ marginLeft: "6px" }} />
				<span
					className="mono"
					style={{ marginLeft: "auto", fontSize: "12px", color: "var(--tn-dim)", whiteSpace: "nowrap" }}
				>
					{card.dateLabel}
				</span>
			</div>

			<div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
				<span
					className="mono"
					style={{ fontSize: compact ? "12px" : "13px", color: "var(--tn-k)" }}
				>
					{card.instrumentLabel}
				</span>
				<span className={card.side} style={{ fontSize: "12px", fontWeight: 600 }}>
					{card.sideLabel}
				</span>
				{card.verified ? (
					<span className="verified">
						<CheckIcon />
						verified
					</span>
				) : null}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
				<div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
					<span
						className={`mono ${card.pnl.pnlClass}`}
						style={{ fontSize: figureSize, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1 }}
					>
						{card.pnl.signed2}
					</span>
					{card.pnlPctLabel ? (
						<span className="mono" style={{ fontSize: compact ? "12px" : "15px", color: "var(--tn-m)" }}>
							({card.pnlPctLabel})
						</span>
					) : null}
				</div>
				<span className="lbl">{card.pnlLabel}</span>
				<span className="note">{compact ? BASIS_SHORT[card.basis] : card.pnlBasisLabel}</span>
			</div>

			{/* The mockup's `.board` lays tiles out in one row. Here they wrap instead
			    of overflowing: a P&L figure that runs past the card edge is the one
			    thing this card must never do. */}
			<div
				className="board"
				style={{
					gridAutoFlow: "row",
					gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))",
				}}
			>
				{card.stats.map((stat) => (
					<div
						key={stat.label}
						style={{ padding: compact ? "8px 12px" : "10px 16px", minWidth: 0 }}
					>
						<span className="lbl">{stat.label}</span>
						<span
							className="v"
							style={{
								fontSize: compact ? "15px" : "19px",
								overflowWrap: "anywhere",
							}}
						>
							{stat.value}
						</span>
					</div>
				))}
			</div>

			{card.tx ? (
				<a className="tx" href={card.tx.href} target="_blank" rel="noreferrer noopener">
					tx {card.tx.label}
				</a>
			) : null}
		</div>
	);
}
