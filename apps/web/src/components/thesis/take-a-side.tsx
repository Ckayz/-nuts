"use client";

import { useState } from "react";
import { TodoOwner } from "@/components/primitives";
import { signedUsd, usd, usd2 } from "@/lib/format";
import type { Side, Ticket } from "@/types";

export function TakeASide({ ticket }: { ticket: Ticket }) {
	const [side, setSide] = useState<Side>("bull");
	return (
		<div className="panel">
			<h3>Take a side</h3>
			<div className="seg" role="tablist">
				<button
					type="button"
					className="bull"
					role="tab"
					aria-selected={side === "bull"}
					onClick={() => setSide("bull")}
				>
					Bull · with creator
				</button>
				<button
					type="button"
					className="bear"
					role="tab"
					aria-selected={side === "bear"}
					onClick={() => setSide("bear")}
				>
					Bear · against
				</button>
			</div>
			<span className="note">{ticket.sideNote}</span>
			<div className="field">
				<span className="lbl">Your max loss</span>
				<div className="inp">
					<span>$</span>
					<span>{ticket.maxLossUsd}</span>
					<span className="u">{ticket.collateralSymbol}</span>
				</div>
				<div className="presets">
					{ticket.presetsUsd.map((v) => (
						<button type="button" key={v}>
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
				<dd>{ticket.contracts.toFixed(4)}</dd>
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
				Approve USDC once, then one fill on Base. You appear in the participants
				list when it confirms.
			</span>
		</div>
	);
}
