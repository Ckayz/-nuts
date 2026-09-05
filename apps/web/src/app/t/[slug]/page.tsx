import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreatorStats } from "@/components/creator/creator-stats";
import { CopyLink } from "@/components/position/copy-link";
import { LikeButton } from "@/components/feed/like-button";
import { PostText, TradeCards } from "@/components/feed/trade-card";
import { PnlCard } from "@/components/position/pnl-card";
import { CommentIcon, ShareIcon, SparkIcon } from "@/components/icons";
import { Avatar, StatusChip } from "@/components/primitives";
import { CommentsList } from "@/components/thesis/comments-list";
import { FeedRail } from "@/components/shell/feed-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { thesisDetailData, railTheses, socialPageState } from "@/lib/page-data";
import "@/styles/thread.css";
/**
 * Rendered per request, never from a build-time cache.
 *
 * In `DATA_SOURCE=db` the rows behind this page change after the build: new
 * comments and participants arrive, and a thesis first requested while it is a
 * `draft` 404s — a cached 404 would then outlive publication and the page would
 * never appear. Segment config has to be a static string (Next refuses a
 * computed one), so this applies in mock mode too, where it costs a render of
 * fixtures that cannot change. A `revalidate` interval would be an owner's
 * number and is deliberately not used.
 */
export const dynamic = "force-dynamic";

/** Share metadata reads through the same mode-aware path as the page. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { vercelOrigin } = await import("@nuts/env/server");
	const detail = await thesisDetailData((await params).slug);
	if (!detail) notFound();
	const title = detail.thesis.headline;
	const description = detail.thesis.note ?? detail.thesis.headline;
	return {
		...(vercelOrigin ? { metadataBase: new URL(vercelOrigin) } : {}),
		title,
		description,
		openGraph: { title, description, type: "article" },
		twitter: { card: "summary_large_image", title, description },
	};
}

export default async function ThesisPage({ params }: { params: Promise<{ slug: string }> }) {
 const detail = await thesisDetailData((await params).slug);
 if (!detail) notFound();
 const t = detail.thesis;
 const social = await socialPageState(t.creator.id);
 const rail = await railTheses();
 return <PageFrame left={<FeedRail posts={rail} />} right={<>
  {t.tag ? <section className="card pad thread-market">
   <h3>Trade this on the {t.tag.asset} market</h3>
   <p className="mut">{t.tag.structureLabel ? `This post names the ${t.tag.asset} ${t.tag.structureLabel}.` : `This post is about the ${t.tag.asset} market.`}</p>
   {detail.expiryLabel ? <p className="mut num">{detail.expiryLabel}</p> : null}
   <Link className="btn acc block" href={`/m/${t.tag.slug}?thesis=${t.id}`}>Open the {t.tag.asset} market</Link>
  </section> : null}
  <CreatorStats creator={t.creator} {...social} />
 </>}>
  <article className="post thread-post">
   <Link href={`/u/${t.creator.handle}`} aria-label={t.creator.displayName}><Avatar initials={t.creator.initials} /></Link>
   <div className="post-main">
    <div className="p-head"><Link className="p-name" href={`/u/${t.creator.handle}`}>{t.creator.displayName}</Link><span className="p-handle">@{t.creator.handleLabel}</span><span className="p-time">{t.postedLabel}</span>
     {t.status && t.statusLabel ? <StatusChip status={t.status} label={t.statusLabel} /> : null}
     {t.backingCard ? <span className="chip">Backed</span> : null}
    </div>
    <div className="p-body"><h1>{t.headline}</h1>{t.note ? <div className="second"><PostText text={t.note} tokens={t.noteTokens} /></div> : null}</div>
    {t.backingCard ? <PnlCard card={t.backingCard} compact href /> : null}
    <TradeCards cards={t.tradeCards} />
    <div className="p-acts"><LikeButton thesisId={t.id} {...social} likes={t.likes} liked={t.likedByViewer} /><a className="act" href="#comments"><CommentIcon />{t.commentCount}</a><CopyLink path={`/t/${t.slug}`} className="act" label={<><ShareIcon />Share</>} /><Link className="act" href={`/agent?thesis=${t.id}`}><SparkIcon />Explain</Link></div>
    <span className="mut num thread-link">{detail.shareUrl}</span>
   </div>
  </article>
  <section className="card" id="comments"><div className="card-h"><h3>Comments</h3><span className="x num">{t.commentCount}</span></div><div className="card-b thread-comments"><CommentsList comments={detail.comments} thesisId={t.id} {...social} /></div></section>
 </PageFrame>;
}
