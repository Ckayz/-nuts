import Link from "next/link";
import { Bar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { Position, TrendingItem } from "@/lib/display-types";

function Thumb({ asset }: { asset: string }) {
	return <span className={`thumb ${asset.toLowerCase()}`}>{asset}</span>;
}

export function TrendingList({ items }: { items: TrendingItem[] }) {
	return (
		<div className="tl">
			{items.map((it) => (
				<Link className="it" href={`/t/${it.slug}`} key={it.slug}>
					<Thumb asset={it.asset} />
					<div className="b">
						<span className="n">{it.headline}</span>
						<span className="d">
							<span>{it.creatorHandle}</span>
							<span>{it.timeLabel}</span>
							<span className={pnlClass(it.pnlUsd) || undefined}>
								{signedUsd(it.pnlUsd)}
							</span>
						</span>
						<Bar pct={it.bullPct} />
					</div>
				</Link>
			))}
		</div>
	);
}

export function PositionRow({ position }: { position: Position }) {
	return (
		<Link className="it" href={`/t/${position.thesisSlug}`}>
			<Thumb asset={position.asset} />
			<div className="b">
				<span className="n">{position.thesisHeadline}</span>
				<span className="d">
					<span className={position.side}>
						{position.side === "bull" ? "Bull" : "Bear"}
					</span>
					<span>{usd(position.riskedUsd)}</span>
					<span className={pnlClass(position.livePnlUsd) || undefined}>
						{signedUsd(position.livePnlUsd)}
					</span>
				</span>
			</div>
		</Link>
	);
}

export function PositionList({ positions }: { positions: Position[] }) {
	return (
		<div className="tl">
			{positions.map((p) => (
				<PositionRow key={`${p.thesisSlug}-${p.side}`} position={p} />
			))}
		</div>
	);
}
