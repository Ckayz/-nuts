import Link from "next/link";
import { WalletBar } from "@/components/auth/wallet-bar";
import { SearchIcon } from "@/components/icons";
import { usingDatabase } from "@/lib/data/source";
import { wallet } from "@/lib/view-data";

/**
 * The slim top bar: logo, centred search, wallet chip
 * (docs/mockups/thesis-fun-mockup.html, `.top`).
 *
 * The search is a static field, not a button: nothing searches yet and a
 * control that does nothing when clicked is worse than one that does not
 * invite the click. It becomes a button the day search exists.
 */
export function TopBar() {
	return (
		<header className="top">
			<Link className="brand" href="/">
				thesis<em>.fun</em>
			</Link>
			<div className="search">
				<SearchIcon style={{ width: "15px", height: "15px" }} />
				Search theses, markets and traders
				<kbd>⌘ K</kbd>
			</div>
			<div className="top-r">
				{/* The badge is true only of the fixtures. In database mode the rows
				    are real, so it would be a false claim about the numbers. */}
				{usingDatabase() ? null : <span className="tag-ex">EXAMPLE DATA</span>}
				{/* The mockup's static `0x7c4a…e10b` chip is the real wallet control;
				    `wallet.network` stays the mockup's "Base" label. */}
				<WalletBar network={wallet.network} />
			</div>
		</header>
	);
}
