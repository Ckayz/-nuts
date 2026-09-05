/**
 * ONE destination fence, shared by every place in this repo that points a
 * Postgres client at a database it did not itself choose: the two `bun test`
 * preloads (`apps/web/test/setup.ts`, `packages/db/test/setup.ts`),
 * `scripts/verify.ts` and `packages/db/drizzle.config.ts`.
 *
 * Two measured holes closed here (one-shot review 2026-09-06, lane A + Claude's
 * leg; findings A-C1/CL-1 and A-C2):
 *
 *  1. AN ENV FILE COULD SELECT THE DATABASE. Measured 2026-09-06 02:41:
 *     `cd apps/web && env -u DATABASE_URL bun test src/lib/trade/record.integration.test.ts`
 *     → `Ran 32 tests` against whatever `apps/web/.env` named. That suite
 *     `DELETE`s every row in four tables. Two different mechanisms fill the
 *     value, and only one of them was known when the finding was written:
 *     in `packages/db` it is `@nuts/env/load`'s `dotenv.config`, which runs on
 *     the first `import { db } from "@nuts/db"` — AFTER the preload's one-shot
 *     check had already passed on an absent value; in `apps/web` it is BUN
 *     ITSELF, which loads the current directory's `.env` before any preload
 *     module is evaluated, so no ordering fix alone could have caught it
 *     (`env -u DATABASE_URL bun -e '…'` prints the file's value;
 *     `bun --no-env-file -e '…'` prints undefined). Hence both halves below:
 *     the fence runs AFTER the loader, and a file-supplied value is not
 *     treated as a selection.
 *
 *  2. LIST. The refused query parameters lived in four copies that DISAGREED.
 *     The preloads omitted `options`, `port`, `dbname` and `database`, so
 *     `?options=-c%20search_path%3Dother` passed a fence whose whole job is
 *     proving the destination, while `drizzle.config.ts` refused it. The
 *     preloads also compared parameter names case-SENSITIVELY (`?HOST=` slipped
 *     through) where `drizzle.config.ts` lowercased. This module holds the union
 *     and the lowercasing comparison, and all four callers import it.
 *
 * This module deliberately has NO imports: `scripts/verify.ts` lives in the
 * repository root workspace, which does not depend on `@nuts/db`, and imports it
 * by relative path. `fenceTestDatabase` reaches `@nuts/env/load` through a
 * dynamic import for the same reason AND because the ordering fix requires the
 * loader to run at a controlled moment, not at hoisted-import time.
 *
 * What the fence proves, and what it does NOT: it proves the effective
 * destination is a loopback literal and that no query parameter or `PGOPTIONS`
 * value can move it elsewhere. It does NOT prove the database NAME is a
 * throwaway — any database on a loopback host passes. A name allow-list is an
 * owner call and is not implemented here.
 */

/**
 * Query parameters that can move a `pg` connection somewhere other than the
 * authority printed in the URL, or silently relocate unqualified DDL/DML.
 * Compared lower-cased against `URLSearchParams` keys, which are already
 * percent-decoded, so `?%68ost=` and `?HOST=` are both caught.
 */
export const DESTINATION_OVERRIDE_PARAMETERS = [
	"host",
	"hostaddr",
	"port",
	"dbname",
	"database",
	"options",
	"connectionstring",
	"service",
	"servicefile",
] as const;

/** Hosts a destructive suite is allowed to run against. */
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

/** The one deliberate escape hatch, for all four callers. */
export const OVERRIDE_VARIABLE = "TEST_DATABASE_OK";

/**
 * `null` when `rawUrl` may be used, otherwise the refusal to print.
 *
 * An unset, empty or whitespace-only URL returns `null`: that is offline mode,
 * which every live suite skips itself on. Callers that require an explicit
 * selection (`scripts/verify.ts`) check for emptiness themselves — this function
 * answers "is this destination safe", not "was one chosen".
 *
 * @param rawUrl     the RESOLVED connection string (after any env-file loading)
 * @param override   `process.env.TEST_DATABASE_OK`; only the exact "1" overrides
 * @param driverOptions `process.env.PGOPTIONS`; `pg` reads it even when the URL
 *   carries no `?options=`, and `-c search_path=…` there relocates every
 *   unqualified statement while the printed target still looks right
 * @param verb       what the caller is about to do, for the message
 */
