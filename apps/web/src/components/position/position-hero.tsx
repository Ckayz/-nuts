import Link from "next/link";
import { CopyLink } from "@/components/position/copy-link";
import { PnlCard } from "@/components/position/pnl-card";
import type { PositionPage } from "@/lib/display-types";

/**
 * The hero of `/p/[id]`: the share card, then the two actions under it —
 * "Copy link" and "Write a post about it" — exactly as the mockup's `#position`
 * view has them (lines 936-941).
 *
 * The card is full width of the centre column; the mockup's own frame does the
 * sizing, so nothing here sets a width.
 */
export function PositionHero({ page }: { page: PositionPage }) {
	return (
		<>
			<PnlCard card={page.card} />
			<div className="pos-acts">
				<CopyLink />
				{/* The composer reads `?link=` and pre-fills the post with this path,
				    which its own text then unfurls back into this card. */}
				<Link
					className="btn acc"
					href={{ pathname: "/new", query: { link: `/p/${page.card.id}` } }}
				>
					Write a post about it
				</Link>
			</div>
		</>
	);
}
