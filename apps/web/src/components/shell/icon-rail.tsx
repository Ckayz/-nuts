"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	ExploreIcon,
	HomeIcon,
	LeaderboardIcon,
	PlusIcon,
	PortfolioIcon,
	TapeIcon,
} from "@/components/icons";
import { CURRENT_USER_HANDLE, currentUser } from "@/lib/view-data";

export function IconRail() {
	const pathname = usePathname();

	return (
		<nav className="nav" aria-label="Primary">
			<span className="logo" aria-hidden="true">
				<i />
			</span>
			<Link
				className="navbtn"
				href="/"
				title="Home"
				aria-current={pathname === "/" ? "page" : undefined}
			>
				<HomeIcon />
			</Link>
			<button type="button" aria-label="Explore theses" title="Explore theses">
				<ExploreIcon />
			</button>
			<button type="button" aria-label="Live tape" title="Live tape">
				<TapeIcon />
			</button>
			<Link
				className="navbtn"
				href="/portfolio"
				title="Portfolio"
				aria-current={pathname === "/portfolio" ? "page" : undefined}
			>
				<PortfolioIcon />
			</Link>
			<button type="button" aria-label="Leaderboard" title="Leaderboard">
				<LeaderboardIcon />
			</button>
			<Link className="navbtn create" href="/new" title="Launch a thesis">
				<PlusIcon />
			</Link>
			<span className="spacer" />
			<Link className="me" href={`/u/${CURRENT_USER_HANDLE}`}>
				{currentUser.initials}
			</Link>
		</nav>
	);
}
