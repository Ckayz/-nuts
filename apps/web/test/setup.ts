/**
 * Test preload. `server-only` resolves to a module that throws unless the
 * `react-server` export condition is set (verified: server-only@0.0.1
 * index.js throws; exports map sends `react-server` to empty.js). Next sets
 * that condition; `bun test` does not, so the marker is stubbed here instead
 * of removing it from the server modules it guards.
 */
import { plugin } from "bun";

import { databaseUrlRefusal, fenceTestDatabase } from "@nuts/db/test-fence";

plugin({
	name: "server-only-stub",
	setup(build) {
		build.module("server-only", () => ({ exports: {}, loader: "object" }));
	},
});

/**
 * B-m6. The live suites run against whatever `DATABASE_URL` resolves to —
 * including the production Supabase URL that `@nuts/env/load` will happily read
 * out of `apps/web/.env`. Integration tests INSERT and DELETE rows, so pointing
 * them at a shared or remote database is a data-loss bug, not a configuration
 * preference.
 *
 * The fence, the ORDER it must run in relative to `@nuts/env/load`, and the
 * shared list of refused destination-override parameters all live in
 * `packages/db/src/test-fence.ts` — read that file before changing anything
 * here. Both `bun test` preloads and `scripts/verify.ts` now use it, so the four
 * copies that had drifted apart (one-shot review 2026-09-06, A-C1/CL-1 and
 * A-C2) cannot drift again.
 */

/** Kept for `database-fence.test.ts`, which pins the refusal messages. */
export function testDatabaseUrlRefusal(rawUrl: string | undefined, override: string | undefined): string | null {
	return databaseUrlRefusal(rawUrl, override);
}

await fenceTestDatabase();
