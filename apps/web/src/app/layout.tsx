import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "../index.css";
import { marketSummariesData } from "@/lib/market/summaries";
import { Nav } from "@/components/shell/nav";
import { TopBar } from "@/components/shell/top-bar";
import Providers from "@/components/providers";
import { usingDatabase } from "@/lib/data/source";
import { footerSource } from "@/lib/view-data";

/**
 * Manrope is the only typeface (docs/mockups/thesis-fun-mockup.html: "Manrope
 * 400/500/600/700/800 … No mono anywhere"). Google serves it as a variable font
 * over wght 200–800, so no `weight` list is passed and every weight the mockup
 * uses is available from one file.
 */
const manrope = Manrope({
	variable: "--font-manrope",
	subsets: ["latin"],
	display: "swap",
});

export const metadata: Metadata = {
	title: "Thesis.fun",
	description: "Put your money where your thesis is.",
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const markets = await marketSummariesData();
	return (
		<html lang="en" className={manrope.variable} suppressHydrationWarning>
			<body>
				<Providers>
					<TopBar />
					<Nav firstMarketSlug={markets.markets[0]?.slug} unavailable={markets.unavailable} />
					<main className="wrap">{children}</main>
					{/* The mockup's footer line, minus its "mockup only". The
					    provenance string is the fixtures' own and is true of them
					    alone, so database mode states only the venue. */}
					<footer className="foot">
						{usingDatabase() ? "Base · Thetanuts OptionBook" : footerSource}
					</footer>
				</Providers>
			</body>
		</html>
	);
}
