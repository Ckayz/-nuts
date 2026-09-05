import Link from "next/link";
import { WalletBar } from "@/components/auth/wallet-bar";
import { Search } from "./search";
import { usingDatabase } from "@/lib/data/source";

/**
 * The slim top bar: logo, centred search, the Create button and the wallet chip
 * (docs/mockups/thesis-fun-mockup.html, `.top`).
 *
 * Owner decision 5 (2026-09-06). "Create" used to sit at the end of the nav,
 * which is `overflow-x:auto`: with six items the row scrolled below ~500px and
 * the button was CLIPPED — fold-final-D reproduced it at 390px, the label cut
 * to "Cr". It is the only route to the composer, so it now lives here, beside
 * the wallet chip, where nothing scrolls and it is visible at every width.
 *
 * The mockup draws no Create control on any width (its nav ends in mockup-only
 * view switchers), so this is a recorded DIVERGENCE, folded back into
 * `docs/mockups/thesis-fun-mockup.html`'s `.top` by this same change.
 *
 * The wallet chip stays the rightmost element, as the mockup has it.
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
				<Link href="/new" className="btn acc top-create">
					Create
				</Link>
				<WalletBar />
			</div>
		</header>
	);
}
