import { CalloutTabs } from "@/components/feed/callout-tabs";
import { RailTabs } from "@/components/feed/rail-tabs";
import { MarketList, PositionList } from "@/components/feed/thesis-list";
import { Leaderboard } from "@/components/creator/leaderboard";
import { PageFrame } from "@/components/shell/page-frame";
import { TodoOwner } from "@/components/primitives";
import { discoverData } from "@/lib/page-data";
import { marketSummaries } from "@/lib/view-data";

/**
 * The feed (docs/mockups/thesis-fun-mockup.html, `#feed`): traders to follow on
 * the left, the posts in the middle, your positions and the markets on the
 * right. It is the one page with no left FEED rail — it IS the feed.
 *
 * GAP, reported: the Markets panel reads `marketSummaries` from the mock
 * boundary in both modes. There is no database read for markets — assets come
 * from live OptionBook orders — and the icon rail this replaces resolved its
 * Markets link the same way.
 */
export default async function DiscoverPage() {
	const { leaderboard, theses, following, top, trending, ending, settled, yourPositions, signedIn, databaseMode } = await discoverData();
	return (
		<PageFrame
			variant="feed"
			stackGap="sm"
			left={
				<section className="card" id="top-traders">
					<div className="card-h">
						<h2>Follow top traders</h2>
						<span className="x">1W</span>
					</div>
					<Leaderboard creators={leaderboard} />
					<div className="card-f">
						P&amp;L is 1W, from onchain fills and settlements. Ranking formula
						<TodoOwner />
					</div>
				</section>
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
							<span className="x num">{marketSummaries.length} live</span>
						</div>
						<MarketList markets={marketSummaries} />
						<div className="card-f">
							Assets, strikes and expiries come from live OptionBook orders. Nothing
							here is a hardcoded list.
						</div>
					</section>
				</>
			}
		>
			<CalloutTabs
				{...{ theses, following, top, signedIn, databaseMode }}
				filters={<RailTabs {...{ trending, ending, settled }} />}
			/>
		</PageFrame>
	);
}
