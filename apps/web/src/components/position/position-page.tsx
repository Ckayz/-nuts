import Link from "next/link";
import { PositionHero, CARD_MAX_WIDTH } from "@/components/position/position-hero";
import type { PositionPage as PositionPageView } from "@/lib/display-types";

/**
 * `/p/[id]`. A position is its own thing (owner 2026-09-05: "trade is just
 * trade"), so this page describes one fill and links outward: to its owner, to
 * the post it backs when it backs one, and to the market it was traded on.
 *
 * There is no price chart, here or anywhere: Thetanuts publishes a spot price
 * and no history.
 */
export function PositionPage({ page }: { page: PositionPageView }) {
	return (
		<div className="work single">
			<main className="col" style={{ paddingTop: "24px" }}>
				<PositionHero page={page} />

				<section
					className="sec"
					style={{ width: "100%", maxWidth: CARD_MAX_WIDTH, marginInline: "auto" }}
				>
					<div className="sec-h">
						<h2 className="h2">Details</h2>
						<Link className="tx" href={`/u/${page.ownerHandle}`}>
							{page.card.owner.displayName} ↗
						</Link>
					</div>
					<dl
						style={{
							display: "grid",
							gridTemplateColumns: "minmax(0,1fr) auto",
							gap: "0",
							margin: 0,
						}}
					>
						{page.facts.map((fact) => (
							<div
								key={fact.label}
								style={{
									display: "contents",
								}}
							>
								<dt
									className="lbl"
									style={{ padding: "9px 0", borderBottom: "1px solid var(--tn-l)" }}
								>
									{fact.label}
								</dt>
								<dd
									className="mono"
									style={{
										margin: 0,
										padding: "9px 0",
										textAlign: "right",
										borderBottom: "1px solid var(--tn-l)",
									}}
								>
									{fact.value}
								</dd>
							</div>
						))}
					</dl>
				</section>

				<section
					className="sec"
					style={{ width: "100%", maxWidth: CARD_MAX_WIDTH, marginInline: "auto" }}
				>
					{page.thesis ? (
						<div className="panel">
							<h3>The post this backs</h3>
							<Link className="btn block" href={`/t/${page.thesis.slug}`}>
								{page.thesis.headline}
							</Link>
						</div>
					) : (
						<div className="panel">
							<h3>No post yet</h3>
							<span className="note">
								This trade belongs to no post. Its owner can write one and link this
								card into it.
							</span>
						</div>
					)}

					{page.marketSlug ? (
						<div className="panel">
							<h3>Trade the same structure</h3>
							<span className="note">
								{page.structureId
									? "The market page opens with this structure selected, if the book still has it."
									: "This option has expired, so the market page opens on the live book instead."}
							</span>
							<Link
								className="btn primary block"
								href={
									page.structureId
										? {
												pathname: `/m/${page.marketSlug}`,
												query: { structure: page.structureId },
											}
										: `/m/${page.marketSlug}`
								}
							>
								Go to the {page.card.asset ?? page.marketSlug.toUpperCase()} market
							</Link>
						</div>
					) : null}
				</section>
			</main>
		</div>
	);
}
