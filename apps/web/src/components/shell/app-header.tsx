import { SearchIcon } from "@/components/icons";
import { wallet } from "@/mock/data";

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
				<span className="wallet">
					<span className="dot" />
					{wallet.addressLabel}
					<span className="dim">{wallet.network}</span>
				</span>
			</div>
		</header>
	);
}
