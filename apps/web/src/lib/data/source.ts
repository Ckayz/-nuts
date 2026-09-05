import { env } from "@nuts/env/server";

/**
 * Which read path the pages use. A development switch, not product behaviour.
 *
 *   DATA_SOURCE=mock   (default) — today's typed fixtures, byte-identical output
 *   DATA_SOURCE=db                — the server reads in `./reads`
 *
 * Defaulting to `mock` means nothing visible changes unless the flag is set.
 * Read in exactly one place so no other module reaches for `process.env`.
 */
export type DataSource = "mock" | "db";

/**
 * `next build` runs with NODE_ENV=production while it prerenders the mock
 * pages, and marks that with NEXT_PHASE=phase-production-build (Next's own
 * constant, `next/dist/build/index.js`). The refusal below is a RUNTIME fence
 * for a deployed server, so the build phase is exempt; a production server
 * that serves fixtures still throws at first use.
 */
function inProductionBuildPhase(): boolean {
	return process.env.NEXT_PHASE === "phase-production-build";
}

export function dataSource(): DataSource {
	const source = env.DATA_SOURCE;
	if (env.NODE_ENV === "production" && source !== "db" && !inProductionBuildPhase()) {
		// TODO-OWNER: whether mock production previews should ever be allowed.
		throw new Error("Production requires DATA_SOURCE=db; fixture data cannot be served in production.");
	}
	return source === "db" ? "db" : "mock";
}

export function usingDatabase(): boolean {
	return dataSource() === "db";
}
