"use client";
import { useRef, useState } from "react";
import { TodoOwner } from "@/components/primitives";
import { signedUsd, usd, usd2 } from "@/lib/format";
import type { Side, Ticket } from "@/lib/display-types";
/**
 * The Bull/Bear ticket. Owner 2026-09-05: trading lives on the market page, so
 * this panel is rendered there and never inside a post.
 */
export function TakeASide({ ticket, structureLabel, expiryLabel }: {
    ticket: Ticket;
    /** The structure being quoted, e.g. "BTC put spread 78,000 / 74,000 P". */
    structureLabel: string;
    expiryLabel: string;
}) {
    const bullRef = useRef<HTMLButtonElement>(null);
    const bearRef = useRef<HTMLButtonElement>(null);
    const [side, setSide] = useState<Side>("bull");
    return (<div className="panel">
			<h3>Take a side</h3>
			<span className="note">
				{structureLabel} · expires <b className="mono">{expiryLabel}</b>
			</span>
			<div className="seg" role="radiogroup" aria-label="Take a side" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
                return;
            event.preventDefault();
            const next = event.key === "Home" ? "bull" : event.key === "End" ? "bear" : side === "bull" ? "bear" : "bull";
            setSide(next);
            (next === "bull" ? bullRef : bearRef).current?.focus();
        }}>
				<button type="button" className="bull" role="radio" aria-checked={side === "bull"} ref={bullRef} tabIndex={side === "bull" ? 0 : -1} onClick={() => setSide("bull")}>
					Bull · buy it
				</button>
				<button type="button" className="bear" role="radio" aria-checked={side === "bear"} ref={bearRef} tabIndex={side === "bear" ? 0 : -1} onClick={() => setSide("bear")}>
					Bear · sell it
				</button>
			</div>
			<span className="note">{ticket.sideNote}</span>
			<div className="field">
				<span className="lbl">Your max loss</span>
				<div className="inp">
					<span>$</span>
					<span>{ticket.maxLossUsd.raw}</span>
					<span className="u">{ticket.collateralSymbol}</span>
				</div>
				<div className="presets">
					{ticket.presetsUsd.map((v) => (<button type="button" key={v.raw}>
							{usd(v)}
						</button>))}
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
			</dl>
			<button type="button" className="btn primary block">
				Sign with wallet
			</button>
			<span className="note">
				Approve USDC once, then one fill on Base. Your fill is public the moment
				it confirms.
			</span>
		</div>);
}
