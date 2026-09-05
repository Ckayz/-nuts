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
			{entries.map(({ creator, following }) => (
				<div className="row" key={creator.handle}>
					<Avatar seed={creator.avatarSeed} initials={creator.initials} size={34} />
					<span className="t">
						<Link href={`/u/${creator.handle}`}>
							<b>{creator.displayName}</b>
						</Link>
						<i className={`num ${pnlClass(creator.netPnlUsd)}`}>{signedUsd(creator.netPnlUsd)}</i>
					</span>
					<FollowButton
						creatorId={creator.id}
						following={following}
						signedIn={signedIn}
						databaseMode={databaseMode}
					/>
				</div>
			))}
		</div>
	);
}
