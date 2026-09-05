// TODO-OWNER: "Sign in using the wallet control" hint copy.
"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { useConnectedIdentity } from "@/components/auth/connected-identity";
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
 *
 * B-R2 (lane B pass 2): the same disabled state also covers a wallet connected
 * as somebody else while the server session still says otherwise, and the call
 * carries the connected wallet so the server refuses it too.
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
	// B-R2: an unresolved identity (wallet B, server session still A because the
	// mismatch sign-out failed) is treated exactly as signed out — the follow
	// would otherwise land as the account the person left.
	const identity = useConnectedIdentity();
	const disabled = pending || (databaseMode && (!signedIn || identity.mismatched || creatorId === undefined));
	const needsSignIn = databaseMode && (!signedIn || identity.mismatched);
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
						await toggleFollow(creatorId!, !state, identity.address ?? undefined);
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
