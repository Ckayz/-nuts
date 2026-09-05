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
 * Production means production for the BUILD too: `next build` runs with
 * NODE_ENV=production and prerenders static pages; a page prerendered from
 * fixtures is later served from the response cache without ever calling this
 * function again (Astra review 2026-09-05: `next/dist/server/response-cache`
 * returns cached HTML without rendering). So a build-phase exemption would let
 * a misconfigured deploy ship fixture HTML. There is none: every production
 * build must set DATA_SOURCE=db. Mock mode is for `next dev` only.
 */
export function dataSource(): DataSource {
	const source = env.DATA_SOURCE;
	if (env.NODE_ENV === "production" && source !== "db") {
		// TODO-OWNER: whether mock production previews should ever be allowed.
		throw new Error("Production requires DATA_SOURCE=db; fixture data cannot be served in production.");
	}
	return source === "db" ? "db" : "mock";
}

export function usingDatabase(): boolean {
	return dataSource() === "db";
}
