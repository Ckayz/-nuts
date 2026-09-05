/**
 * B-m6. The live-database fence in `test/setup.ts` (the bun preload). The
 * suites here INSERT and DELETE rows; `@nuts/env/load` fills `DATABASE_URL`
 * from `apps/web/.env`, which on the owner's machine holds a production
 * Supabase URL. The fence refuses anything that is not a loopback host.
 */
import { describe, expect, test } from "bun:test";
import { testDatabaseUrlRefusal } from "./setup";

const REMOTE = "postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/fold_money";

describe("test database fence", () => {
	test("loopback hosts are allowed", () => {
		for (const url of [
			LOCAL,
			"postgresql://postgres:postgres@localhost:54322/x",
			"postgresql://postgres:postgres@LOCALHOST:54322/x",
			"postgres://postgres:postgres@127.0.0.1:5432/x",
			"postgresql://postgres:postgres@[::1]:54322/x",
			"postgresql://postgres:postgres@0.0.0.0:54322/x",
		]) {
			expect(testDatabaseUrlRefusal(url, undefined)).toBeNull();
		}
	});

	test("a remote host is refused and the message names it", () => {
		const refusal = testDatabaseUrlRefusal(REMOTE, undefined);
		expect(refusal).not.toBeNull();
		expect(refusal).toContain("db.abcdefghijkl.supabase.co");
		expect(refusal).toContain("TEST_DATABASE_OK=1");
	});

	test("other non-loopback hosts are refused too", () => {
		for (const url of [
			"postgresql://u:p@10.0.0.5:5432/x",
			"postgresql://u:p@127.0.0.1.evil.example:5432/x",
			"postgresql://u:p@localhost.evil.example:5432/x",
			"postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
		]) {
			expect(testDatabaseUrlRefusal(url, undefined)).not.toBeNull();
		}
	});

	test("an unparseable URL is refused rather than assumed local", () => {
		expect(testDatabaseUrlRefusal("not a url", undefined)).toContain("not a parseable URL");
	});

	test("an unset or empty URL is the offline mode and is allowed", () => {
		expect(testDatabaseUrlRefusal(undefined, undefined)).toBeNull();
		expect(testDatabaseUrlRefusal("", undefined)).toBeNull();
		expect(testDatabaseUrlRefusal("   ", undefined)).toBeNull();
	});

	test("TEST_DATABASE_OK=1 is the deliberate override; anything else is not", () => {
		expect(testDatabaseUrlRefusal(REMOTE, "1")).toBeNull();
		expect(testDatabaseUrlRefusal(REMOTE, "true")).not.toBeNull();
		expect(testDatabaseUrlRefusal(REMOTE, "0")).not.toBeNull();
		expect(testDatabaseUrlRefusal(REMOTE, "")).not.toBeNull();
	});
});
