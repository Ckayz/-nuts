"use client";

import { useEffect, useState } from "react";
import { readProfileLink } from "@/lib/profile/actions";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	ExploreIcon,
	HomeIcon,
	LeaderboardIcon,
	MarketIcon,
	PlusIcon,
	PortfolioIcon,
	TapeIcon,
} from "@/components/icons";
import { CURRENT_USER_HANDLE, currentUser, marketSummaries } from "@/lib/view-data";

export function IconRail() {
	const pathname = usePathname();
	const router = useRouter();
	const [identity, setIdentity] = useState<Awaited<ReturnType<typeof readProfileLink>> | null>(null);
	useEffect(() => {
		let active = true;
		const refresh = () => { void readProfileLink().then(value => { if (active) setIdentity(value); }).catch(() => { if (active) setIdentity(null); }); };
		refresh();
		window.addEventListener("focus", refresh);
		window.addEventListener("profile-updated", refresh);
		return () => { active = false; window.removeEventListener("focus", refresh); window.removeEventListener("profile-updated", refresh); };
	}, [pathname]);
	const me = identity?.databaseMode === false ? { handle: CURRENT_USER_HANDLE, initials: currentUser.initials } : identity?.profile;

	// The rail opens the first market the book lists; never a hardcoded asset.
	const firstMarket = marketSummaries[0];

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
			{firstMarket ? (
				<Link
					className="navbtn"
					href={`/m/${firstMarket.slug}`}
					title="Markets"
					aria-current={pathname.startsWith("/m/") ? "page" : undefined}
				>
					<MarketIcon />
				</Link>
			) : null}
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
			{me ? <Link className="me" href={`/u/${me.handle}`} onClick={async event => {
				if (identity?.databaseMode === false) return;
				event.preventDefault();
				const latest = await readProfileLink().catch(() => null);
				setIdentity(latest);
				if (latest?.profile) router.push(`/u/${latest.profile.handle}`);
			}}>{me.initials}</Link> : <button className="me" type="button" aria-label="Profile" onClick={async () => {
				const latest = await readProfileLink().catch(() => null);
				setIdentity(latest);
				if (latest?.profile) router.push(`/u/${latest.profile.handle}`);
			}} /> }
		</nav>
	);
}
