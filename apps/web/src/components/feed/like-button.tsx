// TODO-OWNER: "Sign in using the wallet control" hint copy.
"use client";
import { useId, useOptimistic, useState, useTransition } from "react";
import { HeartIcon } from "@/components/icons";
import { toggleLike } from "@/lib/social/actions";

/**
 * m8 (user-flow re-walk 2026-09-06). Measured: a signed-out visitor's Like and
 * Follow controls were `disabled:true` with NO text — `title` is not exposed on
 * a disabled button and is not announced — while the comment box explained
 * itself in words.
 *
 * The same mechanism the comment box already uses (`components/thesis/
 * comment-form.tsx`: `aria-describedby` pointing at a sentence) and the SAME
 * sentence these two controls already carried in `title`. Nothing new is
 * written, and nothing visible is added: the mockup's post actions are three
 * icons in a row and a visible line under each of them would be a design
 * decision, not a fix.
 */
export function LikeButton({ thesisId, likes, liked, signedIn = false, databaseMode = false }: {
	thesisId: string; likes: number; liked: boolean; signedIn?: boolean; databaseMode?: boolean;
}) {
	const hintId = useId();
	const [local, setLocal] = useState({ liked, likes });
	const [pending, startTransition] = useTransition();
	const [state, optimistic] = useOptimistic(databaseMode ? { liked, likes } : local);
	const disabled = pending || (databaseMode && !signedIn);
	const needsSignIn = databaseMode && !signedIn;
	return <>{needsSignIn ? <span id={hintId} className="a11y-hidden">Sign in using the wallet control</span> : null}<button type="button" className={state.liked ? "act on" : "act"}
		aria-pressed={state.liked} aria-label={`Like, ${state.likes}`} disabled={disabled}
		aria-describedby={needsSignIn ? hintId : undefined}
		title={needsSignIn ? "Sign in using the wallet control" : undefined}
		onClick={() => {
			if (disabled) return;
			const next = { liked: !state.liked, likes: state.likes + (state.liked ? -1 : 1) };
			if (!databaseMode) { setLocal(next); return; }
			startTransition(async () => {
				optimistic(next);
				try { await toggleLike(thesisId, next.liked); } catch { /* Roll back to server props. */ }
			});
		}}><HeartIcon filled={state.liked} /><span className="num">{state.likes}</span></button></>;
}
