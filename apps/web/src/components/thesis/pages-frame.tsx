import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/primitives";
import { CreatorStats } from "@/components/creator/creator-stats";
import { discoverData, socialPageState } from "@/lib/page-data";

/** Temporary page-local adapter until the FEED lane's PageFrame is merged. */
export async function PagesFrame({ children, right }: { children: ReactNode; right?: ReactNode }) {
 const data = await discoverData();
 const traders = right === undefined ? await Promise.all(data.leaderboard.map(async creator => ({ creator, social: await socialPageState(creator.id) }))) : [];
 return <div className="wrap"><div className="cols page">
  <aside className="col-left"><div className="sticky"><section className="card"><div className="card-h"><h3>Latest theses</h3><span className="x"><Link href="/">View feed</Link></span></div><div className="card-b">
   {data.theses.map(t => <Link key={t.id} className="rail-post" href={`/t/${t.slug}`}><Avatar initials={t.creator.initials} size="s" /><span className="t"><span className="n">{t.creator.displayName}<span>{t.postedLabel}</span></span><p>{t.headline}</p></span></Link>)}
  </div></section></div></aside>
  <main className="stack lg">{children}</main>
  <aside className="col-right"><div className="sticky">{right ?? <section className="card"><div className="card-h"><h3>Follow top traders</h3><span className="x">1W</span></div><div className="card-b">{traders.map(({ creator, social }) => <CreatorStats key={creator.handle} creator={creator} {...social} compact />)}</div><div className="card-f">P&amp;L is 1W, from onchain fills and settlements. Ranking formula<span className="todo">TODO-OWNER</span></div></section>}</div></aside>
 </div></div>;
}
