import { PositionList } from "@/components/feed/thesis-list";
import { ParticipantsTable } from "@/components/thesis/participants-table";
import { currentUser, yourPositions, yourSettledPositions } from "@/mock/data";
import type { Participant, Position } from "@/types";

/** The connected wallet's own rows, in the shape the positions table takes. */
function toRows(positions: Position[]): Participant[] {
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

export default function PortfolioPage() {
	return (
		<div className="work" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
			<main className="col">
				<div className="sec">
					<div className="sec-h">
						<span className="lbl">Your positions</span>
						<span className="mono dim" style={{ fontSize: "11px" }}>
							{yourPositions.length} open
						</span>
					</div>
					<PositionList positions={yourPositions} />
				</div>
				<ParticipantsTable rows={toRows(yourPositions)} />
				{yourSettledPositions.length > 0 ? (
					<>
						<div className="sec">
							<div className="sec-h">
								<span className="lbl">Your positions</span>
								<span className="mono dim" style={{ fontSize: "11px" }}>
									{yourSettledPositions.length} settled
								</span>
							</div>
							<PositionList positions={yourSettledPositions} />
						</div>
						<ParticipantsTable rows={toRows(yourSettledPositions)} />
					</>
				) : null}
			</main>
		</div>
	);
}
