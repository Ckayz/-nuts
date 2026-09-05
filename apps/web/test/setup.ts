/**
 * Test preload. `server-only` resolves to a module that throws unless the
 * `react-server` export condition is set (verified: server-only@0.0.1
 * index.js throws; exports map sends `react-server` to empty.js). Next sets
 * that condition; `bun test` does not, so the marker is stubbed here instead
 * of removing it from the server modules it guards.
 */
import { plugin } from "bun";

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
 * The fence is positive identity, not a denylist: the host must be a loopback
 * literal. Anything else refuses the whole run unless `TEST_DATABASE_OK=1` is
 * set deliberately by the operator.
 *
 * An unset or empty `DATABASE_URL` is allowed: that is the offline mode the
 * integration files already skip themselves on.
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
		return `DATABASE_URL is not a parseable URL, so the test suite cannot prove it is local. Set TEST_DATABASE_OK=1 to run anyway.`;
	}
	// `new URL("...://user@[::1]:5432/db").hostname` yields "[::1]"; a bare host
	// yields the literal. Both forms are covered by LOOPBACK_HOSTS.
	if (LOOPBACK_HOSTS.has(host.toLowerCase())) return null;
	return (
		`Refusing to run tests against DATABASE_URL host "${host}": the integration suites write and delete rows, ` +
		`so they only run against a loopback throwaway database. Create one ` +
		`(createdb x && cd packages/db && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/x bunx drizzle-kit migrate) ` +
		`or set TEST_DATABASE_OK=1 to override deliberately.`
	);
}

const refusal = testDatabaseUrlRefusal(process.env.DATABASE_URL, process.env.TEST_DATABASE_OK);
if (refusal !== null) {
	console.error(refusal);
	process.exit(1);
}
