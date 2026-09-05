import { Textarea } from "@nuts/ui/components/textarea";
import { Pill, TodoOwner } from "@/components/primitives";
import { signedUsd, usd, usd2 } from "@/lib/format";
import { btcNfpDetail } from "@/lib/view-data";

/**
 * "Launch a thesis" composer.
 *
 * The mockup has no Launch panel — only the rail button whose title is
 * "Launch a thesis" (line 197). Every element and every string below is taken
 * from elements the mockup does have: the thesis hero's market pills (line 389)
 * and the "Take a side" panel's max-loss field, quote summary and sign button
 * (lines 446-452). The textarea has no label or placeholder because the mockup
 * supplies no composer copy. Reported to the owner.
 */
export default function NewThesisPage() {
	const t = btcNfpDetail.thesis;
	const ticket = btcNfpDetail.ticket;

	return (
		<div className="work single">
			<main className="col">
				<div className="panel" style={{ maxWidth: "320px" }}>
					<h3>Launch a thesis</h3>
					<Textarea
						rows={4}
						className="rounded-[9px] border-[var(--tn-l2)] bg-[var(--tn-g)] px-3 py-[9px] text-[13px] text-[var(--tn-k)]"
					/>
					<div
						style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}
					>
						<Pill on>{t.asset}</Pill>
						<Pill on>
							{t.structure.productType.charAt(0).toUpperCase()}
							{t.structure.productType.slice(1)}
						</Pill>
						<Pill>{t.structure.venueLabel}</Pill>
					</div>
					<div className="field">
						<span className="lbl">Your max loss</span>
						<div className="inp">
							<span>$</span>
							<span>{ticket.maxLossUsd.raw}</span>
							<span className="u">{ticket.collateralSymbol}</span>
						</div>
						<div className="presets">
							{ticket.presetsUsd.map((v) => (
								<button type="button" key={v.raw}>
									{usd(v)}
								</button>
							))}
						</div>
						<span className="note">
							Preset values <TodoOwner />
						</span>
					</div>
					<dl className="kv">
						<dt>Order</dt>
						<dd>{ticket.orderLabel}</dd>
						<dt>Contracts</dt>
						<dd>{ticket.contracts}</dd>
						<dt>Max loss</dt>
						<dd className="bear">{usd2(ticket.maxLossUsd)}</dd>
						<dt>Max payout</dt>
						<dd className="big bull">{signedUsd(ticket.maxPayoutUsd)}</dd>
						<dt>Break-even</dt>
						<dd>{usd(ticket.breakEvenUsd)}</dd>
						<dt>Liquidity left</dt>
						<dd>{usd(ticket.liquidityLeftUsd)}</dd>
						<dt>To creator</dt>
						<dd className="acc">
							rate <TodoOwner style={{ marginLeft: 0 }} />
						</dd>
					</dl>
					<button type="button" className="btn primary block">
						Sign with wallet
					</button>
					<span className="note">
						Approve USDC once, then one fill on Base. You appear in the
						participants list when it confirms.
					</span>
				</div>
			</main>
		</div>
	);
}
