/**
 * B-m6 (extension beyond the named file). `apps/web/test/setup.ts` fences the
 * web suite's `DATABASE_URL`; this package's live suites
 * (`schema.integration.test.ts`, `schema.concurrency.test.ts`) had no such
 * fence and they INSERT and DELETE rows. `@nuts/env/load` fills `DATABASE_URL`
 * from `apps/web/.env`, which on the owner's machine held a production
 * Supabase URL, so an unfenced run here is a data-loss bug.
 *
 * The fence itself, the reason its ORDER matters, and the escape hatch all live
 * in one place now — `packages/db/src/test-fence.ts` — because four copies of
 * the refused-parameter list had drifted apart (one-shot review 2026-09-06,
 * A-C1/CL-1 and A-C2). Read that file before changing anything here.
 */
import { databaseUrlRefusal, fenceTestDatabase } from "../src/test-fence";

/** Kept for `database-fence.test.ts`, which pins the refusal messages. */
export function testDatabaseUrlRefusal(rawUrl: string | undefined, override: string | undefined): string | null {
	return databaseUrlRefusal(rawUrl, override);
}

await fenceTestDatabase();
