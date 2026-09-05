"use client";
import { useId, useState, useTransition } from "react";
import { Avatar } from "@/components/primitives";
import { addComment } from "@/lib/social/actions";

export function CommentForm({ thesisId, signedIn, databaseMode, onMockComment, onPending, initials, viewerSeed }: {
	viewerSeed?: string; initials?: string; thesisId: string; signedIn: boolean; databaseMode: boolean; onMockComment: (body: string) => void; onPending: (body: string) => void;
}) {
	const hintId = useId();
	const [body, setBody] = useState("");
	const [pending, startTransition] = useTransition();
	const disabled = databaseMode && !signedIn;
	// TODO-OWNER: minimal comment form copy and maximum content length.
	return <><form className="comment-form" onSubmit={event => {
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
		<Avatar seed={viewerSeed} initials={initials ?? "?"} size={34} />
		<textarea rows={1} placeholder="Add a comment" aria-label="Comment" aria-describedby={hintId} value={body} onChange={event => setBody(event.target.value)} disabled={disabled || pending} required />
		<button type="submit" className="btn acc" disabled={disabled || pending || !body.trim()} title={disabled ? "Sign in using the wallet control" : undefined}>Comment</button>
	</form>
		{/* TODO-OWNER: sign-in and textarea submission hints. */}
		<p id={hintId} className="mut">{disabled ? "Sign in using the wallet control to comment." : "Enter adds a new line. Use Comment to post."}</p>
	</>;
}
