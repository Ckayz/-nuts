import Link from "next/link";
import { WalletBar } from "@/components/auth/wallet-bar";
import { Search } from "./search";
import { usingDatabase } from "@/lib/data/source";

/**
 * The slim top bar: logo, centred search, wallet chip
 * (docs/mockups/thesis-fun-mockup.html, `.top`).
 */
export function TopBar() {
	return (
		<header className="top">
			<Link className="brand" href="/">
				thesis<em>.fun</em>
			</Link>
			<Search />
			<div className="top-r">
				{/* The badge is true only of the fixtures. In database mode the rows
				    are real, so it would be a false claim about the numbers. */}
				{usingDatabase() ? null : <span className="tag-ex">EXAMPLE DATA</span>}
				<WalletBar />
			</div>
		</header>
	);
}
