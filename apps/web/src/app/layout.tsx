import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "../index.css";
import { marketSummariesData } from "@/lib/market/summaries";
import { Nav } from "@/components/shell/nav";
import { AgentLauncher } from "@/components/agent/agent-launcher";
import { TopBar } from "@/components/shell/top-bar";
import Providers from "@/components/providers";
import { usingDatabase } from "@/lib/data/source";
import { footerSource } from "@/lib/view-data";
import { vercelOrigin } from "@nuts/env/server";

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

/**
 * m7 (user-flow re-walk 2026-09-06). Without `metadataBase` Next resolved every
 * Open Graph image against `http://localhost:<port>` and said so on every
 * render:
 *
 *   ⚠ metadataBase property in metadata export is not set for resolving social
 *     open graph or twitter images, using "http://localhost:3151"
 *
 * The origin is the one the deployment already knows — `vercelOrigin`
 * (`VERCEL_URL`), the same value `lib/site-origin.ts` reads. No host is
 * hardcoded, and off Vercel there is nothing to set, so it stays undefined and
 * relative URLs behave exactly as they did.
 */
const metadataBase = vercelOrigin === undefined ? undefined : (() => {
	try {
		return new URL(vercelOrigin);
	} catch {
		return undefined;
	}
})();

export const metadata: Metadata = {
	...(metadataBase === undefined ? {} : { metadataBase }),
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
					{/* m4: the first focusable thing on every page, visible only when
					    focused, so a keyboard user is not walked through the top bar,
					    the nav and the left rail on every route.
					    TODO-OWNER: "Skip to content" is provisional wording. */}
					<a className="skip-link" href="#main">Skip to content</a>
					<TopBar />
					<Nav marketSlug={markets.navMarketSlug} unavailable={markets.unavailable} />
					<main className="wrap" id="main">{children}</main>
					<AgentLauncher />
					{/* The mockup's footer line, minus its "mockup only". The
					    provenance string is the fixtures' own and is true of them
					    alone, so database mode states only the venue. */}
					<footer className="foot">
						{usingDatabase() ? "Base · Thetanuts OptionBook" : footerSource}
					</footer>
					{/* D-R3-2 (pass 3): the document-level layer every modal portals
					    into. The connect dialog used to render inside the sticky top
					    bar, whose `z-index:30` trapped the scrim's `z-index:60`
					    inside that stacking context, so the agent launcher and its
					    panel (`z-index:38`, document level) painted above the modal
					    and stayed clickable through it. Last child of `<body>`, so
					    the scrim competes in the ROOT stacking context. */}
					<div id="modal-root" />
				</Providers>
			</body>
		</html>
	);
}
