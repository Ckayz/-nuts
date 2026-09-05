"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The horizontal nav under the top bar: Feed · Markets · Leaderboard ·
 * Portfolio, with the accent underline on the current page
 * (docs/mockups/thesis-fun-mockup.html, `.nav`).
 *
 * M3 (user-flow re-walk 2026-09-06). Markets opens ONE market, never a
 * hardcoded asset, which matches the mockup: its nav's "Markets" button is
 * `data-go="market"` and that view is a single asset page, `/m/btc`
 * (docs/mockups/thesis-fun-mockup.html line 417; the view itself is line 741).
 * There is no markets index in the mockup and no `/markets` route in the app.
 *
 * WHICH market, owner decision 8 (2026-09-06): the one with the MOST OPEN
 * ORDERS on the live book, ties breaking on the earlier ticker. Before that
 * ruling it was `markets[0]`, and `lib/market/live.ts:172` sorts the book's
 * assets by TICKER ascending, so the shipped rule was "the alphabetically first
 * asset the OptionBook has liquidity for" — AVAX, an accident of that sort.
 *
 * The rule lives in `lib/market/summaries.ts` `busiestMarketSlug`, which carries
 * its own TODO-OWNER: the owner ratified this default over the other candidates
 * (alphabetically first, most traded, last visited, or a markets index route),
 * and the ranking is `lib/farcaster/assets.ts` `rankAssets`, reused so the rail
 * and this item cannot disagree about which market is busiest.
 *
 * TODO-OWNER: there is no `/leaderboard` route. The top-traders card on the
 * feed IS the leaderboard today, so the item is a real in-page anchor to it —
 * `/#top-traders`, matching the `id` on the feed's left card, which carries
 * `tabIndex={-1}` so a keyboard user's focus lands on the card and not only the
 * scroll position. The owner decides whether Leaderboard gets its own page.
 *
 * DIVERGENCE from the mockup: its nav ends with mockup-only view switchers
 * (Thread / Compose). The icon rail this replaces carried the only route to
 * `/new`, so the Create button takes that slot — without it the composer would
 * be unreachable.
 */
export function Nav({ marketSlug, unavailable = false }: { marketSlug?: string; unavailable?: boolean }) {
	const pathname = usePathname();
	// TODO-OWNER: markets-unavailable navigation copy.
	return (
		<nav className="nav" aria-label="Primary">
			<Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
				Feed
			</Link>
			{marketSlug ? (
				<Link
					href={`/m/${marketSlug}`}
					aria-current={pathname.startsWith("/m/") ? "page" : undefined}
				>
					Markets
				</Link>
			) : unavailable ? <span className="mut">Markets unavailable</span> : null}
			<Link href={{ pathname: "/", hash: "top-traders" }}>Leaderboard</Link>
			<Link href="/portfolio" aria-current={pathname === "/portfolio" ? "page" : undefined}>
				Portfolio
			</Link>
			<Link href="/agent" aria-current={pathname.startsWith("/agent") ? "page" : undefined}>
				Agent
			</Link>
			<span className="spacer" />
			<Link href="/new" className="btn acc">
				Create
			</Link>
		</nav>
	);
}
