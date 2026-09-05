import { CalloutTabs } from "@/components/feed/callout-tabs";
import { RailTabs } from "@/components/feed/rail-tabs";
import { PositionList } from "@/components/feed/thesis-list";
import { Leaderboard } from "@/components/creator/leaderboard";
import { Pill, TodoOwner } from "@/components/primitives";
import { discoverData } from "@/lib/page-data";

export default async function DiscoverPage() {
	const { leaderboard, theses, following, top, trending, ending, settled, yourPositions, signedIn, databaseMode } = await discoverData();
	return (
		<div className="work">
			<aside className="col l">
				<div className="sec">
					<div className="sec-h">
						<h2 className="h2">
							Top P&amp;L
						</h2>
					</div>
					<div style={{ display: "flex", gap: "6px" }}>
						<Pill on>Net P&amp;L ▾</Pill>
						<Pill>1W ▾</Pill>
					</div>
					<Leaderboard creators={leaderboard} />
					<span className="note">
						All P&amp;L from onchain fills and settlements. Ranking formula{" "}
						<TodoOwner />
					</span>
				</div>
			</aside>

			<main className="col">
				<CalloutTabs {...{ theses, following, top, signedIn, databaseMode }} />
			</main>

			<aside className="col r">
				<div className="sec">
					<RailTabs {...{ trending, ending, settled }} />
					<span className="note">
						Trending and ending rules <TodoOwner />
					</span>
				</div>
				<div className="sec">
					<div className="sec-h">
						<span className="lbl">Your positions</span>
						<span className="mono dim" style={{ fontSize: "11px" }}>
							{yourPositions.length} open
						</span>
					</div>
					<PositionList positions={yourPositions} />
				</div>
			</aside>
		</div>
	);
}
