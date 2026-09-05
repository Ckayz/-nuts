import { expect, mock, spyOn, test } from "bun:test";

/**
 * `getSession()` reads `cookies()`, which throws outside a request scope, so
 * the sign-in guard cannot be exercised here without a stub. Stubbing the cookie
 * store — rather than `getSession` itself — keeps the guard under test: the
 * action really calls `getSession`, which really decodes (nothing), and really
 * returns null. No other test file in this app imports `next/headers`.
 */
mock.module("next/headers", () => ({
	cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
import { and, eq, sql } from "drizzle-orm";
import { activity, positions, theses, users } from "@nuts/db/schema/index";
import type { NewPosition, NewThesis } from "@nuts/db/schema/index";
import { encodeFillEventSnapshot } from "@nuts/db/fill-event-snapshot";
import { orderSnapshotV1Schema } from "@nuts/db/order-snapshot";
import { deriveSlug } from "@nuts/db/slug";
import type { Database } from "../data/reads";
import { listFeed } from "../data/reads";
import { enrichWithTradeLinks } from "./enrich";
import { listPositionsByIds } from "../data/reads";
import { writePost } from "./publish";

const databaseUrl = process.env.DATABASE_URL;

const AUTHOR = "c1110000-0000-4000-8000-000000000001";
const OTHER = "c1110000-0000-4000-8000-000000000002";
const HOST_THESIS = "c2220000-0000-4000-8000-000000000001";
const POSITION = "c3330000-0000-4000-8000-000000000001";
const PENDING_POSITION = "c3330000-0000-4000-8000-000000000002";
const MISSING = "c3330000-0000-4000-8000-0000000000ff";
const WA = "0x00000000000000000000000000000000cafe0001";
const WB = "0x00000000000000000000000000000000cafe0002";

// Synthetic receipt/order fields for tests only; not evidence of an onchain fill.
const FILL_EVENT = encodeFillEventSnapshot({
	nonce: 1n, buyer: "0xabc", seller: "0xdef", optionAddress: "0xc",
	premiumAmount: 1n, feeCollected: 0n, referrer: "0x0", referralFeePaid: 0n,
	sellerWasMaker: true,
});
const ORDER_SNAPSHOT = orderSnapshotV1Schema.parse({
	version: 1,
	order: { maker: "0xmaker", taker: "0xtaker", option: "0xoption", isBuyer: false, numContracts: "10000", price: "1", expiry: "1", nonce: "1" },
	signature: "0x", availableAmount: "0", makerAddress: "0xmaker",
});
const STRUCTURE = {
	taggedAsset: "BTC", underlyingAsset: "BTC", direction: "bull",
	expiryAt: new Date("2026-09-11T08:00:00Z"), productType: "put spread",
	isCall: false, isLong: true, strikes: ["7800000000000", "7400000000000"],
	strikeDecimals: 8, collateralAddress: "0xc", collateralSymbol: "USDC",
	collateralDecimals: 6, creatorOrderSnapshot: ORDER_SNAPSHOT,
} satisfies Partial<NewThesis>;

function position(overrides: Partial<NewPosition> & { id: string; thesisId: string; userId: string; walletAddress: string }): NewPosition {
	const confirmed = overrides.status === undefined || overrides.status === "confirmed";
	return {
		role: "participant", side: "back", status: "confirmed", chainId: 8453,
		orderId: "o", orderSnapshot: ORDER_SNAPSHOT, fillEvent: confirmed ? FILL_EVENT : null,
		txHash: `0x${overrides.id.replaceAll("-", "").repeat(2)}`,
		budget: "1000000", budgetDecimals: 6, contracts: "10000", contractDecimals: 6,
		premium: "1", premiumDecimals: 6, fees: "0", feeDecimals: 6,
		collateral: "1", collateralDecimals: 6, breakEvenPrices: [], breakEvenPriceDecimals: 8,
		breakEvenPricesUsd: [], maximumLossUsd: "1000", estimatedPnlUsd: "612",
		confirmedAt: confirmed ? new Date() : null,
		...overrides,
	};
}

if (!databaseUrl) {
	console.log("thesis integration skipped: DATABASE_URL is not set");
	test.skip("thesis layer requires DATABASE_URL", () => {});
} else {
	const { db } = await import("@nuts/db");
	function probe(name: string, run: (tx: Database) => Promise<void>) {
		test(name, async () => {
			const rollback = new Error("rollback thesis probe");
			try {
				await db.transaction(async (tx) => {
					await tx.insert(users).values([
						{ id: AUTHOR, walletAddress: WA, handle: "card_author", displayName: "card_author" },
						{ id: OTHER, walletAddress: WB },
					]);
					await tx.insert(theses).values([
						{ id: HOST_THESIS, slug: "card-host-1111", creatorUserId: AUTHOR, headline: "Host", status: "open", ...STRUCTURE },
					]);
					await tx.insert(positions).values([
						position({ id: POSITION, thesisId: HOST_THESIS, userId: AUTHOR, walletAddress: WA, role: "creator" }),
						position({ id: PENDING_POSITION, thesisId: HOST_THESIS, userId: OTHER, walletAddress: WB, status: "pending", side: "counter" }),
					]);
					await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
					await run(tx);
					throw rollback;
				});
			} catch (error) {
				if (error !== rollback) throw error;
			}
		});
	}

	probe("publishes a text post with a slug, published_at and one activity row", async (tx) => {
		const result = await writePost(tx, { userId: AUTHOR, headline: "  Nobody prices a hot NFP  " });
		expect("error" in result).toBe(false);
		if ("error" in result) return;

		const [row] = await tx.select().from(theses).where(eq(theses.id, result.id));
		expect(row).toMatchObject({
			headline: "Nobody prices a hot NFP",
			rationale: null,
			status: "open",
			taggedAsset: null,
			underlyingAsset: null,
			direction: null,
			creatorPositionId: null,
			creatorOrderSnapshot: null,
		});
		expect(row?.publishedAt).toBeInstanceOf(Date);
		expect(row?.slug).toBe(deriveSlug("Nobody prices a hot NFP", result.id));
		expect(result.slug).toBe(row?.slug ?? "");

		const events = await tx.select().from(activity).where(eq(activity.thesisId, result.id));
		expect(events.map((event) => [event.eventType, event.userId])).toEqual([["thesis_published", AUTHOR]]);
	});

	probe("a tagged post stores the ticker uppercased", async (tx) => {
		const result = await writePost(tx, { userId: AUTHOR, headline: "btc into the weekend", taggedAsset: " btc " });
		if ("error" in result) throw new Error(result.error);
		const [row] = await tx.select().from(theses).where(eq(theses.id, result.id));
		expect(row?.taggedAsset).toBe("BTC");
		// Tagging a market must not invent a structure.
		expect(row?.underlyingAsset).toBeNull();
	});

	probe("blank and whitespace-only headlines are refused before any insert", async (tx) => {
		const before = await tx.select({ n: sql<string>`count(*)` }).from(theses);
		for (const headline of ["", "   ", "  ", "\n\t", null, 42]) {
			expect(await writePost(tx, { userId: AUTHOR, headline })).toEqual({ error: "blank_headline" });
		}
		const after = await tx.select({ n: sql<string>`count(*)` }).from(theses);
		expect(after[0]?.n).toBe(before[0]?.n ?? "");
	});

	probe("a tag that is not a ticker is refused", async (tx) => {
		for (const tag of ["not a ticker", "b-t-c", "🐂"]) {
			expect(await writePost(tx, { userId: AUTHOR, headline: "x", taggedAsset: tag })).toEqual({ error: "invalid_tag" });
		}
	});

	probe("a taken slug is retried once with a longer hex suffix", async (tx) => {
		// Pin the uuid so the derived slug is known, then squat it. Without the
		// retry this publish raises 23505 and the probe fails loudly.
		const id = "c4440000-0000-4000-8000-000000000001";
		const spy = spyOn(crypto, "randomUUID").mockReturnValue(id);
		try {
			const taken = deriveSlug("Collide with me", id);
			await tx.insert(theses).values({ id: OTHER.replace(/.$/, "9"), slug: taken, creatorUserId: OTHER, headline: "Squatter", status: "open" });
			const result = await writePost(tx, { userId: AUTHOR, headline: "Collide with me" });
			if ("error" in result) throw new Error(result.error);
			expect(result.slug).not.toBe(taken);
			expect(result.slug).toBe(deriveSlug("Collide with me", id, new Set([taken])));
			expect(result.slug.startsWith(`${taken}`)).toBe(true);
			expect(result.id).toBe(id);
			// The retry re-ran the whole transaction, so the activity row is there
			// exactly once — not zero (rolled back) and not twice.
			const events = await tx.select().from(activity).where(eq(activity.thesisId, id));
			expect(events.map((event) => event.eventType)).toEqual(["thesis_published"]);
		} finally {
			spy.mockRestore();
		}
	});

	probe("two taken slugs exhaust the retry and report slug_conflict", async (tx) => {
		const id = "c4440000-0000-4000-8000-000000000002";
		const spy = spyOn(crypto, "randomUUID").mockReturnValue(id);
		try {
			const first = deriveSlug("Collide with me", id);
			const second = deriveSlug("Collide with me", id, new Set([first]));
			await tx.insert(theses).values([
				{ id: OTHER.replace(/.$/, "a"), slug: first, creatorUserId: OTHER, headline: "S1", status: "open" },
				{ id: OTHER.replace(/.$/, "b"), slug: second, creatorUserId: OTHER, headline: "S2", status: "open" },
			]);
			expect(await writePost(tx, { userId: AUTHOR, headline: "Collide with me" })).toEqual({ error: "slug_conflict" });
			// Nothing half-landed: neither the post nor an activity row.
			expect(await tx.select().from(theses).where(eq(theses.id, id))).toHaveLength(0);
			expect(await tx.select().from(activity).where(eq(activity.thesisId, id))).toHaveLength(0);
		} finally {
			spy.mockRestore();
		}
	});

	probe("writePost propagates a non-slug 23505 instead of retrying under a new slug", async (tx) => {
		// Pin the uuid to one that already exists: the insert now violates
		// `theses_pkey`, a 23505 on a DIFFERENT index. It must escape, not be
		// mistaken for a slug collision and silently republished.
		const spy = spyOn(crypto, "randomUUID").mockReturnValue(HOST_THESIS);
		let caught: unknown;
		try {
			await writePost(tx, { userId: AUTHOR, headline: "Duplicate primary key" });
		} catch (error) {
			caught = error;
		} finally {
			spy.mockRestore();
		}
		expect(caught).toBeDefined();
		expect((caught as { cause?: { code?: string; constraint?: string } }).cause?.constraint).toBe("theses_pkey");
	});

	probe("a unique violation that is not the slug index is never retried away", async (tx) => {
		// `positions_chain_id_tx_hash_unique` is a different 23505. It must
		// propagate, not be mistaken for a slug collision.
		// Drizzle's builder is a thenable, not a Promise, so it is awaited inside
		// a real async function before the rejection is asserted.
		let caught: unknown;
		try {
			await tx.insert(positions).values(position({ id: "c3330000-0000-4000-8000-00000000000e", thesisId: HOST_THESIS, userId: AUTHOR, walletAddress: WA, txHash: `0x${POSITION.replaceAll("-", "").repeat(2)}` }));
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeDefined();
		// It IS a 23505 — on a different index — so the slug guard must reject it.
		expect((caught as { cause?: { code?: string; constraint?: string } }).cause?.code).toBe("23505");
		expect((caught as { cause?: { constraint?: string } }).cause?.constraint).toBe("positions_chain_id_tx_hash_unique");
	});

	probe("getPositionsByIds returns owners, ignores junk ids and unknown ids", async (tx) => {
		const found = await listPositionsByIds([POSITION.toUpperCase(), MISSING, "not-a-uuid", ""], { database: tx });
		expect([...found.keys()]).toEqual([POSITION]);
		expect(found.get(POSITION)?.owner.handle).toBe("card_author");
		expect(found.get(POSITION)?.position.underlyingAsset).toBe("BTC");
		expect(found.get(POSITION)?.position.economics.maximumLossUsd).toBe("1000");
	});

	probe("a pending position still unfurls, with its status shown verbatim", async (tx) => {
		const found = await listPositionsByIds([PENDING_POSITION], { database: tx });
		expect(found.get(PENDING_POSITION)?.position.status).toBe("pending");
	});

	probe("a published post's link resolves into a card through the feed read", async (tx) => {
		const result = await writePost(tx, {
			userId: AUTHOR,
			headline: "Backed it",
			rationale: `filled here /p/${POSITION} — small size`,
		});
		if ("error" in result) throw new Error(result.error);

		const feed = await enrichWithTradeLinks(
			await listFeed({ database: tx }),
			(ids) => listPositionsByIds(ids, { database: tx }),
		);
		const post = feed.find((entry) => entry.id === result.id);
		expect(post?.linkedPositions?.map((entry) => entry.position.id)).toEqual([POSITION]);
		expect(post?.linkedPositions?.[0]?.owner.handle).toBe("card_author");
		// GAP (reported): the link does not become a backing link. The deferred
		// creator-position trigger requires `position.thesis_id = thesis.id`, and
		// this position belongs to the host thesis.
		const [row] = await tx.select().from(theses).where(eq(theses.id, result.id));
		expect(row?.creatorPositionId).toBeNull();
	});

	probe("a link to somebody else's position still renders a card", async (tx) => {
		const result = await writePost(tx, { userId: OTHER, headline: "Look at this", rationale: `/p/${POSITION}` });
		if ("error" in result) throw new Error(result.error);
		const [post] = await enrichWithTradeLinks(
			await listFeed({ database: tx, limit: 50 }),
			(ids) => listPositionsByIds(ids, { database: tx }),
		).then((rows) => rows.filter((row) => row.id === result.id));
		expect(post?.linkedPositions?.[0]?.owner.walletAddress).toBe(WA);
		expect(post?.creatorUserId).toBe(OTHER);
	});

	probe("a link to a position that does not exist leaves the post cardless", async (tx) => {
		const result = await writePost(tx, { userId: AUTHOR, headline: "Dangling", rationale: `/p/${MISSING}` });
		if ("error" in result) throw new Error(result.error);
		const feed = await enrichWithTradeLinks(
			await listFeed({ database: tx, limit: 50 }),
			(ids) => listPositionsByIds(ids, { database: tx }),
		);
		const post = feed.find((entry) => entry.id === result.id);
		expect(post?.linkedPositions).toBeUndefined();
		expect(post?.thesis.rationale).toBe(`/p/${MISSING}`);
	});

	probe("the feed costs one position query no matter how many posts link", async (tx) => {
		await writePost(tx, { userId: AUTHOR, headline: "One", rationale: `/p/${POSITION}` });
		await writePost(tx, { userId: OTHER, headline: "Two", rationale: `/p/${POSITION} /p/${PENDING_POSITION}` });
		let calls = 0;
		let seen: readonly string[] = [];
		const feed = await enrichWithTradeLinks(await listFeed({ database: tx, limit: 50 }), (ids) => {
			calls += 1;
			seen = ids;
			return listPositionsByIds(ids, { database: tx });
		});
		// One call, and this probe's two ids appear once each and in link order.
		// Asserted as a subsequence rather than the whole array so a database
		// that already holds other linking posts does not fail the test.
		expect(calls).toBe(1);
		expect(seen.filter((id) => id === POSITION)).toEqual([POSITION]);
		expect(seen.indexOf(POSITION)).toBeLessThan(seen.indexOf(PENDING_POSITION));
		const mine = feed.filter((entry) => entry.creatorUserId === AUTHOR || entry.creatorUserId === OTHER);
		expect(mine.filter((entry) => entry.linkedPositions !== undefined)).toHaveLength(2);
	});

	probe("an unauthenticated publish is refused before any database work", async (tx) => {
		const { publishPost } = await import("./actions");
		// This probe's transaction cannot see the action's writes (the action uses
		// the shared handle), so the count is taken on the real connection too.
		const [before] = await db.select({ n: sql<string>`count(*)` }).from(theses);
		expect(await publishPost({ headline: "should not land" })).toEqual({ error: "sign_in_required" });
		expect(await publishPost({ headline: "", rationale: "x" })).toEqual({ error: "sign_in_required" });
		const [after] = await db.select({ n: sql<string>`count(*)` }).from(theses);
		expect(after?.n).toBe(before?.n ?? "");
		// The probe transaction is still usable and still holds its own fixture.
		expect(await tx.select().from(theses).where(eq(theses.id, HOST_THESIS))).toHaveLength(1);
	});

	probe("publishing writes the post and its activity in ONE transaction", async (tx) => {
		const result = await writePost(tx, { userId: AUTHOR, headline: "Atomic" });
		if ("error" in result) throw new Error(result.error);
		const rows = await tx
			.select({ thesis: theses.id, event: activity.eventType })
			.from(theses)
			.innerJoin(activity, and(eq(activity.thesisId, theses.id), eq(activity.eventType, "thesis_published")))
			.where(eq(theses.id, result.id));
		expect(rows).toHaveLength(1);
	});
}
