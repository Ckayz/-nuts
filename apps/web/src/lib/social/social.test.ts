import { describe, expect, test } from "bun:test";
import { actorGuard, commentBody, desiredStateGuard, SOCIAL_PUBLIC_STATUSES } from "./guards";
import { rankCreators, rankTheses, type RankingPosition, type RankingThesis } from "./ranking";
import { writeComment, writeFollow, writeLike } from "./writes";
import { db } from "@nuts/db";
const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
describe("social guards", () => {
	test("anonymous writes return sign_in_required before database access", async () => {
		expect(await writeLike(db, null, A)).toEqual({ error: "sign_in_required" });
		expect(await writeFollow(db, null, A)).toEqual({ error: "sign_in_required" });
		expect(await writeComment(db, null, A, "hello")).toEqual({ error: "sign_in_required" });
	});
	test("malformed UUID writes are rejected before database access", async () => {
		for (const target of ["", "not-uuid", `${A}x`]) {
			expect(await writeLike(db, A, target)).toEqual({ error: "invalid_id" });
			expect(await writeFollow(db, A, target)).toEqual({ error: "invalid_id" });
			expect(await writeComment(db, A, target, "hello")).toEqual({ error: "invalid_id" });
		}
	});
	test("self follow is rejected case-insensitively before database access", async () => {
		expect(await writeFollow(db, A, A.toUpperCase())).toEqual({ error: "self_follow" });
		expect(actorGuard(A, B, true)).toBeNull();
	});
	test("blank and Unicode whitespace comments are rejected before database access", async () => {
		for (const body of ["", " \n\t", "\u00a0\ufeff"]) expect(await writeComment(db, A, B, body)).toEqual({ error: "blank_comment" });
		expect(commentBody("  hello\n ")).toBe("hello");
	});
	test("non-boolean desired states are rejected", () => {
		for (const value of [null, "false", 0, {}]) expect(desiredStateGuard(value)).toEqual({ error: "invalid_state" });
		expect(desiredStateGuard(false)).toBeNull();
	});
	test("public social statuses include expired and exclude unpublished", () => {
		expect([...SOCIAL_PUBLIC_STATUSES]).toEqual(["open", "expired", "settled"]);
	});
});
const now = new Date("2026-09-05T00:00:00Z");
const position = (userId: string, estimatedPnlUsd: string | null, extras: Partial<RankingPosition> = {}): RankingPosition => ({ userId, estimatedPnlUsd, finalPnlUsd: null, status: "confirmed", confirmedAt: now, ...extras });
describe("provisional rankings", () => {
	test("leaderboard combines settled final and open estimated exactly, preserving losses", () => {
		expect(rankCreators([position(A, "9007199254740993.01"), position(A, "999", { status: "settled", finalPnlUsd: "-9007199254740993" }), position(B, "0.02")], now, "1W")).toEqual([{ userId: B, pnl: "0.02" }, { userId: A, pnl: "0.01" }]);
	});
	test("window includes boundary and excludes old future pending failed and unconfirmed", () => {
		const boundary = new Date(now.getTime() - 7 * 86400000);
		expect(rankCreators([position(A, "1", { confirmedAt: boundary }), position(A, "100", { confirmedAt: new Date(boundary.getTime() - 1) }), position(A, "200", { confirmedAt: new Date(now.getTime() + 1) }), position(A, "400", { status: "pending" }), position(A, "800", { status: "failed" }), position(A, "1600", { confirmedAt: null })], now, "1W")).toEqual([{ userId: A, pnl: "1" }]);
	});
	test("NaN and null P&L make totals unavailable, after negative known totals", () => {
		expect(rankCreators([position(A, "NaN"), position(A, "10"), position(B, "-5"), position("c", null)], now, "1W")).toEqual([{ userId: B, pnl: "-5" }, { userId: A, pnl: null }, { userId: "c", pnl: null }]);
	});
	const row = (id: string, extras: Partial<RankingThesis> = {}): RankingThesis => ({ id, status: "open", likes: 0, comments: 0, participants: 0, expiryAt: null, settledAt: null, ...extras });
	test("trending sums likes comments and filled participants, excludes draft", () => {
		expect(rankTheses([row("a", { likes: 3 }), row("b", { likes: 1, comments: 1, participants: 2 }), row("c", { likes: 999, status: "draft" })], "trending").map(r => r.id)).toEqual(["b", "a"]);
	});
	test("ending orders only open dated theses by expiry ascending", () => {
		expect(rankTheses([row("a", { expiryAt: new Date(2000) }), row("b", { expiryAt: new Date(1000) }), row("c"), row("d", { status: "expired", expiryAt: new Date(0) })], "ending").map(r => r.id)).toEqual(["b", "a"]);
	});
	test("settled orders only settled theses newest first, missing date last", () => {
		expect(rankTheses([row("a", { status: "settled", settledAt: new Date(1000) }), row("b", { status: "settled", settledAt: new Date(2000) }), row("c", { status: "settled" }), row("d")], "settled").map(r => r.id)).toEqual(["b", "a", "c"]);
	});
});

test("server actions return sign_in_required with no cookie and never revalidate", () => {
	// Isolate module substitutions from the auth and read suites in this process.
	const script = `
		import { plugin } from "bun";
		plugin({ name: "anonymous-social-action-probe", setup(build) {
			build.module("next/headers", () => ({ exports: { cookies: async () => ({ get: () => undefined }) }, loader: "object" }));
			build.module("next/cache", () => ({ exports: { revalidatePath: () => { throw new Error("anonymous revalidation"); } }, loader: "object" }));
		}});
		const { toggleLike, toggleFollow, addComment } = await import("./src/lib/social/actions.ts");
		const results = [await toggleLike("bad"), await toggleFollow("bad"), await addComment("bad", "")];
		if (results.some(result => result.error !== "sign_in_required")) throw new Error(JSON.stringify(results));
		console.log("anonymous actions: 3 sign_in_required");
	`;
	const child = Bun.spawnSync([process.execPath, "--preload", "./test/setup.ts", "-e", script], { cwd: new URL("../../..", import.meta.url).pathname, env: { ...process.env, DATABASE_URL: "", SKIP_ENV_VALIDATION: "1" }, stdout: "pipe", stderr: "pipe" });
	expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
	expect(child.stdout.toString()).toContain("anonymous actions: 3 sign_in_required");
});
