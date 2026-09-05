import { Avatar } from "@/components/primitives";
import type { ActivityItem } from "@/lib/display-types";

export function ActivityList({
	items,
	count,
}: {
	items: ActivityItem[];
	count: number;
}) {
	return (
		<div className="sec">
			<div className="sec-h">
				<span className="lbl">Activity</span>
				<span className="mono dim" style={{ fontSize: "11px" }}>
					{count}
				</span>
			</div>
			<div className="lb">
				{items.map((a) => (
					<div
						className="row activity-row"
						key={a.id ?? a.tx.label}
					>
						<Avatar initials={a.creator.initials} size="s" />
						<span className="who">
							<span className="n">
								{a.creator.displayName} {a.action}
								{a.side ? (
									<>
										{" "}
										<span className={a.side}>
											{a.side === "bull" ? "Bull" : "Bear"}
										</span>
									</>
								) : null}
							</span>
							<span className="h">{a.detail}</span>
						</span>
						{!a.offchain ? <a className="tx" href={a.tx.href}>
							{a.tx.label}
						</a> : null}
					</div>
				))}
			</div>
		</div>
	);
}
