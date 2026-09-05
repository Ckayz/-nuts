import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { MarketSummary, Position, TrendingItem } from "@/lib/display-types";

/**
 * The mockup's `.row`: asset avatar, two lines of neutral text, one figure on
 * the right in money colour (docs/mockups/thesis-fun-mockup.html). Nothing here
 * draws a bar — the round-1 design puts colour on numbers only.
 */
export function TrendingList({ items, note }: { items: TrendingItem[]; note?: ReactNode }) {
	return (
		<div className="card">
			<div className="card-b">
				{items.map((it) => (
					<Link className="row" href={`/t/${it.slug}`} key={it.slug}>
						<Avatar initials={it.asset === "" ? "—" : it.asset} tone="asset" size={30} />
						<span className="t">
							<b>{it.headline}</b>
							<i>
								{[it.creatorHandle, it.timeLabel, `${it.bullPct}% bull`]
									.filter(Boolean)
									.join(" · ")}
							</i>
						</span>
						<span className="v">
							<b className={`num ${pnlClass(it.pnlUsd)}`}>{signedUsd(it.pnlUsd)}</b>
						</span>
					</Link>
				))}
			</div>
			{note === undefined ? null : <div className="card-f">{note}</div>}
		</div>
	);
}

/**
 * A row in a positions list. It links to the POSITION, not to a post: a position
 * is its own thing (owner 2026-09-05, "trade is just trade") and since migration
 * 0007 it may belong to no post at all, in which case there is no headline to
 * show and no `/t/<slug>` to link to.
 */
export function PositionRow({ position }: { position: Position }) {
	return (
		<Link className="row" href={`/p/${position.id}`}>
			<Avatar initials={position.asset === "" ? "—" : position.asset} tone="asset" size={30} />
			<span className="t">
				<b>{position.thesisHeadline ?? `${position.asset} position`}</b>
				<i>
					{position.side === "bull" ? "Bull" : "Bear"} · {usd(position.riskedUsd)} risked
					{position.settled ? " · settled" : ""}
				</i>
			</span>
			<span className="v">
				<b className={`num ${pnlClass(position.livePnlUsd)}`}>{signedUsd(position.livePnlUsd)}</b>
			</span>
		</Link>
	);
}

export function PositionList({ positions }: { positions: Position[] }) {
	return (
		<div className="card-b">
			{positions.map((p) => (
				// Keyed by the position's own id: two fills on one post, or two
				// standalone fills, are different rows and must not collide.
				<PositionRow key={p.id} position={p} />
			))}
		</div>
	);
}

/** The feed's right-hand Markets panel rows. */
export function MarketList({ markets }: { markets: MarketSummary[] }) {
	return (
		<div className="card-b">
			{markets.map((market) => (
				<Link className="row" href={`/m/${market.slug}`} key={market.slug}>
					<Avatar initials={market.asset} tone="asset" size={30} />
					<span className="t">
						<b>{market.name}</b>
						<i>{market.asset} · Base</i>
					</span>
					<span className="v">
						<b className="num">{market.spotUsd.usd2}</b>
						<i className={`num ${market.changeClass}`}>{market.changeLabel}</i>
					</span>
				</Link>
			))}
		</div>
	);
}
