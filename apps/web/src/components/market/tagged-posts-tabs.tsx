"use client";
import { useId, useState } from "react";
import { CalloutPost } from "@/components/feed/callout-post";
import { TabHeading } from "@/components/feed/tabs";
import type { Thesis } from "@/lib/display-types";

/**
 * "Theses" — the second tab of the market page's centre table
 * (`market-tabs.tsx`), and before that the mockup's `#market` third card
 * (lines 817-855).
 *
 * The posts sit as hairline-separated rows rather than as their own stacked
 * surfaces, filtered by an All / Backed pair of pills.
 *
 * The pills used to be a hand-rolled `role="tablist"` copied out of
 * `components/feed/tabs.tsx`; it is now that component's `pills` variant, so the
 * repo has ONE tab implementation and not a third copy of the keyboard rules.
 * The visible change from that fold is the semantics of the pills themselves:
 * they are `aria-pressed` filter buttons, exactly as the feed's Trending /
 * Ending / Settled pills are, rather than `role="tab"` with roving focus. That
 * is the shared component's contract for a pill row, and `index.css` already
 * styles `aria-pressed` and `aria-selected` identically.
 *
 * It renders the tab card's CONTENTS, not a card of its own — see the note in
 * `structures-list.tsx`.
 */
export function TaggedPostsTabs({
	posts,
	asset,
	signedIn = false,
	databaseMode = false,
}: {
	posts: Thesis[];
	/** e.g. "BTC". Names the filter row, as the card heading used to. */
	asset?: string;
	signedIn?: boolean;
	databaseMode?: boolean;
}) {
	const id = useId();
	const [filter, setFilter] = useState(0);
	const backed = filter === 1;
	const visible = backed ? posts.filter((post) => post.backingCard != null) : posts;
	return (
		<>
			<div className="tagged-filter">
				<TabHeading
					id={id}
					labels={["All", "Backed"]}
					selected={filter}
					onSelect={setFilter}
					variant="pills"
					label={asset ? `Posts about ${asset}` : "Tagged posts"}
				/>
			</div>
			{/* No nested `role="tabpanel"`: this list already sits inside the centre
			    card's Theses panel (`market-tabs.tsx`), and the pills above it are
			    `aria-pressed` filters, which do not own a panel. */}
			<div className="card-b tagged">
				{visible.length === 0 ? (
					<span className="empty">
						{backed
							? "No post about this market is backed by a position yet."
							: "No post names this market yet."}
					</span>
				) : (
					visible.map((post) => (
						// Round-1 fold item 20: the mockup's market-page post is text plus
						// a "Backed" chip, not the full card the feed draws.
						<CalloutPost
							key={post.slug}
							thesis={post}
							signedIn={signedIn}
							databaseMode={databaseMode}
							compact
						/>
					))
				)}
			</div>
		</>
	);
}
