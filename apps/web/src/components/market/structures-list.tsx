import Link from "next/link";
import { Pill, TodoOwner } from "@/components/primitives";
import { usd, usd2 } from "@/lib/format";
import type { MarketStructure } from "@/lib/display-types";

/**
 * The live book for one asset: every structure the OptionBook has liquidity
 * for. Selecting a row is what loads the ticket, so this table — not a post —
 * is where a trade starts.
 *
 * In `DATA_SOURCE=mock` the rows are fixtures and Select is inert, exactly as
 * before. Against the live book each Select is a link that reloads the page
 * with that structure quoted, keeping whatever post and side the visitor
 * arrived with.
 */
export function StructuresList({
	rows,
	slug,
	query,
	live,
}: {
	rows: MarketStructure[];
	slug?: string;
	/** Query values to keep when selecting another row, e.g. the post and side. */
	query?: Record<string, string>;
	live?: boolean;
}) {
	return (
		<div className="sec">
			<div className="bookmeta">
				<h2 className="h2">Live structures</h2>
				<span className="note">From OptionBook orders · prices move every block</span>
			</div>
			<div className="tablewrap">
				<table>
					<thead>
						<tr>
							<th>Expiry</th>
							<th>Structure</th>
							<th>Strikes</th>
							<th className="num">Premium / ct</th>
							<th className="num">Max payout</th>
							<th className="num">Liquidity left</th>
							<th>
								<span className="sr-only">Select</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr className={row.selected ? "sel" : undefined} key={row.id}>
								<td className="mono">{row.expiryLabel}</td>
								<td>{row.productType}</td>
								<td className="mono">{row.strikesLabel}</td>
								<td className="num">{usd2(row.premiumPerContractUsd)}</td>
								<td className="num bull">{row.maxPayoutLabel}</td>
								<td className="num">{usd(row.liquidityLeftUsd)}</td>
								<td>
									{row.selected ? (
										<Pill on>Selected</Pill>
									) : live && slug !== undefined ? (
										<Link
											className="btn sm"
											href={{ pathname: `/m/${slug}`, query: { ...query, structure: row.id } }}
										>
											Select
										</Link>
									) : (
										<button type="button" className="btn sm">
											Select
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<span className="note">
				How structures are ordered and which are surfaced first <TodoOwner />
			</span>
		</div>
	);
}
