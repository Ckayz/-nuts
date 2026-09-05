"use client";
import { useState, useTransition } from "react";
import { addComment } from "@/lib/social/actions";

export function CommentForm({ thesisId, signedIn, databaseMode, onMockComment, onPending, initials }: {
	initials?: string; thesisId: string; signedIn: boolean; databaseMode: boolean; onMockComment: (body: string) => void; onPending: (body: string) => void;
}) {
	const [body, setBody] = useState("");
	const [pending, startTransition] = useTransition();
	const disabled = databaseMode && !signedIn;
	// TODO-OWNER: minimal comment form copy and maximum content length.
	return <form className="comment-form" onSubmit={event => {
		event.preventDefault();
		if (disabled || pending || !body.trim()) return;
		if (!databaseMode) { onMockComment(body.trim()); setBody(""); return; }
		startTransition(async () => {
			onPending(body.trim());
			try {
				const result = await addComment(thesisId, body);
				if (!("error" in result)) setBody("");
			} catch { /* Preserve the draft for a deliberate retry. */ }
		});
	}}>
		<span className="av av-34 av-asset" aria-hidden="true">{initials ?? "?"}</span>
		<textarea rows={1} placeholder="Add a comment" aria-label="Comment" value={body} onChange={event => setBody(event.target.value)} disabled={disabled || pending} required />
		<button type="submit" className="btn acc" disabled={disabled || pending || !body.trim()} title={disabled ? "Sign in using the wallet control" : undefined}>Comment</button>
	</form>;
}
