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
 * WHICH market, measured rather than assumed: `firstMarketSlug` is
 * `marketSummariesData().markets[0].slug`, and `lib/market/live.ts:172` sorts
 * the book's assets by TICKER, ascending. So the rule today is "the
 * alphabetically first asset the OptionBook has liquidity for" — AVAX on the
 * live book of 2026-09-06, which is an accident of the sort, not a choice.
 *
 * TODO-OWNER: which market "Markets" should open — the alphabetically first
 * (today), the deepest book, the most traded, the last one the visitor looked
 * at, or a markets index page of its own. Changing it is a product decision and
 * an index would be a new route, so nothing here picks one.
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
export function Nav({ firstMarketSlug, unavailable = false }: { firstMarketSlug?: string; unavailable?: boolean }) {
	const pathname = usePathname();
	// TODO-OWNER: markets-unavailable navigation copy.
	return (
		<nav className="nav" aria-label="Primary">
			<Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
				Feed
			</Link>
			{firstMarketSlug ? (
				<Link
					href={`/m/${firstMarketSlug}`}
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
