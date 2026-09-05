import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import type { Creator } from "@/lib/display-types";

export function Leaderboard({ creators }: { creators: Creator[] }) {
	return (
		<div className="lb">
			{creators.map((c, i) => (
				<div className="row" key={c.handle}>
					<span className={i < 3 ? "rank top" : "rank"}>{i + 1}</span>
					<Avatar initials={c.initials} />
					<span className="who">
						<span className="n">{c.displayName}</span>
						{/* The mockup spells "theses" out on rank 1 only (line 226). */}
						<span className="h">
							{c.winRatePct}% · {c.thesesCount}
							{i === 0 ? " theses" : ""}
						</span>
					</span>
					<span className={`num ${pnlClass(c.netPnlUsd)}`}>
						{signedUsd(c.netPnlUsd)}
					</span>
				</div>
			))}
		</div>
	);
}
