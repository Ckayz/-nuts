import Link from "next/link";
import { Avatar } from "@/components/primitives";
import type { Thesis } from "@/lib/display-types";

/**
 * The persistent left rail of compact posts that every page except the feed
 * carries (docs/mockups/thesis-fun-mockup.html, `#tpl-rail`).
 *
 * Presentational on purpose: it takes the posts the page already read, so a
 * page never pays for a second feed query and the rail is identical in mock and
 * database mode. Pages pass `theses` from their own `page-data` read.
 */
export function FeedRail({ posts, limit = 5 }: { posts: Thesis[]; limit?: number }) {
	return (
		<section className="card">
			<div className="card-h">
				<h2>Latest theses</h2>
				<span className="x">
					<Link href="/">View feed</Link>
				</span>
			</div>
			<div className="card-b">
				{posts.slice(0, limit).map((post) => (
					<Link className="rail-post" href={`/t/${post.slug}`} key={post.slug}>
						<Avatar initials={post.creator.initials} size={30} />
						<div className="t">
							<div className="n">
								{post.creator.handle}
								{/* `postedLabel` carries the byline's leading "· "; the rail
								    shows the bare time. */}
								<span>{post.postedLabel.replace(/^·\s*/, "")}</span>
							</div>
							<p>{post.headline}</p>
							<span className={`m ${post.backing ? `${post.backing.creatorLivePnlUsd.pnlClass} num` : ""}`}>
								{railMeta(post)}
							</span>
						</div>
					</Link>
				))}
			</div>
		</section>
	);
}

/**
 * The rail's one meta line. A post with no fill says so rather than showing a
 * P&L it does not have; a settled one names the settlement instead of an
 * instrument, which is what the mockup writes.
 */
function railMeta(post: Thesis): string {
	if (post.backing === null) return "no position";
	const pnl = post.backing.creatorLivePnlUsd.signed;
	if (post.backing.settled) return `${pnl} · settled`;
	const instrument = [post.asset, post.structure?.productType].filter(Boolean).join(" ");
	return instrument === "" ? pnl : `${pnl} · ${instrument}`;
}
