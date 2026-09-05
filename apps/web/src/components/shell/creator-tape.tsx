import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import { topCreators } from "@/lib/view-data";

export function CreatorTape() {
	return (
		<div className="ttape">
			<span className="lbl">Top creators · 1W</span>
			{topCreators.map((c) => (
				<span className="t" key={c.handle}>
					<Avatar initials={c.initials} size="s" />
					<b>@{c.handle}</b>
					<span className={`num ${pnlClass(c.netPnlUsd)}`}>
						{signedUsd(c.netPnlUsd)}
					</span>
				</span>
			))}
		</div>
	);
}
