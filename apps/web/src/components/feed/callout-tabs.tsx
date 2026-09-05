"use client";

import { useId, useState, type ReactNode } from "react";
import type { Thesis } from "@/lib/display-types";
import { TodoOwner } from "@/components/primitives";
import { CalloutPost } from "./callout-post";
import { NewCalloutsBar } from "./new-callouts-bar";
import { TabHeading, TabPanel } from "./rail-tabs";

/**
 * The centre column of the feed: the post tabs, the filter pills beside them
 * and the posts themselves (docs/mockups/thesis-fun-mockup.html, `#feed`).
 *
 * `filters` is the mockup's right-hand pill group. It is a slot rather than a
 * fixed child so this component keeps owning only the post selection; the
 * pills own theirs. `.feed-head` wraps a tab panel inside the slot onto its own
 * full-width line, which is how the pills' list lands directly under them.
 *
 * DIVERGENCE, reported: the mockup's first tab reads "All". It stays "Callouts"
 * because `src/lib/social/feeds-tabs.test.tsx:19` asserts that exact word and
 * that file is outside this round's fence. One-word change once allowed.
 */
export function CalloutTabs({ theses, following, top, signedIn, databaseMode, filters }: {
	theses: Thesis[]; following: Thesis[]; top: Thesis[]; signedIn: boolean; databaseMode: boolean;
	filters?: ReactNode;
}) {
	const [selected, setSelected] = useState(0);
	const id = useId();
	return <>
		<div className="feed-head">
			<TabHeading id={id} labels={["Callouts", "Following", "Top"]} selected={selected} onSelect={setSelected} />
			{filters}
		</div>
		<NewCalloutsBar />
		<TabPanel id={id} selected={selected}>
			{selected === 1 && databaseMode && !signedIn ? <span className="note">Sign in to see posts from creators you follow. <TodoOwner /></span> : null}
			{/* TODO-OWNER: signed-out Following copy above; Top inherits the trending rule. */}
			<div className="stack">{([theses, following, top][selected] ?? []).map(thesis =>
				<CalloutPost key={thesis.slug} thesis={thesis} signedIn={signedIn} databaseMode={databaseMode} />)}</div>
		</TabPanel>
	</>;
}
