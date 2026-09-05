import { ProfileEditor } from "@/components/creator/profile-editor";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { CreatorStats } from "@/components/creator/creator-stats";
import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { LikeButton } from "@/components/feed/like-button";
import { CommentIcon, ShareIcon } from "@/components/icons";
import { PositionRows } from "@/components/thesis/position-rows";
import { ProfileTabs } from "@/components/thesis/profile-tabs";
import { PagesFrame } from "@/components/thesis/pages-frame";
import "@/styles/profile.css";
import { creatorPageData } from "@/lib/page-data";

/**
 * Rendered per request, never from a build-time cache. Same reason as
 * `/t/[slug]`: in `DATA_SOURCE=db` a creator's profile changes after the build,
 * and segment config must be a static string, so it applies in mock mode too.
 */
export const dynamic = "force-dynamic";

/** Share metadata reads through the same mode-aware path as the page. */
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
	const { vercelOrigin } = await import("@nuts/env/server");
	const { handle } = await params;
	const data = await creatorPageData(handle.toLowerCase());
	if (!data) notFound();
	const title = data.creator.displayName;
	const description = data.creator.walletAddress ?? `@${data.creator.handle}`;
	return {
		...(vercelOrigin ? { metadataBase: new URL(vercelOrigin) } : {}),
		title,
		description,
		openGraph: { title, description, type: "profile" },
		twitter: { card: "summary_large_image", title, description },
	};
}

export default async function CreatorPage({
	params,
}: {
	params: Promise<{ handle: string }>;
}) {
	const { handle } = await params;
	// One canonical URL per creator. The handle is a lowercase wallet address
	// (lib/data/identity.ts) and `getCreator` lowercases before it queries, so
	// `/u/0xAB…` and `/u/0xab…` used to be two live URLs with identical content —
	// two cache entries and two share links for one profile. Redirect rather than
	// 404 so links that were already shared in mixed case keep working.
	if (handle !== handle.toLowerCase()) permanentRedirect(`/u/${handle.toLowerCase()}`);
	const data = await creatorPageData(handle);
	if (!data) notFound();
	const { creator, callouts, positions } = data;

 return <PagesFrame>
  <CreatorStats creator={creator} signedIn={data.signedIn} databaseMode={data.databaseMode} following={data.following} self={data.self} profile />
  {data.isOwner && data.editableProfile ? <ProfileEditor key={JSON.stringify(data.editableProfile)} profile={data.editableProfile} walletAddress={data.editableProfile.walletAddress} /> : null}
  <ProfileTabs positions={<PositionRows rows={positions} />} posts={<section className="card profile-posts"><div className="card-h"><h3>Recent posts</h3><span className="x num">{callouts.length}</span></div><div className="card-b">{callouts.map(t => <article className="post" key={t.slug}><Avatar initials={t.creator.initials} size="s" /><div className="post-main"><div className="p-head"><span className="p-name">{t.creator.displayName}</span><span className="p-time">{t.postedLabel}</span>{t.backing ? <span className="chip flat">Backed</span> : null}</div><p className="p-body"><Link href={`/t/${t.slug}`}>{t.headline}</Link></p><div className="p-acts"><LikeButton thesisId={t.id} likes={t.likes} liked={t.likedByViewer} signedIn={data.signedIn} databaseMode={data.databaseMode} /><Link className="act" href={`/t/${t.slug}`} aria-label={`Comments, ${t.commentCount}`}><CommentIcon />{t.commentCount}</Link><button className="act" type="button"><ShareIcon />Share</button></div></div></article>)}</div></section>} />
 </PagesFrame>;
}
