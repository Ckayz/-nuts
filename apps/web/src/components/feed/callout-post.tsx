import Link from "next/link";
import { PositionCard } from "@/components/feed/position-card";
import { CommentIcon, ShareIcon, SparkIcon } from "@/components/icons";
import { LikeButton } from "@/components/feed/like-button";
import { PostText, TradeCards } from "@/components/feed/trade-card";
import { Avatar, StatusChip, TagRow } from "@/components/primitives";
import type { Thesis } from "@/lib/display-types";

/**
 * One post in the feed, shaped like the mockup's `.post`
 * (docs/mockups/thesis-fun-mockup.html): avatar, one line of byline, the body
 * as something a person said, then whatever the post is attached to, then the
 * three social actions. Owner 2026-09-05: a thesis is a post, so there is no
 * trade button here — trading is on the market page. Three states:
 *   text only  — headline, rationale, like / comment / share;
 *   tagged     — plus the market chip and, when named, the structure chip;
 *   backed     — plus the verified badge and the creator's live position card.
 *
 * Independently of all three, a `/p/<uuid>` link in the rationale unfurls into
 * a compact trade card: a post and a trade are separate things and a link is
 * what connects them (owner 2026-09-05).
 *
 * DIVERGENCES from the mockup, reported: (1) the mockup wraps headline AND
 * rationale in one link to the thread; the rationale can contain its own
 * `/p/<uuid>` links and an `<a>` inside an `<a>` is not parseable, so only the
 * headline is the link. (2) The status chip stays in the byline — the mockup
 * moves lifecycle into the trade card, but an unbacked post has no card and
 * would silently lose its countdown.
 */
export function CalloutPost({ thesis, signedIn = false, databaseMode = false }: { thesis: Thesis; signedIn?: boolean; databaseMode?: boolean }) {
	return (
		<article className="post" aria-labelledby={`post-${thesis.slug}`}>
			<Link href={`/u/${thesis.creator.handle}`} aria-label={thesis.creator.displayName}>
				<Avatar initials={thesis.creator.initials} size={40} />
			</Link>
			<div className="post-main">
				<div className="p-head">
					<Link className="p-name" href={`/u/${thesis.creator.handle}`}>
						{thesis.creator.displayName}
					</Link>
					<span className="p-handle">@{thesis.creator.handle}</span>
					<span className="p-time">{thesis.postedLabel}</span>
					{thesis.status && thesis.statusLabel ? (
						<StatusChip status={thesis.status} label={thesis.statusLabel} />
					) : null}
				</div>
				<p className="p-body" id={`post-${thesis.slug}`}>
					<Link href={`/t/${thesis.slug}`}>{thesis.headline}</Link>
					{thesis.note ? (
						<PostText as="span" className="second" text={thesis.note} tokens={thesis.noteTokens} />
					) : null}
				</p>
				{/* A `/p/<uuid>` link in the text unfurls here, X-style. The link
				    above stays clickable; a link whose position did not resolve
				    simply has no card (owner: no error state). */}
				<TradeCards cards={thesis.tradeCards} />
				{thesis.backing ? (
					<PositionCard
						asset={thesis.asset}
						structure={thesis.structure}
						backing={thesis.backing}
					/>
				) : null}
				<TagRow tag={thesis.tag} backed={thesis.backing !== null} />
				<div className="p-acts">
					<LikeButton thesisId={thesis.id} signedIn={signedIn} databaseMode={databaseMode} likes={thesis.likes} liked={thesis.likedByViewer} />
					<Link
						className="act"
						href={`/t/${thesis.slug}`}
						aria-label={`Comments, ${thesis.commentCount}`}
					>
						<CommentIcon />
						<span className="num">{thesis.commentCount}</span>
					</Link>
					<button className="act" type="button">
						<ShareIcon />
						Share
					</button>
					{/* Kept from the previous round: the AI lane owns what it does. */}
					<button className="act" type="button">
						<SparkIcon />
						Explain
					</button>
				</div>
			</div>
		</article>
	);
}
