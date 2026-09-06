"use client";

import { useId, useState, type ReactNode } from "react";
import { TabHeading, TabPanel } from "@/components/feed/tabs";

const LABELS = ["About", "Agent", "Positions"] as const;

/**
 * The market page's right column, below the ticket: one card, three tabs.
 *
 * The TICKET IS NOT IN HERE. It stays above this card and always visible: it is
 * the money path, and a tab is a place to hide things. K-2 made that structural
 * rather than a convention — the ticket is `PageFrame`'s own `ticket` slot
 * (`components/shell/stacked-columns.tsx` builds `.col-ticket`), so this card
 * can never end up above it and the ticket is reached second by the keyboard at
 * every width.
 *
 * ALL THREE PANELS STAY MOUNTED. `AgentChat` holds the whole conversation in
 * local `useChat` state, so unmounting the Agent tab would throw away the chat
 * every time somebody looked at their positions. The inactive panels are hidden
 * with the `hidden` attribute (`index.css` sets `[hidden]{display:none!important}`),
 * never by conditional rendering. `.col-right` is the same wrapper element in
 * every layout band for the same reason: a resize must not remount this card.
 *
 * The agent's wrapper keeps the `agent-inline` class because `styles/market.css`
 * sizes the inline panel with it (`.tab-body.agent-inline`). It is NOT what
 * stops a second, floating chat appearing beside this one — K-2 deleted the
 * `body:has(.agent-inline) .agent-fab{display:none}` rule that used to claim
 * that job, because it could never apply. MEASURED: `AgentLauncher` returns null
 * on `/m/*` and `/agent` (`launcherHiddenOn`, `components/agent/agent-launcher.tsx`),
 * so `.agent-fab` is absent from the DOM on exactly the pages that rule targeted.
 * That early return is what hides the launcher.
 */
export function RightTabs({
	about,
	agent,
	positions,
}: {
	about: ReactNode;
	agent: ReactNode;
	positions: ReactNode;
}) {
	const id = useId();
	const [tab, setTab] = useState(0);
	return (
		<section className="card tabcard">
			<div className="card-h tabs-h">
				<TabHeading
					id={id}
					labels={LABELS}
					selected={tab}
					onSelect={setTab}
					label="About, agent and positions"
				/>
			</div>
			<TabPanel id={id} selected={tab}>
				<div className="tab-body" hidden={tab !== 0}>
					{about}
				</div>
				<div className="tab-body agent-inline" hidden={tab !== 1}>
					{agent}
				</div>
				<div className="tab-body" hidden={tab !== 2}>
					{positions}
				</div>
			</TabPanel>
		</section>
	);
}
