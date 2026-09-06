"use client";

/**
 * The market page's TICKET in database mode: the live ticket and the one line
 * it prints when a signed-out visitor presses Trade.
 *
 * The "Post about <asset>" panel that used to be returned beside it now lives
 * with the page's other right-hand panels (`app/m/[asset]/page.tsx`). K-2: the
 * ticket is its own frame slot, so that panel — which is not the ticket and is
 * not part of its state — belongs after the centre column when the page stacks,
 * where every other trailing panel is. Nothing about the panel's markup, copy
 * or link changed; only which file renders it.
 *
 * The sign-in line stays HERE because it is the ticket's own feedback: it is set
 * by `TakeASide`'s `onSignedIn` and reading it 7,000px below the button that
 * produced it (which is where the old stacking order put it) is not an answer.
 *
 * Trading and posting are not one journey. Owner 2026-09-05: "trade is just
 * trade. post(thesis) is it's own thing. doesn't have to be tied." A fill from
 * this ticket belongs to no post unless the visitor arrived from one.
 */
import { useCallback, useState } from "react";
import { TakeASide } from "@/components/market/take-a-side";
import type { TradePanelContext } from "@/lib/trade/types";

export function MarketRail({
	trade,
	structureLabel,
	expiryLabel,
}: {
	trade: TradePanelContext;
	structureLabel: string;
	expiryLabel: string;
}) {
	const [message, setMessage] = useState<string | null>(null);
	const signInHint = useCallback(() => {
		setMessage("Use the wallet control in the header to sign in, then try again.");
	}, []);

	return (
		<>
			<TakeASide
				ticket={trade.quote.ticket}
				structureLabel={structureLabel}
				expiryLabel={expiryLabel}
				trade={trade}
				onSignedIn={signInHint}
			/>
			{message !== null ? (
				<section className="card pad mkt-panel">
					<p className="fine first">{message}</p>
				</section>
			) : null}
		</>
	);
}
