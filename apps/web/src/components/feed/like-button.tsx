"use client";

import { useState } from "react";
import { HeartIcon } from "@/components/icons";

/**
 * Like control. Owner 2026-09-05: "allowing users to like that particular
 * thesis also". Nothing is persisted yet — there is no wallet session and no
 * write path — so the count moves optimistically from the fixture value and
 * resets on reload.
 */
export function LikeButton({ likes, liked }: { likes: number; liked: boolean }) {
	const [on, setOn] = useState(liked);
	const count = likes + (on === liked ? 0 : on ? 1 : -1);
	return (
		<button
			type="button"
			className={on ? "liked" : undefined}
			aria-pressed={on}
			aria-label={`Like, ${count}`}
			onClick={() => setOn(!on)}
		>
			<HeartIcon filled={on} />
			{count}
		</button>
	);
}