export function databaseUrlRefusal(
	rawUrl: string | undefined,
	override: string | undefined,
	driverOptions?: string | undefined,
	verb = "run tests",
): string | null {
	const raw = rawUrl?.trim();
	if (!raw) return null;
	if (override === "1") return null;

	const options = driverOptions?.trim();
	if (options) {
		return (
			`Refusing to ${verb}: PGOPTIONS is set ("${options}"). \`pg\` applies it to every connection, so ` +
			`\`-c search_path=…\` there relocates unqualified statements while the destination still looks right. ` +
			`Unset it, or set ${OVERRIDE_VARIABLE}=1 to override deliberately.`
		);
	}

	let host: string;
	try {
		const url = new URL(raw);
		// pg copies query parameters before the authority; never trust that
		// authority when a destination override is present (even an empty one).
		// Keys are reported as WRITTEN so the message names what the operator typed.
		for (const name of url.searchParams.keys()) {
			if ((DESTINATION_OVERRIDE_PARAMETERS as readonly string[]).includes(name.toLowerCase())) {
				return (
					`Refusing DATABASE_URL query parameter "${name}": it can override the destination host, port, ` +
					`database or search path. Set ${OVERRIDE_VARIABLE}=1 to override deliberately.`
				);
			}
		}
		host = url.hostname;
	} catch {
		return `DATABASE_URL is not a parseable URL, so the caller cannot prove it is local. Set ${OVERRIDE_VARIABLE}=1 to ${verb} anyway.`;
	}
	// `new URL("...://user@[::1]:5432/db").hostname` yields "[::1]"; a bare host
	// yields the literal. Both forms are covered by LOOPBACK_HOSTS.
	if (LOOPBACK_HOSTS.has(host.toLowerCase())) return null;
	return (
		`Refusing to ${verb} against DATABASE_URL host "${host}": the integration suites write and delete rows, ` +
		`so they only run against a loopback throwaway database. Create one ` +
		`(createdb x && cd packages/db && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/x bunx drizzle-kit migrate) ` +
		`or set ${OVERRIDE_VARIABLE}=1 to override deliberately.`
	);
}

/**
 * The `bun test` preload body for both suites. Order is the whole point:
 *
 *  1. run `@nuts/env/load` HERE, so the fence sees the same resolved value the
 *     application modules will see rather than the absent one it used to fence;
 *  2. fence that RESOLVED value — a `.env` pointing at production refuses the
 *     run loudly instead of being silently inherited;
 *  3. decide whether a HUMAN selected this database. A value that only an env
 *     file supplies is not a selection — the same rule `scripts/verify.ts`
 *     fence 1 already applies. When nothing was selected, pin offline by writing
 *     empty strings back, so the live suites' own `if (!databaseUrl) skip` gates
 *     see exactly the value this function fenced.
 *
 * Step 3 cannot be done by reading `process.env` before the loader runs, which
 * is what an earlier version of this fix tried. MEASURED 2026-09-06 in
 * `apps/web`: `env -u DATABASE_URL bun -e 'console.log(process.env.DATABASE_URL)'`
 * prints the env FILE's value, and `bun --no-env-file` prints undefined — BUN
 * loads the current directory's `.env` into the process environment before any
 * preload module is evaluated. (`@nuts/env/load` is the mechanism only for
 * `packages/db`, whose directory has no `.env`.) So the question "did a human
 * pass this?" is answered by reading the env files back and comparing:
 * `envFileValues()` in `packages/env/src/load.ts`. The one false "explicit" this
 * can produce — an operator who exports a value byte-identical to the env file's
 * — still has to pass the loopback fence above.
 *
 * Step 3 also sets `SKIP_ENV_VALIDATION` when the operator has not, because
 * `DATABASE_URL` is a required key in `@nuts/env/server` and
 * `emptyStringAsUndefined` turns "" into a validation failure (measured: 19 fail
 * / 2 errors without it) — exactly the pair `scripts/verify.ts` already forces
 * into its offline children. `bun test` runs with `NODE_ENV=test` (measured),
 * and the bypass is ignored in production, so this cannot weaken a build.
 */
export async function fenceTestDatabase(): Promise<void> {
	const { envFileValues } = await import("@nuts/env/load");

	const resolved = process.env.DATABASE_URL;
	const refusal = databaseUrlRefusal(resolved, process.env[OVERRIDE_VARIABLE], process.env.PGOPTIONS);
	if (refusal !== null) {
		console.error(refusal);
		process.exit(1);
	}

	const fromFiles = envFileValues().DATABASE_URL;
	const selectedByHand = resolved !== undefined && resolved.trim() !== "" && resolved !== fromFiles;
	if (selectedByHand) return;

	if (resolved !== undefined && resolved.trim() !== "") {
		console.error(
			"No DATABASE_URL was passed to this run, so the env file's value is IGNORED and the live suites skip. " +
				"Pass DATABASE_URL=<migrated loopback throwaway> to run them.",
		);
	}
	process.env.DATABASE_URL = "";
	process.env.DIRECT_DATABASE_URL = "";
	process.env.SKIP_ENV_VALIDATION ??= "1";
}
