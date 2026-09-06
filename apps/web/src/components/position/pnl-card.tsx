import Link from "next/link";
import { Avatar, Chip } from "@/components/primitives";
import type { PnlBasis, PnlCard as PnlCardView } from "@/lib/display-types";
import { PNL_BASIS_SHORT } from "@/lib/display";

/**
 * THE card. One view model (`View.PnlCard`), one component, two sizes — the two
 * the mockup draws (`docs/mockups/thesis-fun-mockup.html`):
 *
 *   compact (`.tcard`)  the card inside a post: a hairlined panel on the post's
 *                       own surface, asset monogram + instrument + status chip +
 *                       expiry across the top, the strikes on a sub-line, the
 *                       signed figure with its percent, three tiles. The mockup
 *                       puts NO accent frame inside a post (feed view, post 1
 *                       and post 5), so `compact` is not a shrunken share card.
 *   share (`.frame`)    the accent-framed hero of `/p/[id]` and the body of the
 *                       post-fill dialog, with the `thesis.fun` watermark.
 *
 * Round-1 fold item 9: `View.Backing`, `View.TradeCard` and `View.PnlCard` used
 * to be three view models rendered by three components that each claimed to draw
 * "the same" object. They are one now, built once in `lib/position/view.ts`, so
 * a fill cannot read three different ways on three screens.
 *
 * No price line and no chart: Thetanuts publishes a spot price and no history,
 * and the owner removed the charts rather than draw an example series.
 *
 * Colour rule, from the mockup's header: colour is on money only. The figure
 * carries the amount's own `.bull` / `.bear` class; the name, the labels, the
 * tiles and the chip stay neutral, and the frame is the one accent surface.
 */
/**
 * D5: ONE basis vocabulary, shared with the list rows (`lib/display.ts`), so a
 * position never describes the same number two different ways in two places.
 */
const BASIS_SHORT: Record<PnlBasis, string> = PNL_BASIS_SHORT;

/** The mockup's ▲ / ▼. Drawn only when the sign is known: an unavailable P&L
 *  gets no arrow rather than a flat one that reads as "no change". */
function arrowFor(tone: string): string | null {
	return tone === "bull" ? "▲" : tone === "bear" ? "▼" : null;
}

export function PnlCard({
	card,
	compact,
	/** Wrap the compact card in a link to `/p/<id>`, as the mockup's feed does. */
	href,
}: {
	card: PnlCardView;
	compact?: boolean;
	href?: boolean;
}) {
	if (compact) return <CompactCard card={card} href={href} />;
	return <ShareCard card={card} />;
}

/**
 * The in-post card (`.tcard`). Same values as the share card; the long basis
 * sentence becomes the one word that says what kind of number it is, because an
 * estimate must never read as a settled result (PRD 14) at either size.
 */
function CompactCard({ card, href }: { card: PnlCardView; href?: boolean }) {
	const tone = card.pnl.pnlClass;
	const arrow = arrowFor(tone);
	const subLine = [card.strikesLabel, "Base · Thetanuts OptionBook"].filter(Boolean).join(" · ");
	const body = (
		<>
			<div className="tc-top">
				{/* The monogram is dropped when the title IS the ticker: a record with
				    no instrument has "BTC" as its whole title, and the mockup never
				    prints the same word twice in one row. */}
				{card.asset === null || card.asset === card.instrumentLabel ? null : (
					<Avatar asset={card.asset} initials={card.asset} tone="asset" size={26} />
				)}
				<span className="tc-inst">{card.instrumentLabel}</span>
				<Chip flat={card.statusTone === "settled"}>{card.statusLabel}</Chip>
				{/* The mockup's top-right slot is the option's expiry; a record that
				    names none falls back to the date the fill was made, so the slot
				    is never empty and never invents a date. */}
				<span className="tc-date num">{card.expiryLabel ?? card.dateLabel}</span>
			</div>
			<div className="tc-sub num">{subLine}</div>
			<div className="tc-pnl">
				<b className={`${tone} num${card.pnl.signed === "—" ? " none" : ""}`}>{card.pnl.signed}</b>
				{card.pnlPctValue === null ? null : (
					<span className="num">
						{arrow === null ? null : <em className={tone}>{arrow} </em>}
						{card.pnlPctValue}
					</span>
				)}
			</div>
			{/* What kind of number that was, and what the percent is a percentage of.
			    An estimate must never read as a settled result (PRD 14), so this line
			    is part of the card at both sizes. */}
			<p className="tc-basis">
				{[card.pnlLabel, BASIS_SHORT[card.basis], card.pnlPctBasis]
					.filter((part): part is string => part !== null)
					.join(" · ")}
			</p>
			<div className="tiles">
				{card.stats.map((stat) => (
					<span className="tile" key={stat.label}>
						<i>{stat.label}</i>
						<b className="num">{stat.value}</b>
					</span>
				))}
			</div>
		</>
	);
	if (!href) return <div className="tcard">{body}</div>;
	return (
		<Link
			className="tcard"
			href={`/p/${card.id}`}
			aria-label={`Position by ${card.owner.displayName}: ${card.instrumentLabel}, ${card.pnlLabel} ${card.pnl.signed}`}
		>
			{body}
		</Link>
	);
}

/**
 * The share card — the signature object of the whole product. Shape and every
 * pixel from the mockup's `#tpl-sharecard`: an accent frame around a near-black
 * inner card, owner + status chip + date across the top, the instrument, one
 * very large signed figure with the percent beside it, three stat tiles, and the
 * `thesis.fun` watermark on the frame's own footer.
 */
function ShareCard({ card }: { card: PnlCardView }) {
	const tone = card.pnl.pnlClass;
	const arrow = arrowFor(tone);
	/**
	 * K-2 (pass-4 D4-m1). ONE composition for this line, shared with the Open
	 * Graph image the same card is rendered into
	 * (`app/p/[id]/opengraph-image.tsx`), which built it as
	 * `[strikesLabel, expiryFullLabel, sideLabel, "Base"]` while this renderer
	 * put `sideLabel` in a FALLBACK that only fired when strikes and expiry were
	 * both missing. MEASURED on one position at the pin: the page's hero read
	 * "2,340 P · expires 07 Sep 26 08:00 UTC" and its share image read
	 * "2,340 P · 07 Sep 26 08:00 UTC · Bear · Base" — the position page was the
	 * one surface whose hero never said Bull or Bear, which is exactly the drift
	 * owner default 1 ended everywhere else. Same tokens, same order, both
	 * places; no new words.
	 */
	const subLine = [card.strikesLabel, card.expiryFullLabel, card.sideLabel, "Base"]
		.filter(Boolean)
		.join(" · ");
	return (
		<div className="frame">
			<div className="sc">
				<div className="sc-top">
					<Avatar seed={card.owner.avatarSeed} initials={card.owner.initials} size={40} />
					<div style={{ minWidth: 0 }}>
						<div className="sc-name">{card.owner.displayName}</div>
						<Chip flat={card.statusTone === "settled"}>{card.statusLabel}</Chip>
					</div>
					<span className="sc-date num">{card.dateLabel}</span>
				</div>

				<div className="sc-inst">
					{card.asset === null ? null : <Avatar asset={card.asset} initials={card.asset} tone="asset" size={30} />}
					<b>{card.instrumentLabel}</b>
				</div>
				<div className="sc-strikes num">{subLine}</div>

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
				    settled result (PRD 14), so this sentence is part of the card,
				    never a tooltip. */}
				<p className="sc-basis">
					{card.pnlLabel} · {card.pnlBasisLabel}
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
