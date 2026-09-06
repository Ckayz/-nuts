import Link from "next/link";
import { PositionRows } from "@/components/thesis/position-rows";
import { FeedRail } from "@/components/shell/feed-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { CreatorStats } from "@/components/creator/creator-stats";
import { Leaderboard } from "@/components/creator/leaderboard";
import { TodoOwnerNote } from "@/components/primitives";
import { discoverData, portfolioData, railTheses } from "@/lib/page-data";
import "@/styles/profile.css";

/**
 * K-2 (pass-4 D4-m5). This route printed the layout's generic "Thesis.fun" in
 * the tab and in every shared link. The title is the page's OWN h1 text, joined
 * to the site name with the separator the one other route that names it uses
 * (`app/agent/page.tsx:5`, "Agent · Thesis.fun") — no new words.
 *
 * Signed OUT that h1 is "Portfolio", the nav's own word for the route. Signed
 * in, `CreatorStats` renders the reader's own name as the heading instead; a
 * static title keeps one word in the tab for both, and keeps a personal name
 * out of a link preview.
 * TODO-OWNER: page title (it is also the link preview), as on /agent.
 */
export const metadata = {
	title: "Portfolio · Thesis.fun",
};

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
  {/* K-2 (CL-10): "Ranking formula" is the placeholder, hidden with its marker. */}
  <div className="card-f">P&amp;L is 1W, from onchain fills and settlements.<TodoOwnerNote> Ranking formula</TodoOwnerNote></div>
 </section>}>
  {/* m4: signed in, `CreatorStats profile` renders the owner's name as the
      page heading. Signed out there is no header at all, so the route had no
      `h1`; the nav's own word for it stands in, out of the picture. */}
  {currentUser ? null : <h1 className="a11y-hidden">Portfolio</h1>}
  {/* TODO-OWNER: own-profile link copy. */}
  {currentUser ? <><CreatorStats creator={currentUser} profile self /><Link className="btn sec" href={`/u/${currentUser.handle}`}>Your profile</Link></> : null}
  <PositionRows title="Positions" rows={[...openPositions, ...settledPositions]} />
 </PageFrame>;
}
