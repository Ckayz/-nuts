import Link from "next/link";
import { CopyLink } from "@/components/position/copy-link";
import { PnlCard } from "@/components/position/pnl-card";
import type { PositionPage } from "@/lib/display-types";

/**
 * The hero of `/p/[id]`: the P&L card, centred, with the two actions the owner
 * asked for under it — copy the link, and write a post about it.
 *
 * TODO-OWNER: the card's width. 560px is chosen to sit inside the mockup's
 * centre column (`.work` gives it `minmax(0,1fr)` between a 300px and a 320px
 * rail) and to keep the big figure on one line at 1440px; the owner has not set
 * a number.
 */
export const CARD_MAX_WIDTH = "560px";

export function PositionHero({ page }: { page: PositionPage }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				width: "100%",
				maxWidth: CARD_MAX_WIDTH,
				marginInline: "auto",
			}}
		>
			<PnlCard card={page.card} />
			<div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start" }}>
				<CopyLink />
				{/* The composer reads `?link=` and pre-fills the post with this path,
				    which its own text then unfurls back into this card. */}
				<Link
					className="btn primary"
					href={{ pathname: "/new", query: { link: `/p/${page.card.id}` } }}
				>
					Write a post about it
				</Link>
			</div>
		</div>
	);
}
