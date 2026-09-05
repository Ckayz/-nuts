import { CalloutTabs } from "@/components/feed/callout-tabs";
import { MarketList, PositionList } from "@/components/feed/thesis-list";
import { Leaderboard } from "@/components/creator/leaderboard";
import { FarcasterRail } from "@/components/shell/farcaster-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { TodoOwner } from "@/components/primitives";
import { farcasterRail } from "@/lib/farcaster/casts";
import { discoverData } from "@/lib/page-data";
import { marketSummariesData } from "@/lib/market/summaries";

/**
 * The feed (docs/mockups/thesis-fun-mockup.html, `#feed`): traders to follow on
 * the left, the posts in the middle, your positions and the markets on the
 * right. It is the one page with no left FEED rail — it IS the feed.
 *
 */
export default async function DiscoverPage() {
	const [
		{ leaderboard, following, top, ranked, yourPositions, signedIn, databaseMode },
		{ markets: marketSummaries, unavailable },
		farcaster,
	] = await Promise.all([discoverData(), marketSummariesData(), farcasterRail()]);
	return (
		<PageFrame
			variant="feed"
			stackGap="sm"
			left={
				// The Farcaster rail sits UNDER the app's own leaderboard, in the left
				// column. Grid columns are independent, so it displaces neither the
				// centre feed nor the right column: the app's own content keeps every
				// pixel it had, and somebody else's network is visibly secondary to it.
				<div className="stack">
					{/* `tabIndex={-1}` so the nav's Leaderboard link, which is an in-page
					    anchor to this card, moves keyboard focus here and not just the
					    scroll position. */}
					<section className="card" id="top-traders" tabIndex={-1}>
						<div className="card-h">
							<h2>Follow top traders</h2>
							<span className="x">1W</span>
						</div>
						<Leaderboard entries={leaderboard} signedIn={signedIn} databaseMode={databaseMode} />
						<div className="card-f">
							P&amp;L is 1W, from onchain fills and settlements. Ranking formula
							<TodoOwner />
						</div>
					</section>
					<FarcasterRail state={farcaster} />
				</div>
			}
			right={
				<>
					<section className="card">
						<div className="card-h">
							<h2>Your positions</h2>
							<span className="x num">{yourPositions.length} open</span>
						</div>
						<PositionList positions={yourPositions} />
					</section>
					<section className="card">
						<div className="card-h">
							<h2>Markets</h2>
							<span className="x num">{unavailable ? "—" : `${marketSummaries.length} live`}</span>
						</div>
						{/* TODO-OWNER: market feed failure copy. */}
						{unavailable ? <p className="card-b">Markets unavailable. <TodoOwner /></p> : <MarketList markets={marketSummaries} />}
						<div className="card-f">
							Assets, strikes and expiries come from live OptionBook orders. Nothing
							here is a hardcoded list.
						</div>
					</section>
				</>
			}
		>
			<CalloutTabs {...{ ranked, following, top, signedIn, databaseMode }} />
		</PageFrame>
	);
}
