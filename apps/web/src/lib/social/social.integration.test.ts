import { expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { activity, comments, positions, theses, users } from "@nuts/db/schema/index";
import type { NewPosition, NewThesis } from "@nuts/db/schema/index";
import { encodeFillEventSnapshot } from "@nuts/db/fill-event-snapshot";
import { orderSnapshotV1Schema } from "@nuts/db/order-snapshot";
import { getFollowState, listActivity, leaderboard, trending, endingSoon, settled, type Database } from "../data/reads";
import { writeLike, writeFollow, writeComment } from "./writes";
const databaseUrl = process.env.DATABASE_URL;
const A = "a1110000-0000-4000-8000-000000000001";
const B = "a1110000-0000-4000-8000-000000000002";
const T = "a2220000-0000-4000-8000-000000000001";
const U = "a2220000-0000-4000-8000-000000000002";
const D = "a2220000-0000-4000-8000-000000000003";
const P = "a3330000-0000-4000-8000-000000000001";
const Q = "a3330000-0000-4000-8000-000000000002";
const WA = "0x00000000000000000000000000000000feed9001";
const WB = "0x00000000000000000000000000000000feed9002";
// Synthetic receipt fields for tests only; not evidence of an onchain fill.
const FILL_EVENT = encodeFillEventSnapshot({
	nonce: 1n,
	buyer: "0xabc",
	seller: "0xdef",
	optionAddress: "0xc",
	premiumAmount: 1n,
	feeCollected: 0n,
	referrer: "0x0",
	referralFeePaid: 0n,
	sellerWasMaker: true,
});

// Synthetic maker order for tests only; not a real signed order.
const ORDER_SNAPSHOT = orderSnapshotV1Schema.parse({
	version: 1,
	order: {
		maker: "0xmaker",
		taker: "0xtaker",
		option: "0xoption",
		isBuyer: false,
		numContracts: "10000",
		price: "1",
		expiry: "1",
		nonce: "1",
	},
	signature: "0x",
	availableAmount: "0",
	makerAddress: "0xmaker",
});

const EXPIRY = new Date("2026-09-11T08:00:00Z");
const STRUCTURE = {
	taggedAsset: "BTC",
	underlyingAsset: "BTC",
	direction: "bull",
	expiryAt: EXPIRY,
	productType: "put spread",
	isCall: false,
	isLong: true,
	strikes: ["7800000000000", "7400000000000"],
	strikeDecimals: 8,
	collateralAddress: "0xc",
	collateralSymbol: "USDC",
	collateralDecimals: 6,
	creatorOrderSnapshot: ORDER_SNAPSHOT,
} satisfies Partial<NewThesis>;

function position(
	overrides: Partial<NewPosition> & { id: string; thesisId: string; userId: string; walletAddress: string },
): NewPosition {
	const confirmed = overrides.status === undefined || overrides.status === "confirmed";
	return {
		role: "participant",
		side: "back",
		status: "confirmed",
		chainId: 8453,
		orderId: "o",
		orderSnapshot: ORDER_SNAPSHOT,
		fillEvent: confirmed ? FILL_EVENT : null,
		txHash: `0x${overrides.id.replaceAll("-", "").repeat(2)}`,
		budget: "1000000",
		budgetDecimals: 6,
		contracts: "10000",
		contractDecimals: 6,
		premium: "1",
		premiumDecimals: 6,
		fees: "0",
		feeDecimals: 6,
		collateral: "1",
		collateralDecimals: 6,
		breakEvenPrices: [],
		breakEvenPriceDecimals: 8,
		breakEvenPricesUsd: [],
		confirmedAt: confirmed ? new Date() : null,
		...overrides,
	};
}


if (!databaseUrl) {
	console.log("social integration skipped: DATABASE_URL is not set");
	test.skip("social layer requires DATABASE_URL", () => {});
} else {
	const { db } = await import("@nuts/db");
	function probe(name: string, run: (tx: Database) => Promise<void>) {
		test(name, async () => {
			const rollback = new Error("rollback social probe");
			try { await db.transaction(async tx => {
				await tx.insert(users).values([{ id: A, walletAddress: WA, handle: "social_alice" }, { id: B, walletAddress: WB }]);
				await tx.insert(theses).values([
					{ id: T, slug: "social-a-3333", creatorUserId: A, headline: "Social A", status: "open", ...STRUCTURE },
					{ id: U, slug: "social-b-3333", creatorUserId: B, headline: "Social B", status: "open", ...STRUCTURE, expiryAt: new Date(EXPIRY.getTime() + 86400000) },
					{ id: D, slug: "private-social-draft-3333", creatorUserId: A, headline: "Private social draft", status: "draft" },
				]);
				await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
				await run(tx);
				throw rollback;
			}); } catch (error) { if (error !== rollback) throw error; }
		});
	}
	probe("like and unlike desired-state retries are idempotent with one activity", async tx => {
		expect(await writeLike(tx, B, T, true)).toEqual({ liked: true, likes: 1 });
		expect(await writeLike(tx, B, T, true)).toEqual({ liked: true, likes: 1 });
		const events = await tx.select().from(activity).where(and(eq(activity.userId, B), eq(activity.thesisId, T)));
		expect(events.map(e => e.eventType)).toEqual(["like"]);
		expect(await writeLike(tx, B, T, false)).toEqual({ liked: false, likes: 0 });
		expect(await writeLike(tx, B, T, false)).toEqual({ liked: false, likes: 0 });
	});
	probe("one argument toggles like and follow, desired follow retries preserve counts", async tx => {
		expect(await writeLike(tx, B, T)).toEqual({ liked: true, likes: 1 });
		expect(await writeLike(tx, B, T)).toEqual({ liked: false, likes: 0 });
		expect(await writeFollow(tx, B, A)).toEqual({ following: true, followers: 1 });
		expect(await writeFollow(tx, B, A, true)).toEqual({ following: true, followers: 1 });
		expect(await getFollowState(B, A, { database: tx })).toEqual({ following: true, followers: 1, followingCount: 0 });
		expect((await getFollowState(A, B, { database: tx })).followingCount).toBe(1);
		expect(await writeFollow(tx, B, A)).toEqual({ following: false, followers: 0 });
		expect(await writeFollow(tx, B, A, false)).toEqual({ following: false, followers: 0 });
	});
	probe("follow retries write one target-only activity; unfollow writes none", async tx => {
		await writeFollow(tx, B, A, true);
		await writeFollow(tx, B, A, true);
		const readEvents = () => tx.select().from(activity).where(eq(activity.userId, B));
		const before = await readEvents();
		expect(before).toHaveLength(1);
		expect(before[0]).toMatchObject({ eventType: "follow", userId: B, targetUserId: A, thesisId: null, positionId: null });
		const rendered = await listActivity(B, { database: tx });
		expect(rendered).toHaveLength(1);
		expect(rendered[0]).toMatchObject({ action: "follow", socialDetail: "social_alice", transactionHash: null, contracts: null, side: null });
		expect(rendered[0]?.thesisSlug).toBeUndefined();
		expect(await listActivity(B, { database: tx, thesisId: T })).toEqual([]);
		expect(await listActivity(A, { database: tx })).toEqual([]);
		await writeFollow(tx, B, A, false);
		await writeFollow(tx, B, A, false);
		expect(await readEvents()).toEqual(before);
	});
	probe("comment insert trims body and records actor activity atomically", async tx => {
		const result = await writeComment(tx, B, T, "  useful comment  ");
		expect("body" in result && result.body).toBe("useful comment");
		const inserted = await tx.select().from(comments).where(eq(comments.thesisId, T));
		expect(inserted.map(c => [c.userId, c.body])).toEqual([[B, "useful comment"]]);
		const events = await listActivity(B, { database: tx });
		expect(events).toHaveLength(1);
		expect(events[0]?.action).toBe("comment");
		expect(events[0]?.creator.id).toBe(B);
		expect(events[0]?.socialDetail).toBe("Social A");
		expect(events[0]?.thesisSlug).toBe("social-a-3333");
		expect(events[0]?.transactionHash).toBeNull();
		expect(await listActivity(A, { database: tx })).toEqual([]);
	});
	probe("public fence rejects draft and missing like/comment targets, accepts expired", async tx => {
		for (const id of [D, "ffffffff-ffff-ffff-ffff-ffffffffffff"]) {
			expect(await writeLike(tx, B, id, true)).toEqual({ error: "not_found" });
			expect(await writeComment(tx, B, id, "hidden")).toEqual({ error: "not_found" });
		}
		await tx.update(theses).set({ status: "expired" }).where(eq(theses.id, T));
		expect(await writeLike(tx, B, T, true)).toEqual({ liked: true, likes: 1 });
	});
	probe("activity excludes draft references and orders events newest first", async tx => {
		await tx.insert(activity).values([
			{ userId: B, thesisId: D, eventType: "comment", createdAt: new Date(3000) },
			{ userId: B, thesisId: T, eventType: "like", createdAt: new Date(1000) },
			{ userId: B, thesisId: U, eventType: "comment", createdAt: new Date(2000) },
		]);
		expect((await listActivity(B, { database: tx })).map(a => a.action)).toEqual(["comment", "like"]);
	});
	probe("leaderboard uses confirmed window, correct status P&L, tolerates NaN", async tx => {
		const now = new Date();
		await tx.insert(positions).values([
			position({ id: P, thesisId: T, userId: A, walletAddress: WA, estimatedPnlUsd: "-5", confirmedAt: now }),
			position({ id: Q, thesisId: U, userId: B, walletAddress: WB, status: "settled", fillEvent: FILL_EVENT, estimatedPnlUsd: "-999", finalPnlUsd: "2", confirmedAt: now }),
		]);
		const read = () => leaderboard({ database: tx, window: "1W", now });
		expect((await read()).filter(c => [A, B].includes(c.id)).map(c => [c.id, c.netPnlUsd])).toEqual([[B, "2"], [A, "-5"]]);
		await tx.update(positions).set({ finalPnlUsd: "NaN" }).where(eq(positions.id, Q));
		expect((await read()).filter(c => [A, B].includes(c.id)).map(c => [c.id, c.netPnlUsd])).toEqual([[A, "-5"], [B, null]]);
		await tx.update(positions).set({ confirmedAt: new Date(now.getTime() - 8 * 86400000) }).where(eq(positions.id, P));
		expect((await read()).map(c => c.id)).not.toContain(A);
	});
	probe("trending counts filled participation plus comments and likes; ending and settled ordering", async tx => {
		await writeLike(tx, B, T, true);
		await writeComment(tx, A, U, "one");
		await tx.insert(positions).values([
			position({ id: P, thesisId: U, userId: A, walletAddress: WA }),
			position({ id: Q, thesisId: T, userId: B, walletAddress: WB, status: "pending" }),
		]);
		const ids = (rows: { id: string }[]) => rows.filter(r => [T, U, D].includes(r.id)).map(r => r.id);
		expect(ids(await trending({ database: tx }))).toEqual([U, T]);
		expect(ids(await endingSoon({ database: tx }))).toEqual([T, U]);
		await tx.update(theses).set({ status: "settled", settledAt: new Date(1000) }).where(eq(theses.id, T));
		await tx.update(theses).set({ status: "settled", settledAt: new Date(2000) }).where(eq(theses.id, U));
		expect(ids(await settled({ database: tx }))).toEqual([U, T]);
	});
}
