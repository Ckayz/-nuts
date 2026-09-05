"use client";

import { useId, useState, type ReactNode } from "react";
import { TabHeading, TabPanel } from "@/components/feed/tabs";

const LABELS = ["About", "Agent", "Positions"] as const;

/**
 * The market page's right column, below the ticket: one card, three tabs.
 *
 * The TICKET IS NOT IN HERE. It stays above this card and always visible: it is
 * the money path, and a tab is a place to hide things. `PageFrame`'s
 * `ticket-first` ordering (styles/market.css, pinned by
 * `components/shell/page-frame.test.tsx`) also needs `.ticket` to remain a
 * direct child of `.col-right > .sticky`, which it is.
 *
 * ALL THREE PANELS STAY MOUNTED. `AgentChat` holds the whole conversation in
 * local `useChat` state, so unmounting the Agent tab would throw away the chat
 * every time somebody looked at their positions. The inactive panels are hidden
 * with the `hidden` attribute (`index.css` sets `[hidden]{display:none!important}`),
 * never by conditional rendering.
 *
 * The agent's wrapper keeps the `agent-inline` class for the same reason it
 * carried it before this card existed: `styles/agent.css`'s
 * `body:has(.agent-inline) .agent-fab{display:none}` is what stops the floating
 * launcher appearing beside an inline chat, giving one conversation two entry
 * points. `:has()` matches a display:none element, so hiding the tab does not
 * bring the launcher back.
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
		<section className="card mkt-tabcard">
			<div className="card-h mkt-tabcard-h">
				<TabHeading id={id} labels={LABELS} selected={tab} onSelect={setTab} />
			</div>
			<TabPanel id={id} selected={tab}>
				<div className="mkt-tabbody" hidden={tab !== 0}>
					{about}
				</div>
				<div className="mkt-tabbody agent-inline" hidden={tab !== 1}>
					{agent}
				</div>
				<div className="mkt-tabbody" hidden={tab !== 2}>
					{positions}
				</div>
			</TabPanel>
		</section>
	);
}
