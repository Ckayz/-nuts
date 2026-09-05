import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { MarketSummary, Position } from "@/lib/display-types";

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
						{market.changeLabel ? <i className={`num ${market.changeClass}`}>{market.changeLabel}</i> : null}
					</span>
				</Link>
			))}
		</div>
	);
}
