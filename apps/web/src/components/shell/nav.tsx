"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The horizontal nav under the top bar: Feed · Markets · Leaderboard ·
 * Portfolio, with the accent underline on the current page
 * (docs/mockups/thesis-fun-mockup.html, `.nav`).
 *
 * Markets opens the first market the book lists, never a hardcoded asset —
 * carried over from the icon rail this replaces.
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
			<span className="spacer" />
			<Link href="/new" className="btn acc">
				Create
			</Link>
		</nav>
	);
}
