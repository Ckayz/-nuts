import { Avatar } from "@/components/primitives";
import { pnlClass, signedUsd, usd } from "@/lib/format";
import type { Participant } from "@/lib/display-types";

export function ParticipantsTable({ rows }: { rows: Participant[] }) {
	return (
		<div className="tablewrap">
			<table>
				<thead>
					<tr>
						<th>Trader</th>
						<th>Side</th>
						<th className="num">Risked</th>
						<th className="num">Contracts</th>
						<th className="num">Entry</th>
						<th className="num">Live P&amp;L</th>
						<th>Says</th>
						<th>Tx</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={r.tx ? r.tx.label : `${r.creator.handle}-${i}`}>
							<td>
								<span
									style={{ display: "flex", gap: "8px", alignItems: "center" }}
								>
									<Avatar initials={r.creator.initials} size="s" />
									<b>{r.creator.displayName}</b>{" "}
									{r.isCreator ? (
										<span
											className="pill"
											style={{
												fontSize: "9.5px",
												padding: "0 7px",
												color: "var(--tn-acc)",
												borderColor: "var(--tn-acc)",
											}}
										>
											CREATOR
										</span>
									) : null}
								</span>
							</td>
							<td>
								<span className={`side-tag ${r.side}`}>
									{r.side.toUpperCase()}
								</span>
							</td>
							<td className="num">{usd(r.riskedUsd)}</td>
							<td className="num">
								{r.contracts === undefined ? "—" : r.contracts}
							</td>
							<td className="num">
								{r.entryUsd === undefined ? "—" : usd(r.entryUsd)}
							</td>
							<td className={`num ${pnlClass(r.livePnlUsd)}`}>
								{signedUsd(r.livePnlUsd)}
							</td>
							<td className="mut">{r.says}</td>
							<td>
								{r.tx ? (
									<a className="tx" href={r.tx.href}>
										{r.tx.label}
									</a>
								) : (
									"—"
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
