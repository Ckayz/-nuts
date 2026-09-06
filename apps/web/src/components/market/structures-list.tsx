import Link from "next/link";
import { TodoOwner } from "@/components/primitives";
import { usd, usd2 } from "@/lib/format";
import type { MarketStructure } from "@/lib/display-types";

/**
 * The live book for one asset: every structure the OptionBook has liquidity
 * for. Selecting a row is what loads the ticket, so this table — not a post —
 * is where a trade starts.
 *
 * Layout from the mockup's `#market` "Live structures" card (lines 771-814):
 * seven columns, the three money columns right-aligned, the selected row tinted
 * with the accent at 8% and marked by a 2px accent rule down its left edge. The
 * row is the selection, so it carries `aria-selected`; the button is the control
 * that changes it.
 *
 * It renders the card's CONTENTS, not the card: since the market page's centre
 * column became a tabbed panel (`market-tabs.tsx`, fomo's `Trades | Thesis`
 * table), the frame and the heading belong to the tab card and the table is one
 * of the two things that go inside it. Nesting a second `.card` in there would
 * be an invisible box — both use `--surface` — with a second set of paddings.
 *
 * In `DATA_SOURCE=mock` the rows are fixtures and Select is inert, exactly as
 * before. Against the live book each Select is a link that reloads the page with
 * that structure quoted, keeping whatever post and side the visitor arrived
 * with.
 *
 * C#6 (lane C confirming pass, finding 6): `live` is about THESE ROWS, not
 * about the ticket. The route used to pass `trade !== null`, which is false on
 * exactly the page whose own copy reads "that structure is no longer on the
 * book … pick another one from the list below" — so every recovery link there
 * rendered as a handler-less button.
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
		<>
			<div className="card-b tbl-wrap">
				<table className="tbl">
					<thead>
						<tr>
							<th>Expiry</th>
							<th>Structure</th>
							<th>Strikes</th>
							<th className="r">Premium / ct</th>
							<th className="r">Max payout</th>
							<th className="r">Liquidity left</th>
							<th className="sel-col">
								<span className="sr-only">Select</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr aria-selected={row.selected} key={row.id}>
								<td className="num mut">{row.expiryLabel}</td>
								<td className="struct">{row.productType}</td>
								<td className="num mut strikes">{row.strikesLabel}</td>
								<td className="r num">{usd2(row.premiumPerContractUsd)}</td>
								<td className="r num">{row.maxPayoutLabel}</td>
								<td className="r num">{usd(row.liquidityLeftUsd)}</td>
								<td className="r sel-col">
									{row.selected ? (
										<button type="button" className="sel-btn" aria-pressed="true">
											Selected
										</button>
									) : live && slug !== undefined ? (
										<Link
											className="sel-btn"
											href={{ pathname: `/m/${slug}`, query: { ...query, structure: row.id } }}
										>
											Select
										</Link>
									) : (
										<button type="button" className="sel-btn" aria-pressed="false">
											Select
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="card-f">
				From OptionBook orders · prices move every block. How structures are
				ordered and which of them are surfaced first
				<TodoOwner />
			</div>
		</>
	);
}
