import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { usingDatabase } from "@/lib/data/source";
import { position } from "@/lib/display";

export async function YourPositionsRail({ asset }: { asset: string }) {
	if (!usingDatabase()) return null;
	const session = await getSession();
	if (!session) return null;
	const { getPortfolio } = await import("@/lib/data/reads");
	const positions = (await getPortfolio(session.walletAddress)).filter(row => row.underlyingAsset.toLowerCase() === asset.toLowerCase() && row.status !== "settled");
	return <section className="sec">
		<div className="sec-h"><span className="lbl">Your {asset} positions</span><span className="mono dim">{positions.length} open</span></div>
		<div className="tl">{positions.map(row => {
			const view = position(row);
			return <Link className="it" key={row.id} href={{ pathname: `/p/${row.id}` }}><span className="thumb">{row.underlyingAsset}</span><div className="b"><span className="n">{row.thesisHeadline || row.underlyingAsset}</span><span className="d"><span>{view.side === "bull" ? "Bull" : "Bear"}</span><span>{view.riskedUsd.usd}</span><span className={view.livePnlUsd.pnlClass}>{view.livePnlUsd.signed}</span></span></div></Link>;
		})}</div>
	</section>;
}
