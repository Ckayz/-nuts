import { Avatar } from "@/components/primitives";
import type { Comment } from "@/lib/display-types";

export function CommentsList({ comments }: { comments: Comment[] }) {
	return (
		<div>
			{comments.map((c) => (
				<div className="cmt" key={`${c.creator.handle}-${c.postedLabel}`}>
					<Avatar initials={c.creator.initials} size="s" />
					<div className="b">
						<span>
							<b>{c.creator.displayName}</b> <span className="m">{c.postedLabel}</span>
						</span>
						<span>{c.body}</span>
					</div>
				</div>
			))}
		</div>
	);
}
