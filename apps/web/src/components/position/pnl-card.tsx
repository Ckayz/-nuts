import { Avatar } from "@/components/primitives";
import type { PnlBasis, PnlCard as PnlCardView } from "@/lib/display-types";

/**
 * The share card — the signature object of the whole product.
 *
 * Shape and every pixel from `docs/mockups/thesis-fun-mockup.html`, template
 * `#tpl-sharecard` (lines 1004-1032): an accent frame around a near-black inner
 * card, owner + status chip + date across the top, the instrument, one very
 * large signed figure with the percent beside it, three stat tiles, and the
 * `thesis.fun` watermark on the frame's own footer. It is the hero of `/p/[id]`,
 * the body of the post-fill dialog, and the picture the Open Graph image draws.
 *
 * No price line. Thetanuts publishes a spot price and no history, and the owner
 * removed the charts rather than draw an example series.
 *
 * Colour rule, from the mockup's header: colour is on money only. The figure
 * carries the amount's own `.bull` / `.bear` class, which `src/index.css`
 * paints with the mockup's `--gain` / `--loss`; the name, the labels, the tiles
 * and the chip stay neutral, and the frame is the one accent surface.
 *
 * `compact` is a size, not a different card: same values, tightened for a feed
 * unfurl, with the long basis sentence replaced by the one word that says what
 * kind of number it is. Nothing that changes the number's meaning is dropped.
 */
const BASIS_SHORT: Record<PnlBasis, string> = {
	settled: "settled result",
	estimate: "estimate",
	derived: "estimate at spot",
	unavailable: "unavailable",
};

export function PnlCard({ card, compact }: { card: PnlCardView; compact?: boolean }) {
	const tone = card.pnl.pnlClass;
	// The mockup's ▲ / ▼ next to the percent. It is drawn only when the sign is
	// known: an unavailable P&L gets no arrow rather than a flat one that reads
	// as "no change".
	const arrow = tone === "bull" ? "▲" : tone === "bear" ? "▼" : null;
	return (
		<div className={compact ? "frame compact" : "frame"}>
			<div className="sc">
				<div className="sc-top">
					<Avatar initials={card.owner.initials} />
					<div style={{ minWidth: 0 }}>
						<div className="sc-name">{card.owner.displayName}</div>
						<span className={card.statusTone === "settled" ? "chip flat" : "chip"}>
							{card.statusLabel}
						</span>
					</div>
					<span className="sc-date num">{card.dateLabel}</span>
				</div>

				<div className="sc-inst">
					{card.asset === null ? null : (
						<span className={compact ? "av av-26 av-asset" : "av av-30 av-asset"} aria-hidden="true">
								{card.asset}
							</span>
					)}
					<b>{card.instrumentLabel}</b>
				</div>
				<div className="sc-strikes">
					{card.sideLabel} · Base · Thetanuts OptionBook
				</div>

				<div className="sc-pnl">
					{/* A figure that does not exist is set at the strikes' size: a 48px
					    em dash reads as a graphic rule, not as "no number yet". */}
					<b className={`${tone} num${card.pnl.signed2 === "—" ? " none" : ""}`}>{card.pnl.signed2}</b>
					{card.pnlPctLabel === null ? null : (
						<span className="num">
							({arrow === null ? null : <em className={tone}>{arrow} </em>}
							{card.pnlPctLabel})
						</span>
					)}
				</div>
				{/* What kind of number that was. An estimate must never read as a
				    settled result (PRD 14), so this sentence is part of the card at
				    both sizes, never a tooltip. */}
				<p className="sc-basis">
					{card.pnlLabel} · {compact ? BASIS_SHORT[card.basis] : card.pnlBasisLabel}
				</p>

				<div className="tiles">
					{card.stats.map((stat) => (
						<span className="tile" key={stat.label}>
							<i>{stat.label}</i>
							<b className="num">{stat.value}</b>
						</span>
					))}
				</div>

				{card.tx ? (
					<a className="sc-tx num" href={card.tx.href} rel="noreferrer noopener" target="_blank">
						{card.tx.label}
					</a>
				) : null}
			</div>

			<div className="frame-f">
				<span className="wm">thesis.fun</span>
				{/* The mockup's footer reads "Verified onchain · Base". It says so only
				    when the receipt says so (PRD 7.3); an unconfirmed fill gets the
				    honest line instead of the badge. */}
				<span className="fine">{card.verified ? "Verified onchain · Base" : "Base · not confirmed yet"}</span>
			</div>
		</div>
	);
}
