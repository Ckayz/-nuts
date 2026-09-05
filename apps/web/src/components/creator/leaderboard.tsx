import Link from "next/link";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import type { Creator } from "@/lib/display-types";

/**
 * The feed's left rail: the traders to follow, ranked, with their window P&L in
 * money colour (docs/mockups/thesis-fun-mockup.html, `#tpl-traders`).
 *
 * DIVERGENCE, reported: the mockup puts a Follow button on every row. There is
 * none here because the feed read carries no per-creator follow state — a
 * button that always says "Follow" would state something false about people the
 * viewer already follows, and the wired control lives on the profile the row
 * links to. Wiring it needs `following` per creator from `lib/page-data.ts`,
 * outside this round's fence.
 */
export function Leaderboard({ creators }: { creators: Creator[] }) {
	return (
		<div className="card-b">
			{creators.map((c) => (
				<Link className="row" href={`/u/${c.handle}`} key={c.handle}>
					<Avatar initials={c.initials} size={34} />
					<span className="t">
						<b>{c.displayName}</b>
						<i className={`num ${pnlClass(c.netPnlUsd)}`}>{signedUsd(c.netPnlUsd)}</i>
					</span>
				</Link>
			))}
		</div>
	);
}
