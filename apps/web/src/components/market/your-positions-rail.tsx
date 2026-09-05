import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { getSession } from "@/lib/auth/session";
import { usingDatabase } from "@/lib/data/source";
import { position } from "@/lib/display";

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
					const view = position(row);
					return (
						<Link className="row" key={row.id} href={{ pathname: `/p/${row.id}` }}>
							<Avatar asset={row.underlyingAsset} initials={row.underlyingAsset} tone="asset" size={30} />
							<span className="t">
								<b>{row.thesisHeadline || row.underlyingAsset}</b>
								<i>
									{view.side === "bull" ? "Bull" : "Bear"} · {view.riskedUsd.usd} risked
								</i>
							</span>
							<span className="v">
								<b className={`${view.livePnlUsd.pnlClass} num`}>
									{view.livePnlUsd.signed}
								</b>
							</span>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
