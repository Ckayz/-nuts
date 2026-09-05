"use client";
import { useId, useRef, useState } from "react";
import { CalloutPost } from "@/components/feed/callout-post";
import type { Thesis } from "@/lib/display-types";

/**
 * "Posts about <asset>" — the mockup's `#market` third card (lines 817-855).
 *
 * The posts sit inside the card as hairline-separated rows rather than as their
 * own stacked surfaces, and the All / Backed filter is a pair of pills in the
 * card header. Tab semantics, roving focus and the arrow keys are unchanged from
 * before the redesign; only the pills' look is new, so both `aria-selected`
 * (the truth for a tab) and the mockup's pill styling are on the same button.
 */
export function TaggedPostsTabs({
	posts,
	asset,
	signedIn = false,
	databaseMode = false,
}: {
	posts: Thesis[];
	/** e.g. "BTC". Names the card, as the mockup does. */
	asset?: string;
	signedIn?: boolean;
	databaseMode?: boolean;
}) {
	const id = useId();
	const [tab, setTab] = useState<"all" | "backed">("all");
	const all = useRef<HTMLButtonElement>(null);
	const backed = useRef<HTMLButtonElement>(null);
	const visible = tab === "all" ? posts : posts.filter((post) => post.backingCard != null);
	return (
		<section className="card">
			<div className="card-h tagged-h">
				<h3>{asset ? `Posts about ${asset}` : "Tagged posts"}</h3>
				<span
					className="x"
					role="tablist"
					aria-label={asset ? `Posts about ${asset}` : "Tagged posts"}
					onKeyDown={(event) => {
						if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
						event.preventDefault();
						const next =
							event.key === "Home"
								? "all"
								: event.key === "End"
									? "backed"
									: tab === "all"
										? "backed"
										: "all";
						setTab(next);
						(next === "all" ? all : backed).current?.focus();
					}}
				>
					{(["all", "backed"] as const).map((value) => (
						<button
							key={value}
							type="button"
							className="pill"
							role="tab"
							ref={value === "all" ? all : backed}
							id={`${id}-${value}`}
							aria-selected={tab === value}
							aria-controls={`${id}-panel`}
							tabIndex={tab === value ? 0 : -1}
							onClick={() => setTab(value)}
						>
							{value === "all" ? "All" : "Backed"}
						</button>
					))}
				</span>
			</div>
			<div
				className="card-b tagged"
				role="tabpanel"
				id={`${id}-panel`}
				aria-labelledby={`${id}-${tab}`}
				tabIndex={0}
			>
				{visible.length === 0 ? (
					<span className="empty">
						{tab === "backed"
							? "No post about this market is backed by a position yet."
							: "No post names this market yet."}
					</span>
				) : (
					visible.map((post) => (
						// Round-1 fold item 20: the mockup's market-page post is text plus
						// a "Backed" chip, not the full card the feed draws.
						<CalloutPost key={post.slug} thesis={post} signedIn={signedIn} databaseMode={databaseMode} compact />
					))
				)}
			</div>
		</section>
	);
}
