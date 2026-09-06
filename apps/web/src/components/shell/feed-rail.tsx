"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { TabHeading, TabPanel } from "@/components/feed/tabs";
import { usd2 } from "@/lib/format";
import type { MarketSummary, Thesis } from "@/lib/display-types";

const LABELS = ["Markets", "Feed"] as const;

/**
 * The persistent left rail every page except the feed carries
 * (docs/mockups/thesis-fun-mockup.html, `#tpl-rail`).
 *
 * fomo's left column is a TABBED panel over one scrolling list — `Tokens · Feed ·
 * Leaderboard` (docs/design/FOMO-DIGEST.md, "Token page layout") — so this rail
 * is the same shape: `Markets` is the live asset list, `Feed` the latest posts it
 * has always shown. Both lists stay mounted and the inactive one is hidden with
 * the `hidden` attribute, so switching tabs never re-runs a list and the rail's
 * scroll position survives.
 *
 * Presentational on purpose: it takes the posts AND the markets the page already
 * read, so a page never pays for a second query and the rail is identical in mock
 * and database mode.
 *
 * `markets` is OPTIONAL and, at the time of writing, only `/m/[asset]` passes it
 * — that page already holds `summaries` from its own read. A page that passes
 * none renders the untabbed post rail it rendered before, rather than a Markets
 * tab that is empty; wiring the remaining four call sites means giving each of
 * them a `marketSummariesData()` read, which in database mode calls
 * `connection()` and would change those routes' rendering mode.
 */
// TODO-OWNER: provisional latest-post rail limit, and the market-list limit below.
export function FeedRail({
	posts,
	markets,
	limit = 5,
	marketLimit = 12,
}: {
	posts: Thesis[];
	markets?: MarketSummary[];
	limit?: number;
	marketLimit?: number;
}) {
	const id = useId();
	const [tab, setTab] = useState(0);
	if (markets === undefined) {
		return (
			<section className="card">
				<div className="card-h">
					<h2>Latest theses</h2>
					<span className="x">
						<Link href="/">View feed</Link>
					</span>
				</div>
				<div className="card-b rail-list">
					<PostRows posts={posts} limit={limit} />
				</div>
			</section>
		);
	}
	return (
		<section className="card">
			<div className="card-h tabs-h">
				<TabHeading
					id={id}
					labels={LABELS}
					selected={tab}
					onSelect={setTab}
					label="Markets and latest theses"
				/>
				{/* No counterpart on the Markets tab: there is no markets index route
				    (`components/shell/nav.tsx` records the same fact and its
				    TODO-OWNER), so there is nowhere for an "All markets" link to go. */}
				{tab === 1 ? (
					<span className="x">
						<Link href="/">View feed</Link>
					</span>
				) : null}
			</div>
			<TabPanel id={id} selected={tab}>
				<div className="card-b rail-list" hidden={tab !== 0}>
					{markets.slice(0, marketLimit).map((market) => (
						<Link className="row" href={`/m/${market.slug}`} key={market.slug}>
							<Avatar asset={market.asset} initials={market.asset} tone="asset" size={30} />
							<span className="t">
								<b>{market.name}</b>
								{/* K-2 (pass-4 D4-m9): the symbol is dropped from this line when
								    it repeats the name above it. A market's `name` IS its symbol
								    in database mode — the Thetanuts SDK publishes ticker symbols
								    and no full names (`lib/market/summaries.ts`) — so the row read
								    "ETH" over "ETH · Base". The chain is not dropped with it: it
								    is the one thing this line says that the name does not. */}
								<i>{market.asset === market.name ? "Base" : `${market.asset} · Base`}</i>
							</span>
							<span className="v">
								<b className="num">{usd2(market.spotUsd)}</b>
								{market.changeLabel ? (
									<i className={`${market.changeClass} num`}>{market.changeLabel}</i>
								) : null}
							</span>
						</Link>
					))}
					{markets.length === 0 ? <span className="empty">No live market right now.</span> : null}
				</div>
				<div className="card-b rail-list" hidden={tab !== 1}>
					<PostRows posts={posts} limit={limit} />
				</div>
			</TabPanel>
		</section>
	);
}

function PostRows({ posts, limit }: { posts: Thesis[]; limit: number }) {
	return (
		<>
			{posts.slice(0, limit).map((post) => (
				<Link className="rail-post" href={`/t/${post.slug}`} key={post.slug}>
					<Avatar seed={post.creator.avatarSeed} initials={post.creator.initials} size={30} />
					<div className="t">
						<div className="n">
							{/* The NAME, not the handle: the mockup's rail row prints the
							    bare `.p-name` string (`#tpl-rail`, lines 436/442/448/454/460 —
							    "merkle_mike", "tailbet", …), and every handle in that file
							    carries a leading "@" (lines 539, 574, 592, 829, 1066, 1178).
							    The feed byline already prints `displayName`; the rail printed
							    `handleLabel`, so one page spoke two vocabularies about the
							    same person (demo-seed report D4). */}
							{post.creator.displayName}
							{/* `postedLabel` carries the byline's leading "· "; the rail
							    shows the bare time. */}
							<span>{post.postedLabel.replace(/^·\s*/, "")}</span>
						</div>
						<p>{post.headline}</p>
						<span className={`m ${post.backing ? `${post.backing.creatorLivePnlUsd.pnlClass} num` : ""}`}>
							{railMeta(post)}
						</span>
					</div>
				</Link>
			))}
		</>
	);
}

/**
 * The rail's one meta line. A post with no fill says so rather than showing a
 * P&L it does not have; a settled one names the settlement instead of an
 * instrument, which is what the mockup writes.
 */
function railMeta(post: Thesis): string {
	if (post.backing === null) return "no position";
	const pnl = post.backing.creatorLivePnlUsd.signed;
	if (post.backing.settled) return `${pnl} · settled`;
	const instrument = [post.asset, post.structure?.productType].filter(Boolean).join(" ");
	return instrument === "" ? pnl : `${pnl} · ${instrument}`;
}
