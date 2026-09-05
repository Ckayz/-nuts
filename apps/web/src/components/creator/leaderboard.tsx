import Link from "next/link";
import { FollowButton } from "@/components/creator/follow-button";
import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/page-data";

/**
 * The feed's left rail: the traders to follow, ranked, with their window P&L in
 * money colour and a Follow control on every row
 * (docs/mockups/thesis-fun-mockup.html, `#tpl-traders`).
 *
 * Round-1 fold item 6: the control is real. `discoverData` now reads each
 * creator's follow state for the viewer, so a row the viewer already follows
 * says "Following" instead of stating something false; a signed-out visitor
 * still sees the control and is routed to sign-in, exactly as the like button
 * is.
 *
 * Owner decision 9 (2026-09-06): the money cell is the LIVE figure —
 * `LeaderboardEntry.livePnlUsd`, the same per-row P&L a position row and a
 * linked trade card print, summed over the rows this leaderboard covers. It was
 * the stored-column aggregate, which is `—` for every trader until the indexer
 * has written one (fold-final-D §1). `creator.netPnlUsd` is still what the
 * RANKING is built from and is deliberately not re-based; when neither figure
 * exists the cell stays "—", which claims nothing.
 */
export function Leaderboard({
	entries,
	signedIn,
	databaseMode,
}: {
	entries: LeaderboardEntry[];
	signedIn: boolean;
	databaseMode: boolean;
}) {
	return (
		<div className="card-b">
			{entries.map(({ creator, following, livePnlUsd }) => {
			// Fall back to the stored aggregate rather than to "—": in mock mode
			// there is no live spot at all, and a recorded figure is still true.
			const pnl = livePnlUsd ?? creator.netPnlUsd;
			return (
				<div className="row" key={creator.handle}>
					<Avatar seed={creator.avatarSeed} initials={creator.initials} size={34} />
					<span className="t">
						<Link href={`/u/${creator.handle}`}>
							<b>{creator.displayName}</b>
						</Link>
						<i className={`num ${pnlClass(pnl)}`}>{signedUsd(pnl)}</i>
					</span>
					<FollowButton
						creatorId={creator.id}
						following={following}
						signedIn={signedIn}
						databaseMode={databaseMode}
					/>
				</div>
			);
			})}
		</div>
	);
}
