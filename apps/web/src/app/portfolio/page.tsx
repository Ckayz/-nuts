import Link from "next/link";
import { PositionRows } from "@/components/thesis/position-rows";
import { FeedRail } from "@/components/shell/feed-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { CreatorStats } from "@/components/creator/creator-stats";
import { Leaderboard } from "@/components/creator/leaderboard";
import { TodoOwner } from "@/components/primitives";
import { discoverData, portfolioData, railTheses } from "@/lib/page-data";
import "@/styles/profile.css";

/** No dedicated portfolio mockup: use the profile's position rows. */
export default async function PortfolioPage() {
 const { openPositions, settledPositions, currentUser } = await portfolioData();
 const [rail, discover] = await Promise.all([railTheses(), discoverData()]);
 // No portfolio mockup exists, so the page uses the mockup's own page grid: the
 // feed rail on the left and the top-traders card on the right, as `/u/[handle]`
 // has them. Without a third column the centre stretches to 875px and the
 // positions rows sit alone in it.
 return <PageFrame left={<FeedRail posts={rail} />} right={<section className="card">
  <div className="card-h"><h3>Follow top traders</h3><span className="x">1W</span></div>
  <Leaderboard entries={discover.leaderboard} signedIn={discover.signedIn} databaseMode={discover.databaseMode} />
  <div className="card-f">P&amp;L is 1W, from onchain fills and settlements. Ranking formula<TodoOwner /></div>
 </section>}>
  {/* TODO-OWNER: own-profile link copy. */}
  {currentUser ? <><CreatorStats creator={currentUser} profile self /><Link className="btn sec" href={`/u/${currentUser.handle}`}>Your profile</Link></> : null}
  <PositionRows title="Positions" rows={[...openPositions, ...settledPositions]} />
 </PageFrame>;
}
