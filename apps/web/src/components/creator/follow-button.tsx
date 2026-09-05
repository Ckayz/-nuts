// TODO-OWNER: "Sign in using the wallet control" hint copy.
"use client";

import { useOptimistic, useState, useTransition } from "react";
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
	const [local, setLocal] = useState(following);
	const [pending, startTransition] = useTransition();
	const [state, optimistic] = useOptimistic(databaseMode ? following : local);
	const disabled = pending || (databaseMode && (!signedIn || creatorId === undefined));
	return (
		<button
			type="button"
			className="btn out"
			aria-pressed={state}
			disabled={disabled}
			title={databaseMode && !signedIn ? "Sign in using the wallet control" : undefined}
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
	);
}
