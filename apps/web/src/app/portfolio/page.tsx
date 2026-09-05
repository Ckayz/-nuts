import { PositionList } from "@/components/feed/thesis-list";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import { portfolioData } from "@/lib/page-data";
import type { Creator, Participant, Position } from "@/lib/display-types";

/** The connected wallet's own rows, in the shape the positions table takes. */
function toRows(positions: Position[], currentUser: Creator | null): Participant[] {
	if (currentUser === null) return [];
	return positions.map((p) => ({
		creator: currentUser,
		side: p.side,
		riskedUsd: p.riskedUsd,
		contracts: p.contracts,
		entryUsd: p.entryUsd,
		livePnlUsd: p.livePnlUsd,
		says: "—",
		tx: p.tx,
	}));
}

export default async function PortfolioPage() {
	const { openPositions, settledPositions, currentUser } = await portfolioData();
	return (
		<div className="work single">
			<main className="col">
				<div className="sec">
					<div className="sec-h">
						<span className="lbl">Your positions</span>
						<span className="mono dim" style={{ fontSize: "11px" }}>
							{openPositions.length} open
						</span>
					</div>
					<PositionList positions={openPositions} />
				</div>
				<ParticipantsTable rows={toRows(openPositions, currentUser)} />
				{settledPositions.length > 0 ? (
					<>
						<div className="sec">
							<div className="sec-h">
								<span className="lbl">Your positions</span>
								<span className="mono dim" style={{ fontSize: "11px" }}>
									{settledPositions.length} settled
								</span>
							</div>
							<PositionList positions={settledPositions} />
						</div>
						<ParticipantsTable rows={toRows(settledPositions, currentUser)} />
					</>
				) : null}
			</main>
		</div>
	);
}
