import Link from "next/link";
import { Avatar, StatusChip } from "@/components/primitives";
import { getSession } from "@/lib/auth/session";
import { usingDatabase } from "@/lib/data/source";
import { PNL_BASIS_SHORT, position } from "@/lib/display";
import type * as Domain from "@/types";

/**
 * D-R2-2 (lane D pass 2). The rail called `position(row)` with no live price
 * book, so the SAME confirmed fill printed a derived P&L on `/p/<id>` and
 * "syncing - not available yet" beside the market ticket (the reviewer measured
 * `page -$1.00` against `rail ... not available yet` on the decoded-fill
 * fixture).
 *
 * This is the same three-step path `lib/page-data.ts` `rowPnl` builds for the
 * portfolio and the profile - `rowPriceKeys` -> `livePriceBook` -> `listRowPnl`
 * - and it is repeated here rather than shared because that helper is private to
 * the page-read boundary and this card does its own read. It costs no extra
 * fetch: `livePriceBook` reads the cached OptionBook snapshot
 * (`lib/thetanuts/orders.ts` `getOrderSnapshot`, cached with an expiry), which
 * is the same snapshot the market page around it already read.
 *
 * `lib/position/view.ts` reaches `@nuts/thetanuts` for the risk model, so it is
 * imported dynamically, exactly as `page-data.ts` imports it.
 */
async function railRowPnl(rows: readonly Domain.Position[]) {
	const { NO_LIVE_PRICES, listRowPnl, rowPriceKeys } = await import("@/lib/position/view");
	let prices = NO_LIVE_PRICES;
	if (rows.length > 0) {
		const keys = rowPriceKeys(rows);
		if (keys.assets.length > 0 || keys.collateralSymbols.length > 0) {
			const { livePriceBook } = await import("@/lib/position/spot");
			prices = await livePriceBook(keys.assets, keys.collateralSymbols);
		}
	}
	return (row: Domain.Position) => listRowPnl(row, prices);
}

/**
 * "Your <asset> positions" — the mockup's last card in the market page's right
 * column (lines 914-921): an asset monogram, the strikes, one line of side ·
 * risked · expiry, and the live figure on the right.
 *
 * Round-1 fold item 19: with no positions it renders the mockup's empty card
 * ("0 open") rather than nothing at all — the mockup keeps the card on the page
 * so a visitor can see that the slot exists and is empty. It is still hidden
 * entirely for a visitor who is not signed in, because "0 open" would then be a
 * statement about a wallet nobody has connected.
 */
export async function YourPositionsRail({ asset }: { asset: string }) {
	if (!usingDatabase()) return null;
	const session = await getSession();
	if (!session) return null;
	const { getPortfolio } = await import("@/lib/data/reads");
	const positions = (await getPortfolio(session.walletAddress)).filter(
		(row) => row.underlyingAsset.toLowerCase() === asset.toLowerCase() && row.status !== "settled",
	);
	const live = await railRowPnl(positions);
	// ONE instant for every row on this card, so two rows cannot cross an expiry
	// boundary between their own `new Date()` calls.
	const asOf = new Date();
	return (
		<section className="card">
			<div className="card-h">
				<h3>Your {asset} positions</h3>
				<span className="x num">{positions.length} open</span>
			</div>
			<div className="card-b">
				{positions.length === 0 ? (
					<span className="empty">No open {asset} position yet.</span>
				) : null}
				{positions.map((row) => {
					const view = position(row, asOf, live(row));
					return (
						<Link className="row" key={row.id} href={{ pathname: `/p/${row.id}` }}>
							<Avatar asset={row.underlyingAsset} initials={row.underlyingAsset} tone="asset" size={30} />
							{/* D5: the lifecycle chip and the P&L basis, both visible. The
							    rail filtered on the PERSISTED status alone, so an option
							    that had already expired sat here under "N open" with a live
							    estimate beside it. */}
							<span className="t">
								<b>{row.thesisHeadline || row.underlyingAsset}</b>
								<i>
									{view.side === "bull" ? "Bull" : "Bear"} · {view.riskedUsd.usd} risked ·{" "}
									<StatusChip status={view.statusTone} label={view.statusLabel} />
								</i>
							</span>
							<span className="v">
								<b className={`${view.livePnlUsd.pnlClass} num`}>
									{view.livePnlUsd.signed}
								</b>
								<i>{PNL_BASIS_SHORT[view.basis]}</i>
							</span>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
