import { PositionRows } from "@/components/thesis/position-rows";
import { PagesFrame } from "@/components/thesis/pages-frame";
import { CreatorStats } from "@/components/creator/creator-stats";
import { portfolioData } from "@/lib/page-data";
import "@/styles/profile.css";

/** No dedicated portfolio mockup: use the profile's position rows. */
export default async function PortfolioPage() {
 const { openPositions, settledPositions, currentUser } = await portfolioData();
 return <PagesFrame>
  {currentUser ? <CreatorStats creator={currentUser} profile self /> : null}
  <div className="tabs"><span>Positions</span></div>
  <PositionRows rows={[...openPositions, ...settledPositions]} />
 </PagesFrame>;
}
