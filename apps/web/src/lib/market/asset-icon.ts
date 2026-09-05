/**
 * Display lookup for vendored CC0 logos only, never the trading asset list.
 * CLAUDE.md's "Never hardcode an asset list" rule still applies to liquidity:
 * unknown live markets remain tradable and retain their display monogram.
 */
export function assetIconPath(symbol: string): string | null {
	const lower = symbol.toLowerCase();
	switch (lower) {
		case "btc": case "eth": case "sol": case "doge":
		case "xrp": case "bnb": case "paxg": case "avax":
			return `/asset-icons/${lower}.svg`;
		default: return null;
	}
}
