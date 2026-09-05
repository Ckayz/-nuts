import { Bar } from "@/components/primitives";
import type { SideStats } from "@/lib/display-types";

export function SharePanel({
	url,
	headline,
	bull,
	bear,
}: {
	url: string;
	headline: string;
	bull: SideStats;
	bear: SideStats;
}) {
	return (
		<div className="panel">
			<h3>Share</h3>
			<div className="share">
				<div
					className="mono dim"
					style={{ fontSize: "10.5px", marginBottom: "6px" }}
				>
					{url}
				</div>
				<p className="h" style={{ fontSize: "18px" }}>
					{headline}
				</p>
				<div className="sent" style={{ marginTop: "10px" }}>
					<div className="row2" style={{ fontSize: "11px" }}>
						<span className="bull">{bull.pct}% Bull</span>
						<span className="bear">{bear.pct}% Bear</span>
					</div>
					<Bar pct={bull.pct} style={{ height: "8px" }} />
				</div>
			</div>
			<button type="button" className="btn block">
				Copy link
			</button>
		</div>
	);
}
