import { CheckIcon } from "@/components/icons";
import { SplitBar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { Backing, Structure } from "@/lib/display-types";

/**
 * The creator's own fill, nested inside a backed post. Only a backed post has
 * one, which is why the verified badge lives here: it marks the onchain fill,
 * not the author.
 */
export function PositionCard({
	asset,
	structure,
	backing,
}: {
	asset: string | null;
	structure: Structure | null;
	backing: Backing;
}) {
	return (
		<div className="poscard">
			<div className="nm">
				<span className="a">
					{[asset, structure?.productType].filter(Boolean).join(" ")}
					<span className="verified">
						<CheckIcon />
						verified
					</span>
				</span>
				<span className="d">
					{backing.detailParts.join(" · ")}
					{backing.detailTx ? (
						<>
							{" · tx "}
							<a className="tx" href={backing.detailTx.href}>
								{backing.detailTx.label}
							</a>
						</>
					) : null}
				</span>
			</div>
			<div className="kv2">
				<span className="l">Risked</span>
				<span className="v">{usd(backing.creatorRiskedUsd)}</span>
			</div>
			<div className="kv2">
				<span className="l">{backing.creatorPnlLabel}</span>
				<span className={`v ${pnlClass(backing.creatorLivePnlUsd)}`}>
					{signedUsd(backing.creatorLivePnlUsd)}
				</span>
			</div>
			<SplitBar
				bullLabel={`${backing.bull.pct}% Bull · ${backing.bull.count} · ${backing.bull.amountLabel}`}
				bearLabel={`${backing.bear.pct}% Bear · ${backing.bear.count} · ${backing.bear.amountLabel}`}
				bullPct={backing.bull.pct}
				bearMuted={backing.settled}
			/>
		</div>
	);
}
