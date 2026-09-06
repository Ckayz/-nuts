import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { FeedRail } from "@/components/shell/feed-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { Avatar, TodoOwner } from "@/components/primitives";
import { YourPositionsRail } from "@/components/market/your-positions-rail";
import { AboutPanel } from "@/components/market/about-panel";
import { getSession } from "@/lib/auth/session";
import { MarketRail } from "@/components/market/market-rail";
import { AgentChat } from "@/components/agent/agent-chat";
import { PriceChart } from "@/components/market/price-chart";
import { MarketTabs } from "@/components/market/market-tabs";
import { RightTabs } from "@/components/market/right-tabs";
import { TakeASide } from "@/components/market/take-a-side";
import { usd2 } from "@/lib/format";
import { marketStatTiles } from "@/lib/market/stat-tiles";
import { marketBookStats, marketSummariesData } from "@/lib/market/summaries";
import { usingDatabase } from "@/lib/data/source";
import { marketBySlug, marketSummaries, thesesByMarket } from "@/lib/view-data";
import { railTheses } from "@/lib/page-data";
import type { Metadata } from "next";
import type { Market, MarketSummary, Thesis } from "@/lib/display-types";
import type { TradePanelContext } from "@/lib/trade/types";
import "@/styles/market.css";
import "@/styles/position.css";

/**
 * The market page — fomo's token page shape, over the mockup's `#market` view.
 *
 * Owner 2026-09-05, from the fomo demo: trading lives here, not in a post.
 * Three columns (docs/design/FOMO-DIGEST.md, "Token page layout"):
 *
 *   LEFT    a TABBED rail — `Markets` (the live asset list) over `Feed` (the
 *           latest theses). fomo's own left column is `Tokens · Feed · …`.
 *   CENTRE  the instrument header and its stat tiles, the chart, then a TABBED
 *           table — `Structures | Theses`, fomo's `Trades | Thesis`.
 *   RIGHT   the ticket, ALWAYS VISIBLE and never behind a tab because it is the
 *           money path, then a tabbed panel: `About | Agent | Positions`.
 *
 * THE PRICE CHART, and why it is here after being removed three times. The
 * owner's 2026-09-05 ruling ("remove the chart then if this the case … think
 * for the users man") was aimed at a chart with no honest series behind it:
 * Thetanuts publishes a spot price and no history — `api.getMarketData()`
 * returns `{prices, metadata}` and nothing else, measured that day — so the
 * only chart available then would have been an invented one. The owner's
 * 2026-09-06 decision kept a chart on one condition, that its prices are real
 * and the source is named on the page. They are: the series is Binance spot
 * klines, read through `/api/klines/[asset]`, and the chart carries
 * `CHART_SOURCE_NOTE` under it saying so and saying that Thetanuts settles on a
 * Chainlink TWAP, which can differ. `lib/chart/klines.ts` holds the
 * measurement. The live spot still stays, as a number, in the header tiles.
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

/**
 * K-2 (pass-4 D4-m5). This route printed the layout's generic "Thesis.fun" in
 * the tab and in every shared link, and it is the trading surface — the tab most
 * likely to be kept open or sent to somebody. The title is the page's OWN h1
 * text (`<h1>{market.name}</h1>` below), joined to the site name with the
 * separator the one other route that names it uses (`app/agent/page.tsx:5`,
 * "Agent · Thesis.fun"). No new words.
 *
 * It reads the SAME market summaries the layout's nav already reads, which read
 * the cached order snapshot, so this costs no extra network call and no second
 * page render. A slug with no summary — mock fixtures, an unreadable book, an
 * unknown asset — returns no override at all and the layout's title stands,
 * rather than inventing a name for a market that may not exist.
 * TODO-OWNER: page title (it is also the link preview), as on /agent.
 */
