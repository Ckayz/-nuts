import { SplitBar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { Thesis } from "@/types";

export function PositionCard({ thesis }: { thesis: Thesis }) {
	const settled = thesis.status === "settled";
	return (
		<div className="poscard">
			<div className="nm">
				<span className="a">
					{thesis.asset} {thesis.structure.productType}{" "}
					<span className="chip">{thesis.structure.strikesLabel}</span>
					<span className="chip">{thesis.structure.expiryLabel}</span>
				</span>
				<span className="d">
					{thesis.detailParts.join(" · ")}
					{thesis.detailTx ? (
						<>
							{" · tx "}
							<a className="tx" href={thesis.detailTx.href}>
								{thesis.detailTx.label}
							</a>
						</>
					) : null}
				</span>
			</div>
			<div className="kv2">
				<span className="l">Risked</span>
				<span className="v">{usd(thesis.creatorRiskedUsd)}</span>
			</div>
			<div className="kv2">
				<span className="l">{thesis.creatorPnlLabel}</span>
				<span className={`v ${pnlClass(thesis.creatorLivePnlUsd)}`}>
					{signedUsd(thesis.creatorLivePnlUsd)}
				</span>
			</div>
			<SplitBar
				bullLabel={`${thesis.bull.pct}% Bull · ${thesis.bull.count} · ${thesis.bull.amountLabel}`}
				bearLabel={`${thesis.bear.pct}% Bear · ${thesis.bear.count} · ${thesis.bear.amountLabel}`}
				bullPct={thesis.bull.pct}
				bearMuted={settled}
			/>
		</div>
	);
}
