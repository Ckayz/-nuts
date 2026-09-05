// TODO-OWNER: "Sign in using the wallet control" hint copy.
"use client";
import { useOptimistic, useState, useTransition } from "react";
import { HeartIcon } from "@/components/icons";
import { toggleLike } from "@/lib/social/actions";

export function LikeButton({ thesisId, likes, liked, signedIn = false, databaseMode = false }: {
	thesisId: string; likes: number; liked: boolean; signedIn?: boolean; databaseMode?: boolean;
}) {
	const [local, setLocal] = useState({ liked, likes });
	const [pending, startTransition] = useTransition();
	const [state, optimistic] = useOptimistic(databaseMode ? { liked, likes } : local);
	const disabled = pending || (databaseMode && !signedIn);
	return <button type="button" className={state.liked ? "act on" : "act"}
		aria-pressed={state.liked} aria-label={`Like, ${state.likes}`} disabled={disabled}
		title={databaseMode && !signedIn ? "Sign in using the wallet control" : undefined}
		onClick={() => {
			if (disabled) return;
			const next = { liked: !state.liked, likes: state.likes + (state.liked ? -1 : 1) };
			if (!databaseMode) { setLocal(next); return; }
			startTransition(async () => {
				optimistic(next);
				try { await toggleLike(thesisId, next.liked); } catch { /* Roll back to server props. */ }
			});
		}}><HeartIcon filled={state.liked} /><span className="num">{state.likes}</span></button>;
}
