import Link from "next/link";
import { notFound } from "next/navigation";
import { CalloutPost } from "@/components/feed/callout-post";
import { PriceChart } from "@/components/market/price-chart";
import { StructuresList } from "@/components/market/structures-list";
import { TakeASide } from "@/components/market/take-a-side";
import { TodoOwner } from "@/components/primitives";
import { usd, usd2 } from "@/lib/format";
import { markets, marketBySlug, marketSummaries, thesesByMarket } from "@/lib/view-data";

/**
 * The market page. Owner 2026-09-05, from the fomo demo: trading lives here,
 * not in a post — price chart in the centre, the live book under it, the ticket
 * on the right, and the posts tagged to this market below.
 *
 * TODO-OWNER: which chart windows ship. The row below is the mockup's, and the
 * buttons do not switch anything yet.
 */
const CHART_WINDOWS = ["1H", "4H", "1D", "7D", "1M", "ALL"] as const;
const SELECTED_WINDOW = "7D";

export function generateStaticParams() {
	return markets.map((m) => ({ asset: m.slug }));
}

export default async function MarketPage({
	params,
}: {
	params: Promise<{ asset: string }>;
}) {
	const { asset } = await params;
	const market = marketBySlug(asset);
	if (!market) notFound();
	const tagged = thesesByMarket(market.slug);

	return (
		<div className="work">
			<aside className="col l">
				<div className="sec">
					<div className="sec-h">
						<h2 className="h2">Markets</h2>
						<span className="mono dim" style={{ fontSize: "11px" }}>
							{marketSummaries.length} live
						</span>
					</div>
					<div className="tl">
						{marketSummaries.map((m) => (
							<Link className="it" href={`/m/${m.slug}`} key={m.slug}>
								<span className={`thumb ${m.slug}`}>{m.asset}</span>
								<div className="b">
									<span className="n">{m.name}</span>
									<span className="d">
										<span>{m.spotUsd.usd2.replace("$", "")}</span>
										<span className={m.changeClass || undefined}>
											{m.changeLabel}
										</span>
									</span>
								</div>
							</Link>
						))}
					</div>
					<span className="note">
						Assets, strikes and expiries come from live OptionBook orders.
						Nothing here is a hardcoded list.
					</span>
				</div>
			</aside>

			<main className="col">
				<header className="mkthead">
					<span className={`thumb ${market.slug}`}>{market.asset}</span>
					<div>
						<h1>{market.name}</h1>
						<span className="sub">
							<span>{market.asset}</span>
							<span>{market.venueLabel}</span>
							<span>{market.bookLabel}</span>
						</span>
					</div>
					<span className="px">
						{usd2(market.spotUsd)}
						<span className={`ch ${market.changeClass}`}>
							{market.changeLabel} · 24h
						</span>
					</span>
				</header>

				<div className="board">
					<div>
						<span className="lbl">Spot</span>
						<span className="v">{usd(market.spotUsd)}</span>
					</div>
					<div>
						<span className="lbl">24h</span>
						<span className={`v ${market.changeClass}`}>
							{market.changeLabel}
						</span>
					</div>
					<div>
						<span className="lbl">Structures</span>
						<span className="v">{market.structureCount}</span>
					</div>
					<div>
						<span className="lbl">Tagged posts</span>
						<span className="v">{tagged.length}</span>
					</div>
				</div>

				<div className="chartbox">
					<div className="hh">
						<span className="lbl">{market.asset} spot</span>
						<span className="tfs" role="group" aria-label="Chart window">
							{CHART_WINDOWS.map((w) => (
								<button
									type="button"
									key={w}
									aria-pressed={w === SELECTED_WINDOW}
								>
									{w}
								</button>
							))}
						</span>
					</div>
					<PriceChart
						series={market.series}
						label={`${market.asset} spot price history`}
						priceLineValue={Number(market.spotUsd.raw)}
						priceDecimals={Number(market.spotUsd.raw) >= 1000 ? 0 : 2}
					/>
					<span className="note">
						Chart windows on offer <TodoOwner />
					</span>
				</div>

				<StructuresList rows={market.structures} />

				<div className="sec">
					<div className="sec-h">
						<h2 className="h2">Tagged posts</h2>
						<span className="mono dim" style={{ fontSize: "11px" }}>
							{tagged.length}
						</span>
					</div>
					<div className="feed">
						{tagged.map((t) => (
							<CalloutPost key={t.slug} thesis={t} />
						))}
					</div>
				</div>
			</main>

			<aside className="col r">
				<TakeASide
					ticket={market.ticket}
					structureLabel={market.selectedLabel}
					expiryLabel={market.selectedExpiryLabel}
				/>
				<div className="panel">
					<h3>Post about {market.asset}</h3>
					<span className="note">
						Write your read on this market. A post is text first — tag this
						structure if you want, and it shows the verified badge only once
						your own fill confirms.
					</span>
					<Link className="btn block" href="/new">
						Write a post
					</Link>
				</div>
			</aside>
		</div>
	);
}
