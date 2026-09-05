import { CalloutPost } from "@/components/feed/callout-post";
import { NewCalloutsBar } from "@/components/feed/new-callouts-bar";
import { PositionList, TrendingList } from "@/components/feed/thesis-list";
import { Leaderboard } from "@/components/creator/leaderboard";
import { Pill, TodoOwner } from "@/components/primitives";
import { discoverData } from "@/lib/page-data";

export default async function DiscoverPage() {
	const { leaderboard, theses, trending, yourPositions } = await discoverData();
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
				<div className="sec-h">
					<h2 className="h2">
						Callouts<span className="alt">Following</span>
						<span className="alt">Top</span>
					</h2>
					<div style={{ display: "flex", gap: "6px" }}>
						<Pill on>All</Pill>
						<Pill>BTC</Pill>
						<Pill>ETH</Pill>
						<Pill>SOL</Pill>
					</div>
				</div>
				<NewCalloutsBar />
				<div className="feed">
					{theses.map((t) => (
						<CalloutPost key={t.slug} thesis={t} />
					))}
				</div>
			</main>

			<aside className="col r">
				<div className="sec">
					<div className="sec-h">
						<h2 className="h2">
							Trending<span className="alt">Ending</span>
							<span className="alt">Settled</span>
						</h2>
					</div>
					<TrendingList items={trending} />
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
