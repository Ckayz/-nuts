/** Number formatting for the Thesis.fun UI. Every rendered form is one the mockup uses. */

const MINUS = "−";

function group(n: number): string {
	return Math.abs(n).toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	});
}

/** "$1,000" — unsigned dollars, whole units. */
export function usd(n: number): string {
	return `$${group(n)}`;
}

/** "$250.00" — unsigned dollars, two decimals. */
export function usd2(n: number): string {
	return `$${Math.abs(n).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** "+$612" / "−$38" / "$0" — signed dollars, as the mockup renders P&L. */
export function signedUsd(n: number): string {
	if (n === 0) return "$0";
	return `${n > 0 ? "+" : MINUS}$${group(n)}`;
}

/** "bull" | "bear" | "" — the colour class the mockup gives a P&L number. */
export function pnlClass(n: number): string {
	if (n > 0) return "bull";
	if (n < 0) return "bear";
	return "";
}
