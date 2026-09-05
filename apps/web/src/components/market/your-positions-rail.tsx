import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { usingDatabase } from "@/lib/data/source";
import { position } from "@/lib/display";

/**
 * "Your <asset> positions" — the mockup's last card in the market page's right
 * column (lines 914-921): an asset monogram, the strikes, one line of side ·
 * risked · expiry, and the live figure on the right. It renders only for a
 * signed-in visitor with open positions in this asset, exactly as before.
 */
export async function YourPositionsRail({ asset }: { asset: string }) {
	if (!usingDatabase()) return null;
	const session = await getSession();
	if (!session) return null;
	const { getPortfolio } = await import("@/lib/data/reads");
	const positions = (await getPortfolio(session.walletAddress)).filter(
		(row) => row.underlyingAsset.toLowerCase() === asset.toLowerCase() && row.status !== "settled",
	);
	if (positions.length === 0) return null;
	return (
		<section className="card">
			<div className="card-h">
				<h3>Your {asset} positions</h3>
				<span className="x num">{positions.length} open</span>
			</div>
			<div className="card-b">
				{positions.map((row) => {
					const view = position(row);
					return (
						<Link className="row" key={row.id} href={{ pathname: `/p/${row.id}` }}>
							<span className="av av-30 av-asset" aria-hidden="true">
									{row.underlyingAsset}
								</span>
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
