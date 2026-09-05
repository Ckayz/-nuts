import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { FeedRail } from "@/components/shell/feed-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { Avatar, TodoOwner } from "@/components/primitives";
import { YourPositionsRail } from "@/components/market/your-positions-rail";
import { TaggedPostsTabs } from "@/components/market/tagged-posts-tabs";
import { getSession } from "@/lib/auth/session";
import { MarketRail } from "@/components/market/market-rail";
import { AgentChat } from "@/components/agent/agent-chat";
import { PriceChart } from "@/components/market/price-chart";
import { StructuresList } from "@/components/market/structures-list";
import { TakeASide } from "@/components/market/take-a-side";
import { usd2 } from "@/lib/format";
import { marketStatTiles } from "@/lib/market/stat-tiles";
import { usingDatabase } from "@/lib/data/source";
import { marketBySlug, marketSummaries, thesesByMarket } from "@/lib/view-data";
import { railTheses } from "@/lib/page-data";
import type { Market, MarketSummary, Thesis } from "@/lib/display-types";
import type { TradePanelContext } from "@/lib/trade/types";
import "@/styles/market.css";
import "@/styles/position.css";

/**
 * The market page — the mockup's `#market` view (lines 743-925).
 *
 * Owner 2026-09-05, from the fomo demo: trading lives here, not in a post. Three
 * columns: the shell's feed rail on the left, the asset header / live book /
 * posts about this market in the centre, and the ticket, "About <asset>" and
 * "Your <asset> positions" on the right.
 *
 * NO PRICE CHART (owner 2026-09-05, "remove the chart then"): Thetanuts
 * publishes a spot price and no history — `api.getMarketData()` returns
 * `{prices, metadata}` and nothing else, measured the same day — and this app
 * does not call a third-party price API, so there is no series to draw and the
 * owner will not ship an example one. The live spot stays, as a number.
 *
 * `src/styles/position.css` is imported here as well as on `/p/[id]`: the
 * post-fill dialog renders the same share card, and the card is defined once.
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
	/** C#6. Whether the structures table's "Select" navigates to a real structure. */
	selectable: boolean;
	unavailable: string | null;
}

