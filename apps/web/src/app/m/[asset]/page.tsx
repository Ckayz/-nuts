import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { YourPositionsRail } from "@/components/market/your-positions-rail";
import { TaggedPostsTabs } from "@/components/market/tagged-posts-tabs";
import { getSession } from "@/lib/auth/session";
import { MarketRail } from "@/components/market/market-rail";
import { StructuresList } from "@/components/market/structures-list";
import { TakeASide } from "@/components/market/take-a-side";
import { usd, usd2 } from "@/lib/format";
import { usingDatabase } from "@/lib/data/source";
import { marketBySlug, marketSummaries, thesesByMarket } from "@/lib/view-data";
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
		<main className="wrap">
<div className="cols page no-left">
				{/* MERGE: this is `PageFrame` (shell lane, `components/shell/page-frame.tsx`)
				    written out, because that module does not exist in this lane's tree.
				    At merge, replace this element and its two rails with:
				      <PageFrame left={<FeedRail posts={...} />} right={<>…right column…</>}>
				        …centre…
				      </PageFrame>
				    `no-left` drops the rail's grid track until then, so the page is not
				    left with an empty 264px column. */}

				<div className="stack lg">
					<section className="card pad">
						<div className="mkt-head">
							<span className="av av-44 av-asset" aria-hidden="true">
								{market.asset}
							</span>
							<div>
								<h1>{market.name}</h1>
								<span className="sub">
									{market.asset} · {market.venueLabel}
								</span>
							</div>
							<span className="px">
								<b className="num">{usd2(market.spotUsd)}</b>
								<i className={`${market.changeClass} num`}>
									{market.changeLabel} <span className="mut">24h</span>
								</i>
							</span>
						</div>
						<div className="stats">
							<span className="tile">
								<i>Spot</i>
								<b className="num">{usd(market.spotUsd)}</b>
							</span>
							<span className="tile">
								<i>24h</i>
								<b className={`${market.changeClass} num`}>{market.changeLabel}</b>
							</span>
							<span className="tile">
								<i>Structures</i>
								<b className="num">{market.structureCount}</b>
							</span>
							<span className="tile">
								<i>Tagged posts</i>
								<b className="num">{tagged.length}</b>
							</span>
						</div>
					</section>

					{unavailable !== null ? <span className="mkt-warn">{unavailable}</span> : null}

					<StructuresList
						rows={market.structures}
						slug={market.slug}
						query={carried}
						live={trade !== null}
					/>

					<TaggedPostsTabs
						posts={tagged}
						asset={market.asset}
						signedIn={signedIn}
						databaseMode={databaseMode}
					/>
				</div>

				<div className="col-right">
					<div className="sticky stack">
						{trade === null ? (
							<>
								<TakeASide
									ticket={market.ticket}
									structureLabel={market.selectedLabel}
									expiryLabel={market.selectedExpiryLabel}
								/>
								<section className="card pad mkt-panel">
									<h3 style={{ fontSize: "15px" }}>Post about {market.asset}</h3>
									<p className="fine">
										Write your read on this market. A post is text first — tag this structure if you
										want, and it shows the verified badge only once your own fill confirms.
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
											<span className="av av-30 av-asset" aria-hidden="true">
												{m.asset}
											</span>
											<span className="t">
												<b>{m.name}</b>
												<i>
													{m.asset} · Base
												</i>
											</span>
											<span className="v">
												<b className="num">{usd2(m.spotUsd)}</b>
												<i className={`${m.changeClass} num`}>{m.changeLabel}</i>
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
					</div>
				</div>
			</div>
		</main>
	);
}
