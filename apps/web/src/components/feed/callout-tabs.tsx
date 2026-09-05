"use client";

import { useId, useState } from "react";
import type { Thesis } from "@/lib/display-types";
import type { RankedTheses } from "@/lib/page-data";
import { TodoOwner } from "@/components/primitives";
import { CalloutPost } from "./callout-post";
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
 *   Following  the posts of creators the viewer follows, kept in the ranking's
 *              order and dropping the ones the ranking excludes;
 *   Top        the same, over the Top cohort.
 *
 * Nothing here sorts or filters on its own: every order is a read's order.
 *
 * ARIA is unchanged — two real tablists with roving tabindex, which the keyboard
 * tests in `lib/social/feeds-tabs.test.tsx` pin attribute by attribute.
 */
export function CalloutTabs({ ranked, following, top, signedIn, databaseMode }: {
	ranked: RankedTheses;
	following: Thesis[];
	top: Thesis[];
	signedIn: boolean;
	databaseMode: boolean;
}) {
	const [audience, setAudience] = useState(0);
	const [ranking, setRanking] = useState(0);
	const audienceId = useId();
	const rankingId = useId();

	const order = [ranked.trending, ranked.ending, ranked.settled][ranking] ?? [];
	const cohort = [null, following, top][audience] ?? null;
	const posts =
		cohort === null ? order : order.filter((post) => cohort.some((row) => row.slug === post.slug));

	return <>
		<div className="feed-head">
			<TabHeading id={audienceId} labels={AUDIENCE} selected={audience} onSelect={setAudience} />
			<TabHeading id={rankingId} labels={RANKING} selected={ranking} onSelect={setRanking} variant="pills" />
		</div>
		<NewCalloutsBar />
		<TabPanel id={audienceId} selected={audience}>
			{audience === 1 && databaseMode && !signedIn ? <span className="note">Sign in to see posts from creators you follow. <TodoOwner /></span> : null}
			{/* TODO-OWNER: signed-out Following copy above; Top inherits the trending rule. */}
			{posts.length === 0 ? (
				<span className="note">Nothing here yet.</span>
			) : (
				<div className="stack">{posts.map(thesis =>
					<CalloutPost key={thesis.slug} thesis={thesis} signedIn={signedIn} databaseMode={databaseMode} />)}</div>
			)}
			<span className="note">Trending, ending and settled rules <TodoOwner /></span>
		</TabPanel>
	</>;
}