async function load(asset: string, params: Record<string, string | undefined>): Promise<Loaded | { error: string } | null> {
	if (!usingDatabase()) {
		const market = marketBySlug(asset);
		if (!market) return null;
		return {
			market,
			summaries: marketSummaries,
			tagged: thesesByMarket(market.slug),
			trade: null,
			// The fixture page's rows name no real structure, so there is nowhere
			// for a "Select" to go. It stays an inert button, as it was.
			selectable: false,
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
	}).catch(() => ({ error: "feed_unavailable", detail: "Live OptionBook data could not be loaded." }));
	if (data === null) return null;
	if ("error" in data) {
		// The book could not be read. Say that, rather than render a page that
		// looks like Thetanuts has no liquidity for this asset.
		return { error: data.detail };
	}
	// C12-r2: `data.unavailable` is the "that structure is gone" sentence, and
	// `data.trade` is null with it, so no ticket is offered for a substitute.
	return data;
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
	if ("error" in loaded) {
		// TODO-OWNER: feed-unavailable copy; no fixture market or ticket on failure.
		return <PageFrame left={<FeedRail posts={await railTheses()} />}><section className="card pad"><h1>Market unavailable</h1><p>Live OptionBook data could not be loaded. <TodoOwner /></p></section></PageFrame>;
	}
	const { market, summaries, tagged, trade, selectable, unavailable } = loaded;
	const databaseMode = usingDatabase();
	const signedIn = databaseMode && (await getSession()) !== null;
	// Selecting another structure keeps the post and side the visitor arrived
	// with, so a link from a post does not silently drop what it was about.
	const carried: Record<string, string> = {};
	for (const key of ["thesis", "side", "budget"] as const) {
		const value = single(key);
		if (value !== undefined) carried[key] = value;
	}

	const rail = await railTheses();

	return (
		<PageFrame
			ticketFirst
			left={<FeedRail posts={rail} />}
			// TODO-OWNER: a bottom-sheet ticket remains a later option.
			right={
				<>
				{unavailable !== null ? (
					// C12-r2: the instrument that was asked for is gone. No ticket at
					// all — a ticket for the page's default structure would be the
					// silent substitution PRD 8.4 forbids.
					<section className="card pad mkt-panel">
						<h3 style={{ fontSize: "15px" }}>Not tradeable</h3>
						<p className="fine">
							{unavailable} <TodoOwner />
						</p>
					</section>
				) : trade === null ? (
					<>
						<TakeASide
							ticket={market.ticket}
							structureLabel={market.selectedLabel}
							expiryLabel={market.selectedExpiryLabel}
						/>
						<section className="card pad mkt-panel">
							<h3 style={{ fontSize: "15px" }}>Post about {market.asset}</h3>
							<p className="fine">
								{/* TODO-OWNER: standalone trades cannot confer a verified post badge. */}
								Write your read on this market. You can tag the market or link a trade. Linking a standalone trade does not add a verified badge. <TodoOwner />
							</p>
							<Link className="btn sec block" style={{ marginTop: "14px" }} href="/new">
								Write a post
							</Link>
						</section>
					</>
				) : (
					<MarketRail
						trade={trade}
						structureLabel={market.selectedLabel}
						expiryLabel={market.selectedExpiryLabel}
					/>
				)}

				{/* Directly under the ticket, not at the bottom of the rail: the right
				    column is ONE `position:sticky` stack, so a tall panel added below
				    the other cards pushes them past the bottom of the viewport where
				    sticky cannot reach them. The panel caps its own height too. */}
				<section className="card pad mkt-panel agent-inline">
					<h3 style={{ fontSize: "15px" }}>
						Ask about {market.asset}
						<TodoOwner />
					</h3>
					<AgentChat asset={market.asset} variant="panel" />
				</section>

				<section className="card">
					<div className="card-h">
						<h3>About {market.asset}</h3>
					</div>
					<div className="card-b" style={{ padding: "0 20px 16px" }}>
						<dl className="kv">
							<div>
								<dt className="k">Venue</dt>
								<dd className="v">Thetanuts OptionBook</dd>
							</div>
							<div>
								<dt className="k">Network</dt>
								<dd className="v">Base · 8453</dd>
							</div>
							<div>
								<dt className="k">Expiries</dt>
								<dd className="v num">{market.expiryCount}</dd>
							</div>
							<div>
								<dt className="k">Structures</dt>
								<dd className="v num">{market.structureCount}</dd>
							</div>
							<div>
								<dt className="k">Settlement</dt>
								<dd className="v">Thetanuts TWAP</dd>
							</div>
						</dl>
					</div>
				</section>

				<YourPositionsRail asset={market.asset} />



				{summaries.length > 0 ? (
					<section className="card">
						<div className="card-h">
							<h3>Markets</h3>
							<span className="x num">{summaries.length} live</span>
						</div>
						<div className="card-b">
							{summaries.map((m) => (
								<Link className="row" href={`/m/${m.slug}`} key={m.slug}>
									<Avatar asset={m.asset} initials={m.asset} tone="asset" size={30} />
									<span className="t">
										<b>{m.name}</b>
										<i>
											{m.asset} · Base
										</i>
									</span>
									<span className="v">
										<b className="num">{usd2(m.spotUsd)}</b>
										{m.changeLabel ? <i className={`${m.changeClass} num`}>{m.changeLabel}</i> : null}
									</span>
								</Link>
							))}
						</div>
						<div className="card-f">
							Assets, strikes and expiries come from live OptionBook orders. Nothing here is a
							hardcoded list.
						</div>
					</section>
				) : null}
				</>
			}
		>
				<section className="card pad">
					<div className="mkt-head">
						<Avatar asset={market.asset} initials={market.asset} tone="asset" size={44} />
						<div>
							<h1>{market.name}</h1>
							<span className="sub">
								{market.asset} · {market.venueLabel}
							</span>
						</div>
						<span className="px">
							<b className="num">{usd2(market.spotUsd)}</b>
						</span>
					</div>
					{/* fomo's stat-tile row under the instrument name
					    (docs/design/FOMO-DIGEST.md). Which tiles exist, and which are
					    deliberately absent because nothing honest can fill them, is
					    `lib/market/stat-tiles.ts`. */}
					<div className="stats">
						{marketStatTiles(market, tagged.length).map((tile) => (
							<span className="tile" key={tile.label}>
								<i>{tile.label}</i>
								<b className="num">{tile.value}</b>
							</span>
						))}
					</div>
				</section>

				{/* The chart sits ABOVE the structures list and below the header: the
				    strikes it draws are the rows underneath it, so the level and the
				    row that names it are read together. Its strikes come from the
				    SELECTED structure, so choosing a different row moves the lines. */}
				<PriceChart
					asset={market.asset}
					strikesUsd={market.structures.find((row) => row.selected)?.strikesUsd ?? []}
					strikesLabel={market.structures.find((row) => row.selected)?.strikesLabel ?? null}
				/>

				{unavailable !== null ? <span className="mkt-warn">{unavailable}</span> : null}

				{/* C#6: whether the LIST can navigate is a different question from
				    whether the REQUESTED instrument can be ticketed. Passing
				    `trade !== null` made every "Select" inert on the one page whose
				    own copy says "pick another one from the list below". */}
				<StructuresList
					rows={market.structures}
					slug={market.slug}
					query={carried}
					live={selectable}
				/>

				<TaggedPostsTabs
					posts={tagged}
					asset={market.asset}
					signedIn={signedIn}
					databaseMode={databaseMode}
				/>
		</PageFrame>
	);
}
