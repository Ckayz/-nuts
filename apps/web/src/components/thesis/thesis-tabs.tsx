"use client";
import { useId, useRef, useState } from "react";
export function ThesisTabs({ participantCount, commentCount, participants, comments, }: {
    participantCount: number;
    commentCount: number;
    participants: React.ReactNode;
    comments: React.ReactNode;
}) {
    const id = useId();
    const partsRef = useRef<HTMLButtonElement>(null);
    const cmtsRef = useRef<HTMLButtonElement>(null);
    const [tab, setTab] = useState<"parts" | "cmts">("parts");
    return (<>
			<div className="tabs" role="tablist" aria-label="Thesis discussion" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                return;
            event.preventDefault();
            const next = event.key === "Home" ? "parts" : event.key === "End" ? "cmts" : tab === "parts" ? "cmts" : "parts";
            setTab(next);
            (next === "parts" ? partsRef : cmtsRef).current?.focus();
        }}>
				<button type="button" role="tab" aria-selected={tab === "parts"} ref={partsRef} id={`${id}-parts-tab`} aria-controls={`${id}-parts-panel`} tabIndex={tab === "parts" ? 0 : -1} onClick={() => setTab("parts")}>
					Participants<span className="count">{participantCount}</span>
				</button>
				<button type="button" role="tab" aria-selected={tab === "cmts"} ref={cmtsRef} id={`${id}-cmts-tab`} aria-controls={`${id}-cmts-panel`} tabIndex={tab === "cmts" ? 0 : -1} onClick={() => setTab("cmts")}>
					Comments<span className="count">{commentCount}</span>
				</button>
			</div>
			{/* Both panels stay mounted and toggle with `hidden`, as the mockup does. */}
			<div role="tabpanel" id={`${id}-parts-panel`} aria-labelledby={`${id}-parts-tab`} tabIndex={0} hidden={tab !== "parts"}>{participants}</div>
			<div role="tabpanel" id={`${id}-cmts-panel`} aria-labelledby={`${id}-cmts-tab`} tabIndex={0} hidden={tab !== "cmts"}>{comments}</div>
		</>);
}
