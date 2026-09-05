import { WalletBar } from "@/components/auth/wallet-bar";
import { SearchIcon } from "@/components/icons";
import { wallet } from "@/lib/view-data";

export function AppHeader() {
	return (
		<header className="hdr">
			<div className="search">
				<SearchIcon />
				<span>Search theses, markets and creators…</span>
				<kbd>⌘ K</kbd>
			</div>
			<div className="r">
				<span className="ex">EXAMPLE DATA</span>
				{/* The mockup's static `0x7c4a…e10b` chip becomes the real wallet
				    control; `wallet.network` stays the mockup's "Base" label. */}
				<WalletBar network={wallet.network} />
			</div>
		</header>
	);
}
