import { TodoOwner } from "@/components/primitives";
import { barWidth, splitBar, type SplitBar } from "@/lib/market/split-bar";
import type { MarketBookStats } from "@/lib/market/summaries";
import type { Market } from "@/lib/display-types";

/**
 * "About <asset>" — the About tab of the market page's right column.
 *
 * fomo's own About card is the one idea on their token page that needs no price
 * history (docs/design/FOMO-DIGEST.md, "About-panel pattern worth stealing"):
 * paired proportional bars, green left and red right, over a small key/value
 * list. The bars here are the two splits the OptionBook actually publishes —
 * calls against puts, and the two sides a taker can take — and nothing else,
 * because the book has no trade history to count buys and sells from.
 *
 * COLOUR: CLAUDE.md's design rule is "colour only on money (never bars, labels,
 * names)". The green/red split bar is a deliberate, briefed exception to it —
 * fomo's treatment is the point of the panel — so it is flagged rather than
 * quietly taken.
 * TODO-OWNER: green/red split bars against the "colour on money only" rule, and
 * the two bars' labels.
 *
 * A bar is drawn ONLY when both of its counts are known and their total is
 * non-zero (`lib/market/split-bar.ts`). In mock mode, and whenever the order
 * snapshot cannot be read, `marketBookStats` returns `{}` and the panel is the
 * key/value list alone — the same rule the stat tiles follow, where an absent
 * figure is never rendered as a zero.
 */
export function AboutPanel({
	market,
	book,
}: {
	market: Pick<Market, "asset" | "expiryCount" | "structureCount">;
	book: MarketBookStats;
}) {
	const bars: { key: string; left: string; right: string; bar: SplitBar }[] = [];
	const calls = splitBar(book.calls, book.puts);
	if (calls !== null) {
		bars.push({ key: "type", left: `${calls.left} calls`, right: `${calls.right} puts`, bar: calls });
	}
	const sides = splitBar(book.buys, book.sells);
	if (sides !== null) {
		bars.push({ key: "side", left: `${sides.left} to buy`, right: `${sides.right} to sell`, bar: sides });
	}

	return (
		<>
			{bars.length > 0 ? (
				<div className="sbars">
					{bars.map((row) => (
						<div className="sbar-row" key={row.key}>
							<span className="sbar-k">
								<b className="num">{row.left}</b>
								<i className="num">{row.right}</i>
							</span>
							{/* Presentation only: the same two counts are printed above in
							    words, so a screen reader is told the split without having to
							    read a bar. */}
							<span className="sbar" aria-hidden="true">
								<span className="sbar-l" style={{ width: barWidth(row.bar.leftPct) }} />
								<span className="sbar-r" style={{ width: barWidth(row.bar.rightPct) }} />
							</span>
						</div>
					))}
					<p className="sbar-note">
						Live orders resting on the OptionBook, not trades. Sides are the
						TAKER&apos;s. <TodoOwner />
					</p>
				</div>
			) : null}
			<dl className="kv">
				<div>
					<dt className="k">Venue</dt>
					<dd className="v">Thetanuts OptionBook</dd>
				</div>
				<div>
					<dt className="k">Network</dt>
					<dd className="v">Base · 8453</dd>
				</div>
				<div>
					<dt className="k">Expiries</dt>
					<dd className="v num">{market.expiryCount}</dd>
				</div>
				<div>
					<dt className="k">Structures</dt>
					<dd className="v num">{market.structureCount}</dd>
				</div>
				<div>
					<dt className="k">Settlement</dt>
					<dd className="v">Thetanuts TWAP</dd>
				</div>
			</dl>
		</>
	);
}
