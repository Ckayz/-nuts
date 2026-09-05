import Link from "next/link";
import { PositionCard } from "@/components/feed/position-card";
import { CommentIcon, ShareIcon, SparkIcon } from "@/components/icons";
import { LikeButton } from "@/components/feed/like-button";
import { Avatar, StatusChip, TagRow } from "@/components/primitives";
import type { Thesis } from "@/lib/display-types";

/**
 * One post in the feed. Owner 2026-09-05: a thesis is a post, so there is no
 * trade button here — trading is on the market page. Three states:
 *   text only  — headline, rationale, like / comment / share;
 *   tagged     — plus the market chip and, when named, the structure chip;
 *   backed     — plus the verified badge and the creator's live position card.
 */
export function CalloutPost({ thesis, signedIn = false, databaseMode = false }: { thesis: Thesis; signedIn?: boolean; databaseMode?: boolean }) {
	return (
		<article
			className={thesis.backing?.settled ? "post settled" : "post"}
			aria-labelledby={`post-${thesis.slug}`}
		>
			<div className="thread">
				<Avatar initials={thesis.creator.initials} size="lg" />
			</div>
			<div className="bd">
				<div className="who2">
					<b>{thesis.creator.displayName}</b>
					<span className="mono">@{thesis.creator.handle}</span>
					<span>{thesis.postedLabel}</span>
					{thesis.status && thesis.statusLabel ? (
						<StatusChip status={thesis.status} label={thesis.statusLabel} />
					) : null}
				</div>
				<p className="h" id={`post-${thesis.slug}`}>
					<Link href={`/t/${thesis.slug}`}>{thesis.headline}</Link>
				</p>
				{thesis.note ? <p className="t">{thesis.note}</p> : null}
				<TagRow tag={thesis.tag} backed={thesis.backing !== null} />
				{thesis.backing ? (
					<PositionCard
						asset={thesis.asset}
						structure={thesis.structure}
						backing={thesis.backing}
					/>
				) : null}
				<div className="acts">
					<LikeButton thesisId={thesis.id} signedIn={signedIn} databaseMode={databaseMode} likes={thesis.likes} liked={thesis.likedByViewer} />
					<Link
						href={`/t/${thesis.slug}`}
						aria-label={`Comments, ${thesis.commentCount}`}
					>
						<CommentIcon />
						{thesis.commentCount}
					</Link>
					<button type="button">
						<ShareIcon />
						share
					</button>
					<button type="button" className="ai">
						<SparkIcon />
						Explain
					</button>
				</div>
			</div>
		</article>
	);
}
