import type { Metadata } from "next";
import { Archivo, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "../index.css";
import { AppHeader } from "@/components/shell/app-header";
import { CreatorTape } from "@/components/shell/creator-tape";
import { IconRail } from "@/components/shell/icon-rail";
import { PriceFooter } from "@/components/shell/price-footer";
import Providers from "@/components/providers";

// The mockup requests Bricolage Grotesque as `opsz,wght@12..96,500;600;800`,
// so the optical-size axis must stay variable or the display type renders at
// the font's default opsz (14) instead of tracking font-size.
const display = Bricolage_Grotesque({
	variable: "--font-tn-display",
	subsets: ["latin"],
	axes: ["opsz"],
	display: "swap",
});

const sans = Archivo({
	variable: "--font-tn-sans",
	subsets: ["latin"],
	display: "swap",
});

const mono = JetBrains_Mono({
	variable: "--font-tn-mono",
	subsets: ["latin"],
	display: "swap",
});

export const metadata: Metadata = {
	title: "Thesis.fun",
	description: "Put your money where your thesis is.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="en"
			className={`${display.variable} ${sans.variable} ${mono.variable}`}
			suppressHydrationWarning
		>
			<body>
				<Providers>
					<div className="app">
						<IconRail />
						<AppHeader />
						<CreatorTape />
						{children}
						<PriceFooter />
					</div>
				</Providers>
			</body>
		</html>
	);
}