export async function generateMetadata({ params }: { params: Promise<{ asset: string }> }): Promise<Metadata> {
	const { asset } = await params;
	const { markets } = await marketSummariesData();
	const match = markets.find((market) => market.slug === asset.toLowerCase());
	return match === undefined ? {} : { title: `${match.name} · Thesis.fun` };
}

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
	// ONE read for both consumers — the header's stat tiles and the About panel's
	// split bars. It costs no network call (it reads the cached order snapshot the
	// page already fetched) but calling it twice would compute the same tallies
	// twice from the same snapshot.
	const bookStats = await marketBookStats(market.asset);

	// The centre column's LEAD card: the instrument, its live spot and the stat
	// tiles. Passed to the frame as `mainLead` rather than as the first child, so
	// the ticket can sit between it and the rest of the column in the DOM when the
	// page stacks. The markup is unchanged.
	const marketHeader = (
		<section className="card pad">
			<div className="mkt-head">
				<Avatar asset={market.asset} initials={market.asset} tone="asset" size={44} />
				<div>
					<h1>{market.name}</h1>
					{/* K-2 (pass-4 D4-m9): the same rule the rail, the feed's markets card
					    and the search list follow — the symbol is dropped from the line
					    under the name when it IS the name. A live market's `name` is its
					    ticker (`lib/market/summaries.ts`), so this read "ETH" over
					    "ETH · Base · Thetanuts OptionBook". The venue stays; it is what
					    this line is for. */}
					<span className="sub">
						{market.asset === market.name ? market.venueLabel : `${market.asset} · ${market.venueLabel}`}
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
				{marketStatTiles(market, tagged.length, bookStats).map((tile) => (
					<span className="tile" key={tile.label}>
						{/* D-R3-3: a tile whose aggregation rule is not the
						    owner's carries the marker every other unapproved
						    number carries. `lib/market/stat-tiles.ts` decides
						    which; nothing new is worded here. */}
						<i>{tile.label}{tile.todoOwner ? <TodoOwner /> : null}</i>
						<b className="num">{tile.value}</b>
					</span>
				))}
			</div>
		</section>
	);

	return (
		<PageFrame
			ticketFirst
			left={<FeedRail posts={rail} markets={summaries} />}
			// K-2: the market header is the centre column's LEAD card. It stays the
			// top of `.col-main` on a wide screen and becomes its own row directly
			// above the ticket when the columns stack, which is what lets the ticket
			// sit second in the DOM as well as second on screen.
			mainLead={marketHeader}
			// TODO-OWNER: a bottom-sheet ticket remains a later option.
			// K-2: the ticket is its own frame slot. Its wrapper is the same element
			// in every band, so a resize across 1180px moves it without remounting
			// it — the typed budget, the held fill and the approval flow survive.
			ticket={
				unavailable !== null ? (
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
					<TakeASide
						ticket={market.ticket}
						structureLabel={market.selectedLabel}
						expiryLabel={market.selectedExpiryLabel}
					/>
				) : (
					<MarketRail
						trade={trade}
						structureLabel={market.selectedLabel}
						expiryLabel={market.selectedExpiryLabel}
					/>
				)}
			right={
				<>
				{unavailable !== null ? null : (
					// The "Post about" panel is not the ticket: it is a plain link to
					// the composer, and it stacks with the other trailing panels. It
					// used to be returned by `MarketRail` in the trade branch and
					// written out here in the other; it is written once now, with the
					// same markup and the same link each branch had.
					<section className="card pad mkt-panel">
						<h3 style={{ fontSize: "15px" }}>Post about {market.asset}</h3>
						<p className="fine">
							{/* TODO-OWNER: standalone trades cannot confer a verified post badge. */}
							Write your read on this market. You can tag the market or link a trade. Linking a standalone trade does not add a verified badge. <TodoOwner />
						</p>
						<Link
							className="btn sec block"
							style={{ marginTop: "14px" }}
							href={trade === null ? "/new" : { pathname: "/new", query: { asset: trade.asset } }}
						>
							Write a post
						</Link>
					</section>
				)}

				{/* Under the ticket on a wide screen, after the centre column when the
				    page stacks — the ticket is its own frame slot now, so this column
				    holds only the panels that trail it.

				    The ticket is deliberately NOT one of these tabs: it is the money
				    path and must never be a click away. Everything that used to sit
				    below it as its own card is here instead, which also fixes the
				    reason the agent panel had to cap its own height — the right column
				    is one `position:sticky` stack, and four stacked cards pushed the
				    lower ones past the bottom of the viewport where sticky cannot
				    reach them.

				    The MARKETS card that used to close this column is gone: it is the
				    left rail's `Markets` tab now. */}
				<RightTabs
					about={<AboutPanel market={market} book={bookStats} />}
					agent={<AgentChat asset={market.asset} variant="panel" />}
					positions={
						signedIn ? (
							<YourPositionsRail asset={market.asset} />
						) : (
							// `YourPositionsRail` renders nothing at all when there is no
							// session, so without this the tab would be a blank panel with
							// no explanation. "0 open" is not offered instead: it would be
							// a statement about a wallet nobody has connected.
							// TODO-OWNER: signed-out positions copy.
							<p className="note">
								Connect a wallet from the header to see your {market.asset}{" "}
								positions. <TodoOwner />
							</p>
						)
					}
				/>
				</>
			}
		>
				{/* The chart sits ABOVE the structures list and below the header: the
				    strikes it draws are the rows underneath it, so the level and the
				    row that names it are read together. Its strikes come from the
				    SELECTED structure, so choosing a different row moves the lines. */}
				<PriceChart
					asset={market.asset}
					strikesUsd={market.structures.find((row) => row.selected)?.strikesUsd ?? []}
					strikesLabel={market.structures.find((row) => row.selected)?.strikesLabel ?? null}
					// The posts about this market, drawn on the candles they were
					// written in. Only what the page already read; no extra query.
					theses={tagged.map((post) => ({
						id: post.id,
						slug: post.slug,
						createdAt: post.createdAtIso,
						headline: post.headline,
						handleLabel: post.creator.handleLabel,
						avatarSeed: post.creator.avatarSeed,
						direction: post.direction,
						likes: post.likes,
					}))}
				/>

				{unavailable !== null ? <span className="mkt-warn">{unavailable}</span> : null}

				{/* fomo's tabbed table under the chart. `Structures` is the default tab
				    and the row selection is still a LINK, so the chart above keeps
				    reading `market.structures.find(row => row.selected)` off a fresh
				    server render.

				    C#6: whether the LIST can navigate is a different question from
				    whether the REQUESTED instrument can be ticketed. Passing
				    `trade !== null` made every "Select" inert on the one page whose
				    own copy says "pick another one from the list below". */}
				<MarketTabs
					rows={market.structures}
					slug={market.slug}
					query={carried}
					live={selectable}
					posts={tagged}
					asset={market.asset}
					signedIn={signedIn}
					databaseMode={databaseMode}
				/>
		</PageFrame>
	);
}
