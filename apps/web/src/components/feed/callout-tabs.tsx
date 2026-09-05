"use client";

import { useId, useState } from "react";
import type { Thesis } from "@/lib/display-types";
import { Pill, TodoOwner } from "@/components/primitives";
import { CalloutPost } from "./callout-post";
import { NewCalloutsBar } from "./new-callouts-bar";
import { TabHeading, TabPanel } from "./rail-tabs";

export function CalloutTabs({ theses, following, top, signedIn, databaseMode }: {
	theses: Thesis[]; following: Thesis[]; top: Thesis[]; signedIn: boolean; databaseMode: boolean;
}) {
	const [selected, setSelected] = useState(0);
	const id = useId();
	return <>
		<div className="sec-h">
			<TabHeading id={id} labels={["Callouts", "Following", "Top"]} selected={selected} onSelect={setSelected} />
			<div style={{ display: "flex", gap: "6px" }}><Pill on>All</Pill><Pill>BTC</Pill><Pill>ETH</Pill><Pill>SOL</Pill></div>
		</div>
		<NewCalloutsBar />
		<TabPanel id={id} selected={selected}>
			{selected === 1 && databaseMode && !signedIn ? <span className="note">Sign in to see posts from creators you follow. <TodoOwner /></span> : null}
			{/* TODO-OWNER: signed-out Following copy above; Top inherits the trending rule. */}
			<div className="feed">{([theses, following, top][selected] ?? []).map(thesis =>
				<CalloutPost key={thesis.slug} thesis={thesis} signedIn={signedIn} databaseMode={databaseMode} />)}</div>
		</TabPanel>
	</>;
}
