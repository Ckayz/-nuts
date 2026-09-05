// TODO-OWNER: "Sign in using the wallet control" hint copy.
"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { toggleFollow } from "@/lib/social/actions";

/**
 * The compact Follow / Following control the mockup puts on every row of the
 * "Follow top traders" rail.
 *
 * Same shape as `components/feed/like-button.tsx`: optimistic in database mode
 * with a silent roll-back to the server's props, local-only in mock mode, and
 * visible-but-disabled for a signed-out visitor with the same "sign in using
 * the wallet control" hint the like button uses. `aria-pressed` carries the
 * state, so the label and the accessible state cannot disagree.
 *
 * m8 (user-flow re-walk 2026-09-06): that hint was a `title` only, which a
 * disabled button does not expose and a screen reader does not announce. It is
 * now also an `aria-describedby` sentence, the mechanism the comment box uses
 * (`components/thesis/comment-form.tsx`), with the same words.
 */
export function FollowButton({
	creatorId,
	following,
	signedIn = false,
	databaseMode = false,
}: {
	/** `users.id`. Absent on a fixture creator, which disables the control. */
	creatorId: string | undefined;
	following: boolean;
	signedIn?: boolean;
	databaseMode?: boolean;
}) {
	const hintId = useId();
	const [local, setLocal] = useState(following);
	const [pending, startTransition] = useTransition();
	const [state, optimistic] = useOptimistic(databaseMode ? following : local);
	const disabled = pending || (databaseMode && (!signedIn || creatorId === undefined));
	const needsSignIn = databaseMode && !signedIn;
	return (
		<>
		{needsSignIn ? <span id={hintId} className="a11y-hidden">Sign in using the wallet control</span> : null}
		<button
			type="button"
			className="btn out"
			aria-pressed={state}
			disabled={disabled}
			aria-describedby={needsSignIn ? hintId : undefined}
			title={needsSignIn ? "Sign in using the wallet control" : undefined}
			onClick={() => {
				if (disabled) return;
				if (!databaseMode) {
					setLocal(!state);
					return;
				}
				startTransition(async () => {
					optimistic(!state);
					try {
						await toggleFollow(creatorId!, !state);
					} catch {
						/* Roll back to server props. */
					}
				});
			}}
		>
			{state ? "Following" : "Follow"}
		</button>
		</>
	);
}
