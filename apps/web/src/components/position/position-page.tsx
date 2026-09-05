import Link from "next/link";
import { PositionHero } from "@/components/position/position-hero";
import { FeedRail } from "@/components/shell/feed-rail";
import { PageFrame } from "@/components/shell/page-frame";
import { Avatar } from "@/components/primitives";
import type { PositionPage as PositionPageView, Thesis } from "@/lib/display-types";
import "@/styles/position.css";

/**
 * `/p/[id]` — the mockup's `#position` view (lines 930-1001).
 *
 * Three columns: the shell's feed rail on the left, the share card and its
 * details in the centre, "Trade the same structure" and the owner beside it. A
 * position is its own thing (owner 2026-09-05: "trade is just trade"), so the
 * page describes one fill and links outward — to its owner, to the post it backs
 * when it backs one, and to the market it was traded on.
 *
 * No price chart, here or anywhere: Thetanuts publishes a spot price and no
 * history.
 */
export function PositionPage({ page, rail }: { page: PositionPageView; rail: Thesis[] }) {
	const owner = page.card.owner;
	// Only the rows this owner actually has. A profile with no measured win rate
	// shows fewer rows, never a "—" that reads like a zero.
	const ownerRows: { label: string; value: string; tone?: string }[] = [];
	if (owner.verifiedPnl30dUsd)
		ownerRows.push({
			label: "Verified P&L 30d",
			value: owner.verifiedPnl30dUsd.signed,
			tone: owner.verifiedPnl30dUsd.pnlClass,
		});
	if (owner.winRatePct !== undefined) ownerRows.push({ label: "Win rate", value: `${owner.winRatePct}%` });
	if (owner.thesesCount !== undefined) ownerRows.push({ label: "Theses", value: String(owner.thesesCount) });
	if (owner.followers !== undefined) ownerRows.push({ label: "Followers", value: owner.followers });
	if (owner.biggestLossUsd)
		ownerRows.push({ label: "Biggest loss", value: owner.biggestLossUsd.signed, tone: owner.biggestLossUsd.pnlClass });

	return (
		<PageFrame
			left={<FeedRail posts={rail} />}
			right={
				<>
				{page.marketSlug ? (
					<section className="card pad pos-panel">
						<h3 style={{ fontSize: "15px" }}>Trade the same structure</h3>
						<p className="sub num">{page.card.instrumentLabel}</p>
						<Link
							className="btn acc block"
							style={{ marginTop: "14px" }}
							href={
								page.structureId
									? {
											pathname: `/m/${page.marketSlug}`,
											query: { structure: page.structureId },
										}
									: `/m/${page.marketSlug}`
							}
						>
							Open the {page.card.asset ?? page.marketSlug.toUpperCase()} market
						</Link>
						{/*
						 * I-1 (owner 2026-09-06, decision 1). This line used to read
						 * "Bull buys the structure, Bear sells it." — the ticket's old
						 * shorthand. It became FALSE the moment Bull started naming the
						 * ASSET's direction: measured on this very page, the tab title
						 * says "Bear · ETH put" for a BOUGHT put while the sentence a
						 * card away still said Bull buys it
						 * (.research/thetanuts/ui-fold-shots/final-fold-I1-position.png).
						 * Which word each side earns depends on the instrument, and this
						 * panel has no quote to resolve it from, so it names the two
						 * TAKER actions, which are true for every structure.
						 * TODO-OWNER: the wording.
						 */}
						<p className="fine">
							{page.structureId
								? "The market page carries both sides of this structure, buying it and selling it, and opens with this one selected if the book still has it."
								: "The market page carries both sides of this structure, buying it and selling it. This option has expired, so it opens on the live book instead."}
						</p>
					</section>
				) : null}

				<section className="card pad pos-panel">
					<h3 style={{ fontSize: "15px" }}>
						{page.thesis ? "The post this backs" : "No post yet"}
					</h3>
					{page.thesis ? (
						<><p className="fine">{page.thesis.headline}</p>
						{/* TODO-OWNER: backing-post link label. */}
						<Link
							className="btn sec block"
							style={{ marginTop: "12px" }}
							href={`/t/${page.thesis.slug}`}
						>
							Open post
						</Link></>
					) : (
						<p className="fine">
							This trade belongs to no post. Its owner can write one and link this card into it.
						</p>
					)}
				</section>

				<section className="card">
					<div className="card-h">
						<h3>{owner.displayName}</h3>
					</div>
					<div className="card-b" style={{ padding: "0 20px 16px" }}>
						<Link className="row owner-row" href={`/u/${page.ownerHandle}`}>
							<Avatar seed={owner.avatarSeed} initials={owner.initials} size={40} />
							<span className="t">
								<b>{owner.displayName}</b>
								<i className="num">
									{[owner.walletAddress, owner.sinceLabel].filter(Boolean).join(" · ") ||
										`@${owner.handle}`}
								</i>
							</span>
						</Link>
						{ownerRows.length > 0 ? (
							<dl className="kv" style={{ marginTop: "6px" }}>
								{ownerRows.map((row) => (
									<div key={row.label}>
										<dt className="k">{row.label}</dt>
										<dd className={`v num ${row.tone ?? ""}`}>{row.value}</dd>
									</div>
								))}
							</dl>
						) : null}
					</div>
					<div className="card-f">
						Every figure from onchain fills and settlements. Losing theses cannot be deleted.
					</div>
				</section>
				</>
			}
		>
				{/* m4: the route's headings were all card titles (`h3`), so `/p/<id>`
				    had no `h1`. The instrument the card already prints is the page's
				    subject, so it becomes the heading — the same words, taken out of
				    the picture rather than added to it. */}
				<h1 className="a11y-hidden">{page.card.instrumentLabel}</h1>
				<PositionHero page={page} />

				<section className="card">
					<div className="card-h">
						<h3>Position details</h3>
						<span className="x">Every figure from the fill and the book</span>
					</div>
					<div className="card-b" style={{ padding: "0 20px 18px" }}>
						<dl className="kv">
							{page.facts.map((fact) => (
								<div key={fact.label}>
									<dt className="k">{fact.label}</dt>
									<dd className="v num">{fact.value}</dd>
								</div>
							))}
						</dl>
					</div>
					<div className="card-f">
						Losing positions cannot be deleted. Every number above is read back from the chain.
					</div>
				</section>
		</PageFrame>
	);
}
