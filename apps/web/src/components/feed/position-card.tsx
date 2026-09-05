import { CheckIcon } from "@/components/icons";
import { Avatar, Chip } from "@/components/primitives";
import type { Backing, Structure } from "@/lib/display-types";

/**
 * The creator's own fill, nested inside a backed post. Only a backed post has
 * one, which is why the verified badge lives here: it marks the onchain fill,
 * not the author.
 *
 * Same `.tcard` shape as the unfurled trade card next to it
 * (docs/mockups/thesis-fun-mockup.html) — one look for one object. It is a
 * `<div>`, not the mockup's `<a>`: `View.Backing` carries no position id, so
 * there is no `/p/<id>` to link to. GAP for the orchestrator: three view models
 * (`Backing`, `TradeCard`, `PnlCard`) describe this one card, and unifying them
 * is a `lib/display.ts` change outside this round's fence.
 *
 * DIVERGENCE, reported: the mockup's third and second tiles are spot prices,
 * which `Backing` does not carry. The Bull / Bear tiles keep the participation
 * split the previous card showed as a bar — the round-1 design draws no bars.
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
	const instrument = [asset, structure?.productType].filter(Boolean).join(" ");
	return (
		<div className="tcard">
			<div className="tc-top">
				{asset === null ? null : <Avatar initials={asset} tone="asset" size={26} />}
				<span className="tc-inst">{instrument === "" ? "Position" : instrument}</span>
				<Chip flat={backing.settled}>{backing.settled ? "Settled" : "Open"}</Chip>
				<span className="verified">
					<CheckIcon />
					verified
				</span>
				{structure ? <span className="tc-date num">{structure.expiryLabel}</span> : null}
			</div>
			<div className="tc-sub num">
				{[structure?.strikesLabel, ...backing.detailParts].filter(Boolean).join(" · ")}
				{backing.detailTx ? (
					<>
						{" · "}
						<a className="tx" href={backing.detailTx.href}>
							tx {backing.detailTx.label}
						</a>
					</>
				) : null}
			</div>
			<div className="tc-pnl">
				<b className={`num ${backing.creatorLivePnlUsd.pnlClass}`}>
					{backing.creatorLivePnlUsd.signed}
				</b>
				<span className="mut" style={{ fontWeight: 500 }}>
					{backing.creatorPnlLabel}
				</span>
			</div>
			<div className="tiles">
				<span className="tile">
					<i>Risked</i>
					<b className="num">{backing.creatorRiskedUsd.usd}</b>
				</span>
				<span className="tile">
					<i>Bull</i>
					<b className="num">
						{backing.bull.pct}% · {backing.bull.amountLabel}
					</b>
				</span>
				<span className="tile">
					<i>Bear</i>
					<b className="num">
						{backing.bear.pct}% · {backing.bear.amountLabel}
					</b>
				</span>
			</div>
		</div>
	);
}
