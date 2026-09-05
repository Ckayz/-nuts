import Link from "next/link";
import { PositionCard } from "@/components/feed/position-card";
import {
	CommentIcon,
	HeartIcon,
	ShareIcon,
	SparkIcon,
} from "@/components/icons";
import { Avatar, StatusChip } from "@/components/primitives";
import { usd } from "@/lib/format";
import type { Thesis } from "@/lib/display-types";

export function CalloutPost({ thesis }: { thesis: Thesis }) {
	const settled = thesis.status === "settled";
	return (
		<article className={settled ? "post settled" : "post"}>
			<div className="thread">
				<Avatar initials={thesis.creator.initials} size="lg" />
			</div>
			<div className="bd">
				<div className="who2">
					<b>{thesis.creator.displayName}</b>
					<span className="mono">@{thesis.creator.handle}</span>
					<span>{thesis.postedLabel}</span>
					<StatusChip status={thesis.status} label={thesis.statusLabel} />
				</div>
				<p className="h">
					<Link href={`/t/${thesis.slug}`}>{thesis.headline}</Link>
				</p>
				{thesis.note ? <p className="t">{thesis.note}</p> : null}
				<PositionCard thesis={thesis} />
				<div className="acts">
					<button type="button" aria-label={`Like, ${thesis.likes}`}>
						<HeartIcon />
						{thesis.likes}
					</button>
					<button type="button" aria-label={`Comments, ${thesis.commentCount}`}>
						<CommentIcon />
						{thesis.commentCount}
					</button>
					<button type="button">
						<ShareIcon />
						share
					</button>
					<span className="earn">
						creator earned <b>{usd(thesis.earningsUsd)}</b> from {thesis.fills}{" "}
						fills
					</span>
					<button type="button" className="ai">
						<SparkIcon />
						Explain
					</button>
					{settled ? null : (
						<span className="sides">
							<button type="button" className="b1">
								Bull
							</button>
							<button type="button" className="b2">
								Bear
							</button>
						</span>
					)}
				</div>
			</div>
		</article>
	);
}
