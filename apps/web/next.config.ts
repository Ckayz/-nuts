import "@nuts/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	typedRoutes: true,
	reactCompiler: true,
	// 9(a). The Open Graph routes read the vendored Manrope files from disk
	// (`src/lib/og-fonts.ts`) instead of fetching Google Fonts, so the deployed
	// function has to carry those bytes. Next only traces what it can see, and a
	// `process.cwd()` read is not an import.
	outputFileTracingIncludes: {
		"/t/[slug]/opengraph-image": ["./src/assets/manrope-*.ttf"],
		"/p/[id]/opengraph-image": ["./src/assets/manrope-*.ttf"],
	},
};

export default nextConfig;
