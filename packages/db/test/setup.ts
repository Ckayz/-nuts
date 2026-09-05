/**
 * B-m6 (extension beyond the named file). `apps/web/test/setup.ts` fences the
 * web suite's `DATABASE_URL`; this package's live suites
 * (`schema.integration.test.ts`, `schema.concurrency.test.ts`) had no such
 * fence and they INSERT and DELETE rows. `@nuts/env/load` fills `DATABASE_URL`
 * from `apps/web/.env`, which on the owner's machine holds a production
 * Supabase URL, so an unfenced run here is a data-loss bug.
 *
 * Positive identity: the host must be a loopback literal. Anything else refuses
 * the run unless the operator sets `TEST_DATABASE_OK=1`. An unset or empty URL
 * is the offline mode the integration files already skip on.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

export function testDatabaseUrlRefusal(rawUrl: string | undefined, override: string | undefined): string | null {
	const raw = rawUrl?.trim();
	if (!raw) return null;
	if (override === "1") return null;
	let host: string;
	try {
		host = new URL(raw).hostname;
	} catch {
		return "DATABASE_URL is not a parseable URL, so the test suite cannot prove it is local. Set TEST_DATABASE_OK=1 to run anyway.";
	}
	if (LOOPBACK_HOSTS.has(host.toLowerCase())) return null;
	return (
		`Refusing to run tests against DATABASE_URL host "${host}": the integration suites write and delete rows, ` +
		"so they only run against a loopback throwaway database. Set TEST_DATABASE_OK=1 to override deliberately."
	);
}

const refusal = testDatabaseUrlRefusal(process.env.DATABASE_URL, process.env.TEST_DATABASE_OK);
if (refusal !== null) {
	console.error(refusal);
	process.exit(1);
}
