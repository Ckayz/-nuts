"use client";
import { useOptimistic, useState } from "react";
import { CommentForm } from "./comment-form";
import type { Creator } from "@/lib/display-types";
import { Avatar } from "@/components/primitives";
import type { Comment } from "@/lib/display-types";

export function CommentsList({ comments, thesisId, signedIn = false, databaseMode = false, mockCreator, viewerSeed, viewerInitials }: { viewerSeed?: string; viewerInitials?: string; comments: Comment[]; thesisId?: string; signedIn?: boolean; databaseMode?: boolean; mockCreator?: Creator }) {
	const [local, setLocal] = useState<Comment[]>([]);
	const [visible, addPending] = useOptimistic([...comments, ...local], (rows, comment: Comment) => [...rows, comment]);
	return (
		<div>
			{thesisId ? <CommentForm viewerSeed={signedIn ? viewerSeed : undefined} initials={signedIn ? viewerInitials : "?"} thesisId={thesisId} signedIn={signedIn} databaseMode={databaseMode} onPending={body => { if (mockCreator) addPending({ creator: mockCreator, body, postedLabel: "· 0m" }); }} onMockComment={body => { if (mockCreator) setLocal(rows => [...rows, { creator: mockCreator, body, postedLabel: "· 0m" }]); }} /> : null}
			{visible.map((c, index) => (
				<div className="thread-comment" key={`${c.creator.handle}-${index}`}>
					<Avatar seed={c.creator.avatarSeed} initials={c.creator.initials} size="s" />
					<div className="post-main">
						<span>
							<b>{c.creator.displayName}</b> <span className="p-time">{c.postedLabel}</span>
						</span>
						<span>{c.body}</span>
					</div>
				</div>
			))}

		</div>
	);
}
