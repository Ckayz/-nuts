"use client";

/**
 * The market page's right rail in database mode: the live ticket, and the
 * "Post about <asset>" panel beside it.
 *
 * They are no longer one journey. Owner 2026-09-05: "trade is just trade.
 * post(thesis) is it's own thing. doesn't have to be tied." A fill from this
 * ticket belongs to no post unless the visitor arrived from one, and the panel
 * is a plain link to the composer with this market preselected.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
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
			<section className="card pad mkt-panel">
				<h3 style={{ fontSize: "15px" }}>Post about {trade.asset}</h3>
				<p className="fine">
					Write your read on this market. A post is text first — tag this structure if you want, and it shows
					the verified badge only once your own fill confirms.
				</p>
				<Link
					className="btn sec block"
					style={{ marginTop: "14px" }}
					href={{ pathname: "/new", query: { asset: trade.asset } }}
				>
					Write a post
				</Link>
			</section>
		</>
	);
}
