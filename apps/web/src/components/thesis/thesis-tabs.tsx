"use client";

import { useState } from "react";

export function ThesisTabs({
	participantCount,
	commentCount,
	participants,
	comments,
}: {
	participantCount: number;
	commentCount: number;
	participants: React.ReactNode;
	comments: React.ReactNode;
}) {
	const [tab, setTab] = useState<"parts" | "cmts">("parts");
	return (
		<>
			<div className="tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "parts"}
					onClick={() => setTab("parts")}
				>
					Participants<span className="count">{participantCount}</span>
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "cmts"}
					onClick={() => setTab("cmts")}
				>
					Comments<span className="count">{commentCount}</span>
				</button>
			</div>
			{/* Both panels stay mounted and toggle with `hidden`, as the mockup does. */}
			<div hidden={tab !== "parts"}>{participants}</div>
			<div hidden={tab !== "cmts"}>{comments}</div>
		</>
	);
}
