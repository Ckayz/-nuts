import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import { topCreators } from "@/mock/data";

export function CreatorTape() {
	return (
		<div className="ttape">
			<span className="lbl">Top creators · 1W</span>
			{topCreators.map((c) => (
				<span className="t" key={c.handle}>
					<Avatar initials={c.initials} size="s" />
					<b>@{c.handle}</b>
					<span className={`num ${pnlClass(c.netPnlUsd ?? 0)}`}>
						{signedUsd(c.netPnlUsd ?? 0)}
					</span>
				</span>
			))}
		</div>
	);
}
