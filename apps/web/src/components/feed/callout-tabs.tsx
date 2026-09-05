"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { RankedTheses } from "@/lib/page-data";
import { TodoOwner } from "@/components/primitives";
import { CalloutPost } from "./callout-post";
import { feedEmptyState } from "./empty-state";
import { NewCalloutsBar } from "./new-callouts-bar";
import { TabHeading, TabPanel } from "./tabs";

const AUDIENCE = ["All", "Following", "Top"] as const;
const RANKING = ["Trending", "Ending", "Settled"] as const;

/**
 * The centre column of the feed (docs/mockups/thesis-fun-mockup.html, `#feed`):
 * the audience tabs on the left, the ranking pills on the right, and ONE post
 * list under both.
 *
 * Round-1 fold item 4. The mockup draws Trending / Ending / Settled as filters
 * over the post feed, and they now are: the pills pick which ranking read
 * supplies the posts (`lib/data/reads.ts` `trending` / `endingSoon` / `settled`,
 * whose membership and order are `lib/social/ranking.ts`'s and carry their own
 * `TODO-OWNER`), and the tabs pick the audience:
 *
 *   All        the ranking read itself — that IS the whole feed, ranked;
 *   Following  the SAME ranking read, restricted in SQL to the creators the
 *              viewer follows, so the limit is applied to that audience;
 *   Top        the same, over the Top cohort (TODO-OWNER: that cohort's rule).
 *
 * Nothing here sorts or filters on its own: every order is a read's order.
 *
 * Audience tabs control the one panel; ranking pills are aria-pressed filters.
 */
export function CalloutTabs({ ranked, following, top, signedIn, databaseMode }: {
	ranked: RankedTheses;
	following: RankedTheses;
	top: RankedTheses;
	signedIn: boolean;
	databaseMode: boolean;
}) {
	const [audience, setAudience] = useState(0);
	const [ranking, setRanking] = useState(0);
	const audienceId = useId();
	const rankingId = useId();

	/**
	 * B-P3-1 (Astra lane B, pass 3). ONE list, picked by audience AND ranking —
	 * never an intersection. These two selections used to be applied one after
	 * the other: the ranking picked the GLOBAL top N, then the audience filtered
	 * that N down. Measured with seven eligible posts and a limit of six:
	 *
	 *   READER {"global":["post-0",…,"post-5"],"following":["post-6"]}
	 *   ALL_RENDERED 6      FOLLOWING_RENDERED 0
	 *
	 * The followed author's only post ranked seventh globally, so it was never
	 * in the list the filter ran over. Following + Settled and Top + Settled
	 * were empty for the same shape of reason: the audience readers asked for
	 * open posts only. Each audience now carries its own three ranked lists,
	 * selected and limited together in SQL (`lib/social/feeds.ts`).
	 */
	const audiences = [ranked, following, top];
	const selected = audiences[audience] ?? ranked;
	const posts = [selected.trending, selected.ending, selected.settled][ranking] ?? [];

	return <>
		<div className="feed-head">
			<TabHeading id={audienceId} labels={AUDIENCE} selected={audience} onSelect={setAudience} />
			<TabHeading id={rankingId} labels={RANKING} selected={ranking} onSelect={setRanking} variant="pills" />
		</div>
		{/* TODO-OWNER: unseen-post read is not implemented; no fixture banner in db mode. */}
		{databaseMode ? null : <NewCalloutsBar />}
		<TabPanel id={audienceId} selected={audience}>
			{audience === 1 && databaseMode && !signedIn ? <span className="note">Sign in to see posts from creators you follow. <TodoOwner /></span> : null}
			{/* TODO-OWNER: signed-out Following copy above; Top inherits the trending rule. */}
			{posts.length === 0 ? (
				<FeedEmpty audience={audience} ranking={ranking} />
			) : (
				// `.post-rows`, not `.stack`: fomo divides feed posts with a hairline
				// instead of spacing one card each apart (docs/design/FOMO-DIGEST.md).
				<div className="post-rows">{posts.map(thesis =>
					<CalloutPost key={thesis.slug} thesis={thesis} signedIn={signedIn} databaseMode={databaseMode} />)}</div>
			)}
			<span className="note">Trending, ending and settled rules <TodoOwner /></span>
		</TabPanel>
	</>;
}

/**
 * What a tab with no posts says. Two things, and no third: the reason this list
 * is empty (`empty-state.ts` picks the one that fits the selected tabs) and the
 * one action that changes it. Deliberately NOT a skeleton — nothing is loading,
 * and pretending otherwise would be a lie about the state of the database.
 */
function FeedEmpty({ audience, ranking }: { audience: number; ranking: number }) {
	const { line, action } = feedEmptyState(audience, ranking);
	return (
		<div className="card pad stack" style={{ alignItems: "flex-start" }}>
			<p className="note">{line} <TodoOwner /></p>
			<Link className="btn acc" href="/new">{action}</Link>
		</div>
	);
}
