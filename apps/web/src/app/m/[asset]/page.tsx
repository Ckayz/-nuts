import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { YourPositionsRail } from "@/components/market/your-positions-rail";
import { TaggedPostsTabs } from "@/components/market/tagged-posts-tabs";
import { getSession } from "@/lib/auth/session";
import { MarketRail } from "@/components/market/market-rail";
import { StructuresList } from "@/components/market/structures-list";
import { TakeASide } from "@/components/market/take-a-side";
import { TodoOwner } from "@/components/primitives";
import { usingDatabase } from "@/lib/data/source";
import { usd, usd2 } from "@/lib/format";
import { markets, marketBySlug, marketSummaries, thesesByMarket } from "@/lib/view-data";
import type { Market, MarketSummary, Thesis } from "@/lib/display-types";
import type { TradePanelContext } from "@/lib/trade/types";

/**
 * The market page. Owner 2026-09-05, from the fomo demo: trading lives here,
 * not in a post — the live book in the centre, the ticket on the right, and the
 * posts tagged to this market below.
 *
 * NO PRICE CHART (owner 2026-09-05, "remove the chart then"): Thetanuts
 * publishes a spot price and no history — `api.getMarketData()` returns
 * `{prices, metadata}` and nothing else, measured the same day — and this app
 * does not call a third-party price API, so there is no series to draw and the
 * owner will not ship an example one. The live spot stays, as a number.
 */

/**
 * Dynamic in both modes, for the same reason `/t/[slug]` is (see the note at the
 * end of `src/lib/page-data.ts`): the book changes between renders, and while
 * `generateStaticParams` was exported Next still listed the route as SSG even
 * with `force-dynamic` set. Enumerating assets at build time would also mean
 * calling the OptionBook feed from the build.
 */
export const dynamic = "force-dynamic";

interface Loaded {
	market: Market;
	summaries: MarketSummary[];
	tagged: Thesis[];
	trade: TradePanelContext | null;
	unavailable: string | null;
}

async function load(asset: string, params: Record<string, string | undefined>): Promise<Loaded | null> {
	if (!usingDatabase()) {
		const market = marketBySlug(asset);
		if (!market) return null;
		return {
			market,
			summaries: marketSummaries,
			tagged: thesesByMarket(market.slug),
			trade: null,
			unavailable: null,
		};
	}
	await connection();
	const { marketPageData } = await import("@/lib/market/page");
	const data = await marketPageData(asset, {
		thesisId: params.thesis ?? null,
		side: params.side ?? null,
		structureId: params.structure ?? null,
		budgetInput: params.budget ?? null,
	});
	if (data === null) return null;
	if ("error" in data) {
		// The book could not be read. Say that, rather than render a page that
		// looks like Thetanuts has no liquidity for this asset.
		const fallback = marketBySlug(asset);
		if (!fallback) return null;
		return { market: fallback, summaries: [], tagged: [], trade: null, unavailable: data.detail };
	}
	return { ...data, unavailable: null };
}

export default async function MarketPage({
	params,
	searchParams,
}: {
	params: Promise<{ asset: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { asset } = await params;
	const query = await searchParams;
	const single = (key: string): string | undefined => {
		const value = query[key];
		return Array.isArray(value) ? value[0] : value;
	};
	const loaded = await load(asset, {
		thesis: single("thesis"),
		side: single("side"),
		structure: single("structure"),
		budget: single("budget"),
	});
	if (loaded === null) notFound();
	const { market, summaries, tagged, trade, unavailable } = loaded;
	const databaseMode = usingDatabase();
	const signedIn = databaseMode && (await getSession()) !== null;
	// Selecting another structure keeps the post and side the visitor arrived
	// with, so a link from a post does not silently drop what it was about.
	const carried: Record<string, string> = {};
	for (const key of ["thesis", "side", "budget"] as const) {
		const value = single(key);
		if (value !== undefined) carried[key] = value;
	}

	return (
		<div className="work">
			<aside className="col l">
				<div className="sec">
					<div className="sec-h">
						<h2 className="h2">Markets</h2>
						<span className="mono dim" style={{ fontSize: "11px" }}>
							{summaries.length} live
						</span>
					</div>
					<div className="tl">
						{summaries.map((m) => (
							<Link className="it" href={`/m/${m.slug}`} key={m.slug}>
								<span className={`thumb ${m.slug}`}>{m.asset}</span>
								<div className="b">
									<span className="n">{m.name}</span>
									<span className="d">
										<span>{m.spotUsd.usd2.replace("$", "")}</span>
										<span className={m.changeClass || undefined}>{m.changeLabel}</span>
									</span>
								</div>
							</Link>
						))}
					</div>
					<span className="note">
						Assets, strikes and expiries come from live OptionBook orders. Nothing here is a hardcoded list.
					</span>
				</div>
				<YourPositionsRail asset={market.asset} />
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
						<span className={`ch ${market.changeClass}`}>{market.changeLabel} · 24h</span>
					</span>
				</header>

				{unavailable !== null ? <span className="note">{unavailable}</span> : null}

				<div className="board">
					<div>
						<span className="lbl">Spot</span>
						<span className="v">{usd(market.spotUsd)}</span>
					</div>
					<div>
						<span className="lbl">24h</span>
						<span className={`v ${market.changeClass}`}>{market.changeLabel}</span>
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

				<StructuresList
					rows={market.structures}
					slug={market.slug}
					query={carried}
					live={trade !== null}
				/>

				<TaggedPostsTabs posts={tagged} signedIn={signedIn} databaseMode={databaseMode} />
			</main>

			<aside className="col r">
				{trade === null ? (
					<>
						<TakeASide
							ticket={market.ticket}
							structureLabel={market.selectedLabel}
							expiryLabel={market.selectedExpiryLabel}
						/>
						<div className="panel">
							<h3>Post about {market.asset}</h3>
							<span className="note">
								Write your read on this market. A post is text first — tag this structure if you want,
								and it shows the verified badge only once your own fill confirms.
							</span>
							<Link className="btn block" href="/new">
								Write a post
							</Link>
						</div>
					</>
				) : (
					<MarketRail
						trade={trade}
						structureLabel={market.selectedLabel}
						expiryLabel={market.selectedExpiryLabel}
					/>
				)}
			</aside>
		</div>
	);
}
