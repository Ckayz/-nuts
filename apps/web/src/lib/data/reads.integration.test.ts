/**
 * `reads.ts` against real Postgres, in a transaction that is always rolled back.
 * Gated on `DATABASE_URL` the same way `auth.integration.test.ts` is, so the
 * suite still runs offline; without the variable this file emits one skipped
 * test.
 *
 * Run it against an isolated database (never the shared `postgres` one):
 *   createdb server_r2 && cd packages/db &&
 *     DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/server_r2 bunx drizzle-kit migrate
 *   cd apps/web &&
 *     DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/server_r2 \
 *     bun test src/lib/data/reads.integration.test.ts
 *
 * These are the cases the read layer had none of: the status rule every list
 * shares, the portfolio's wallet fence, the Bull/Bear mapping and the split
 * percentage, likes, and a `numeric` column holding `NaN` or a negative value.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { comments, likes, positions, theses, users } from "@nuts/db/schema/index";
import type { NewPosition, NewThesis } from "@nuts/db/schema/index";
import { encodeFillEventSnapshot } from "@nuts/db/fill-event-snapshot";
import { orderSnapshotV1Schema } from "@nuts/db/order-snapshot";
import type { Database } from "./reads";
import { getCreator, getPortfolio, getThread, listFeed } from "./reads";

const databaseUrl = process.env.DATABASE_URL;

// Deterministic ids and addresses in this file's own namespace; never real.
const ALICE = "11110000-0000-4000-8000-000000000001";
const BOB = "11110000-0000-4000-8000-000000000002";
const CAROL = "11110000-0000-4000-8000-000000000003";
const ALICE_WALLET = "0x00000000000000000000000000000000feed1001";
const BOB_WALLET = "0x00000000000000000000000000000000feed1002";
const CAROL_WALLET = "0x00000000000000000000000000000000feed1003";

const T_BACKED = "22220000-0000-4000-8000-000000000001";
const T_TEXT = "22220000-0000-4000-8000-000000000002";
const T_TAGGED = "22220000-0000-4000-8000-000000000003";
const T_DRAFT = "22220000-0000-4000-8000-000000000004";

const P_CREATOR = "33330000-0000-4000-8000-000000000001";
const P_BULL = "33330000-0000-4000-8000-000000000002";
const P_BEAR = "33330000-0000-4000-8000-000000000003";
const P_PENDING = "33330000-0000-4000-8000-000000000004";
const P_FAILED = "33330000-0000-4000-8000-000000000005";
const P_DRAFT = "33330000-0000-4000-8000-000000000006";

const EXPIRY = new Date("2026-09-11T08:00:00.000Z");

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
	console.log("reads integration skipped: DATABASE_URL is not set");
	test.skip("read layer requires DATABASE_URL", () => {});
} else {
	const { db } = await import("@nuts/db");

	/**
	 * One graph for every case:
	 *   T_BACKED  open, structured, Alice's creator position linked, plus a Bull
	 *             ($750) and a Bear ($250) participant, one `pending` and one
	 *             `failed` transaction, one comment, two likes (Bob and Carol);
	 *   T_TEXT    open, no structure, no backing;
	 *   T_TAGGED  open, tagged BTC only — no structure, no backing;
	 *   T_DRAFT   Alice's draft, with a filled Bob position on it.
	 */
	async function seed(tx: Database): Promise<void> {
		await tx.insert(users).values([
			{ id: ALICE, walletAddress: ALICE_WALLET, displayName: "Alice Probe" },
			{ id: BOB, walletAddress: BOB_WALLET, displayName: "Bob Probe" },
			{ id: CAROL, walletAddress: CAROL_WALLET, displayName: null },
		]);
		await tx.insert(theses).values([
			{ id: T_BACKED, slug: "backed-post-2222", creatorUserId: ALICE, headline: "Backed post", rationale: "why", status: "open", publishedAt: new Date(), ...STRUCTURE },
			{ id: T_TEXT, slug: "text-only-post-2222", creatorUserId: ALICE, headline: "Text only post", status: "open", publishedAt: new Date() },
			{ id: T_TAGGED, slug: "tagged-post-2222", creatorUserId: BOB, headline: "Tagged post", status: "open", publishedAt: new Date(), taggedAsset: "BTC" },
			{ id: T_DRAFT, slug: "secret-draft-2222", creatorUserId: ALICE, headline: "SECRET DRAFT", status: "draft", ...STRUCTURE },
		] as NewThesis[]);
		await tx.insert(positions).values([
			position({ id: P_CREATOR, thesisId: T_BACKED, userId: ALICE, walletAddress: ALICE_WALLET, role: "creator", side: "back", entryPremiumUsd: "500.00", maximumLossUsd: "500.00", maximumPayoutUsd: "2300.00", estimatedPnlUsd: "25.00" }),
			position({ id: P_BULL, thesisId: T_BACKED, userId: BOB, walletAddress: BOB_WALLET, side: "back", entryPremiumUsd: "250.00" }),
			position({ id: P_BEAR, thesisId: T_BACKED, userId: CAROL, walletAddress: CAROL_WALLET, side: "counter", entryPremiumUsd: "250.00" }),
			position({ id: P_PENDING, thesisId: T_BACKED, userId: BOB, walletAddress: BOB_WALLET, side: "back", status: "pending", entryPremiumUsd: "9999.00" }),
			position({ id: P_FAILED, thesisId: T_BACKED, userId: CAROL, walletAddress: CAROL_WALLET, side: "counter", status: "failed", entryPremiumUsd: "8888.00" }),
			position({ id: P_DRAFT, thesisId: T_DRAFT, userId: BOB, walletAddress: BOB_WALLET, side: "back", entryPremiumUsd: "10.00" }),
		]);
		await tx.update(theses).set({ creatorPositionId: P_CREATOR }).where(sql`${theses.id} = ${T_BACKED}`);
		await tx.insert(comments).values({ thesisId: T_BACKED, userId: BOB, body: "first" });
		await tx.insert(likes).values([
			{ thesisId: T_BACKED, userId: BOB },
			{ thesisId: T_BACKED, userId: CAROL },
		]);
		// Prove the seed satisfies the deferred creator-position triggers now; the
		// transaction is rolled back, so they would otherwise never run.
		await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
		await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
	}

	/** Each case gets its own transaction and leaves no row behind. */
	function probe(name: string, run: (tx: Database) => Promise<void>) {
		test(name, async () => {
			const sentinel = new Error("rollback");
			try {
				await db.transaction(async (tx) => {
					await seed(tx);
					await run(tx);
					throw sentinel;
				});
			} catch (error) {
				if (error !== sentinel) throw error;
			}
		});
	}

	describe("listFeed", () => {
		probe("returns the three open posts and not the draft", async (tx) => {
			const feed = await listFeed({ database: tx });
			const ids = feed.map((thesis) => thesis.id);
			expect(ids).toContain(T_BACKED);
			expect(ids).toContain(T_TEXT);
			expect(ids).toContain(T_TAGGED);
			expect(ids).not.toContain(T_DRAFT);
			expect(feed.map((t) => t.thesis.headline)).not.toContain("SECRET DRAFT");
		});

		probe("maps each post to its own state", async (tx) => {
			const feed = await listFeed({ database: tx });
			const byId = new Map(feed.map((thesis) => [thesis.id, thesis]));

			const text = byId.get(T_TEXT);
			expect(text?.market).toBeNull();
			expect(text?.structure).toBeNull();
			expect(text?.backing).toBeNull();
			expect(text?.thesis.direction).toBeNull();

			const tagged = byId.get(T_TAGGED);
			expect(tagged?.market?.underlyingAsset).toBe("BTC");
			expect(tagged?.market?.expiryAt).toBeNull();
			expect(tagged?.structure).toBeNull();
			expect(tagged?.backing).toBeNull();

			const backed = byId.get(T_BACKED);
			expect(backed?.market?.expiryAt).toBe(EXPIRY.toISOString());
			expect(backed?.structure?.strikesUsd).toEqual(["78000", "74000"]);
			expect(backed?.backing?.creatorPositionId).toBe(P_CREATOR);
			expect(backed?.backing?.economics.maximumPayoutUsd).toBe("2300.00");
		});

		probe("counts only filled fills and splits Bull against Bear", async (tx) => {
			const feed = await listFeed({ database: tx });
			const backed = feed.find((thesis) => thesis.id === T_BACKED);
			// Creator $500 + Bull $250 on Back; Bear $250 on Counter. The pending
			// $9,999 and the failed $8,888 are excluded by the one status rule.
			expect(backed?.backing?.bull.count).toBe(2);
			expect(backed?.backing?.bear.count).toBe(1);
			expect(backed?.backing?.bull.amountUsd).toBe("750.00");
			expect(backed?.backing?.bear.amountUsd).toBe("250.00");
			expect(backed?.backing?.bull.pct).toBe(75);
			expect(backed?.backing?.bear.pct).toBe(25);
			expect(backed?.backing?.pooledUsd).toBe("1000");
		});

		probe("Back rows drive Bull and Counter rows drive Bear", async (tx) => {
			// Move every Back fill to the Counter side: a swapped mapping would keep
			// the same numbers on the same side and this would not move.
			await tx.execute(sql`update positions set side = 'counter' where thesis_id = ${T_BACKED}`);
			const feed = await listFeed({ database: tx });
			const backed = feed.find((thesis) => thesis.id === T_BACKED);
			expect(backed?.backing?.bull.count).toBe(0);
			expect(backed?.backing?.bull.amountUsd).toBe("0");
			expect(backed?.backing?.bear.count).toBe(3);
			expect(backed?.backing?.bear.amountUsd).toBe("1000.00");
			expect(backed?.backing?.bull.pct).toBe(0);
			expect(backed?.backing?.bear.pct).toBe(100);
		});

		probe("likes count, and likedByViewer follows the viewer", async (tx) => {
			const anonymous = await listFeed({ database: tx });
			const anonBacked = anonymous.find((thesis) => thesis.id === T_BACKED);
			expect(anonBacked?.likes).toBe(2);
			expect(anonBacked?.likedByViewer).toBe(false);
			expect(anonBacked?.commentCount).toBe(1);

			const asBob = await listFeed({ database: tx, viewerUserId: BOB });
			expect(asBob.find((t) => t.id === T_BACKED)?.likedByViewer).toBe(true);
			expect(asBob.find((t) => t.id === T_TEXT)?.likedByViewer).toBe(false);

			const asAlice = await listFeed({ database: tx, viewerUserId: ALICE });
			expect(asAlice.find((t) => t.id === T_BACKED)?.likedByViewer).toBe(false);
		});

		probe("a non-uuid viewer id is treated as anonymous, not queried", async (tx) => {
			const feed = await listFeed({ database: tx, viewerUserId: "not-a-uuid" });
			expect(feed.find((thesis) => thesis.id === T_BACKED)?.likedByViewer).toBe(false);
		});
	});

	describe("bad numeric values degrade instead of throwing", () => {
		probe("a NaN entry_premium_usd makes that side unavailable, not a crash", async (tx) => {
			await tx.execute(sql`update positions set entry_premium_usd = 'NaN' where id = ${P_BULL}`);
			const feed = await listFeed({ database: tx });
			const backed = feed.find((thesis) => thesis.id === T_BACKED);
			expect(backed?.backing?.bull.amountUsd).toBeNull();
			expect(backed?.backing?.bull.pct).toBe(0);
			expect(backed?.backing?.bear.pct).toBe(0);
			expect(backed?.backing?.pooledUsd).toBeNull();
		});

		probe("a negative entry_premium_usd never draws a negative bar", async (tx) => {
			await tx.execute(sql`update positions set entry_premium_usd = '-500.00' where id = ${P_BULL}`);
			const feed = await listFeed({ database: tx });
			const backed = feed.find((thesis) => thesis.id === T_BACKED);
			expect(backed?.backing?.bull.amountUsd).toBeNull();
			expect(backed?.backing?.bull.pct).toBeGreaterThanOrEqual(0);
			expect(backed?.backing?.bear.pct).toBeGreaterThanOrEqual(0);
		});

		probe("a NaN P&L column on the creator position renders as unavailable", async (tx) => {
			await tx.execute(sql`update positions set estimated_pnl_usd = 'NaN' where id = ${P_CREATOR}`);
			const thread = await getThread(T_BACKED, { database: tx });
			expect(thread?.thesis.backing?.economics.estimatedPnlUsd).toBeNull();
		});
	});

	describe("getThread", () => {
		probe("lists filled participants only", async (tx) => {
			const thread = await getThread(T_BACKED, { database: tx });
			const ids = thread?.participants.map((p) => p.id) ?? [];
			expect(ids).toContain(P_CREATOR);
			expect(ids).toContain(P_BULL);
			expect(ids).toContain(P_BEAR);
			expect(ids).not.toContain(P_PENDING);
			expect(ids).not.toContain(P_FAILED);
			expect(thread?.participantCount).toBe(3);
			expect(thread?.participants.map((p) => p.status)).not.toContain("pending");
			expect(thread?.participants.map((p) => p.status)).not.toContain("failed");
		});

		probe("the participant list agrees with the board's own counts", async (tx) => {
			const thread = await getThread(T_BACKED, { database: tx });
			const backing = thread?.thesis.backing;
			expect(thread?.participantCount).toBe((backing?.bull.count ?? 0) + (backing?.bear.count ?? 0));
		});

		probe("comments come back with their author", async (tx) => {
			const thread = await getThread(T_BACKED, { database: tx });
			expect(thread?.comments).toHaveLength(1);
			expect(thread?.comments[0]?.body).toBe("first");
			expect(thread?.comments[0]?.creator.walletAddress).toBe(BOB_WALLET);
		});

		probe("a text-only thread has no participants and no backing", async (tx) => {
			const thread = await getThread(T_TEXT, { database: tx });
			expect(thread?.participants).toHaveLength(0);
			expect(thread?.thesis.backing).toBeNull();
			expect(thread?.thesis.market).toBeNull();
		});

		probe("a non-uuid slug is a miss, not a 500", async (tx) => {
			expect(await getThread("btc-nfp-4a2c", { database: tx })).toBeNull();
			expect(await getThread("", { database: tx })).toBeNull();
		});
	});

	describe("getPortfolio", () => {
		probe("returns only the wallet asked for", async (tx) => {
			const bob = await getPortfolio(BOB_WALLET, { database: tx });
			expect(bob.every((p) => p.walletAddress === BOB_WALLET)).toBe(true);
			expect(bob.map((p) => p.id)).toContain(P_BULL);
			expect(bob.map((p) => p.id)).not.toContain(P_CREATOR);
			expect(bob.map((p) => p.id)).not.toContain(P_BEAR);

			const carol = await getPortfolio(CAROL_WALLET, { database: tx });
			expect(carol.map((p) => p.id)).toContain(P_BEAR);
			expect(carol.map((p) => p.id)).not.toContain(P_BULL);

			// No overlap at all: a dropped fence would make these two identical.
			const shared = bob.map((p) => p.id).filter((id) => carol.map((c) => c.id).includes(id));
			expect(shared).toEqual([]);
		});

		probe("is case- and whitespace-insensitive about the address", async (tx) => {
			const mixed = await getPortfolio(`  ${BOB_WALLET.toUpperCase().replace("0X", "0x")}  `, { database: tx });
			expect(mixed.map((p) => p.id)).toContain(P_BULL);
		});

		probe("an unknown wallet gets nothing", async (tx) => {
			const none = await getPortfolio("0x000000000000000000000000000000000000dead", { database: tx });
			expect(none).toEqual([]);
		});

		probe("excludes pending and failed transactions, same rule as the board", async (tx) => {
			const bob = await getPortfolio(BOB_WALLET, { database: tx });
			expect(bob.map((p) => p.id)).not.toContain(P_PENDING);
			const carol = await getPortfolio(CAROL_WALLET, { database: tx });
			expect(carol.map((p) => p.id)).not.toContain(P_FAILED);
		});
	});

	describe("getCreator", () => {
		probe("lists the creator's public posts and never a draft", async (tx) => {
			const profile = await getCreator(ALICE_WALLET, { database: tx });
			const ids = profile?.theses.map((thesis) => thesis.id) ?? [];
			expect(ids).toContain(T_BACKED);
			expect(ids).toContain(T_TEXT);
			expect(ids).not.toContain(T_DRAFT);
			expect(profile?.theses.map((t) => t.thesis.headline)).not.toContain("SECRET DRAFT");
		});

		probe("participant rows are filled positions on public theses only", async (tx) => {
			const profile = await getCreator(BOB_WALLET, { database: tx });
			const ids = profile?.positions.map((p) => p.id) ?? [];
			expect(ids).toContain(P_BULL);
			// P_DRAFT is a filled position, but on a draft thesis: its headline must
			// not reach a public profile.
			expect(ids).not.toContain(P_DRAFT);
			expect(ids).not.toContain(P_PENDING);
			expect(profile?.positions.map((p) => p.thesisHeadline)).not.toContain("SECRET DRAFT");
		});

		probe("counts every thesis the creator wrote, and their followers", async (tx) => {
			const profile = await getCreator(ALICE_WALLET, { database: tx });
			// Three of Alice's rows exist (backed, text, draft); the count is of all
			// of them, while the listing above is of the public ones.
			expect(profile?.creator.thesesCount).toBe(3);
			expect(profile?.creator.followers).toBe(0);
			expect(profile?.creator.walletAddress).toBe(ALICE_WALLET);
		});

		probe("an address that is not a wallet, or is unknown, is a miss", async (tx) => {
			expect(await getCreator("merkle_mike", { database: tx })).toBeNull();
			expect(await getCreator("0x000000000000000000000000000000000000dead", { database: tx })).toBeNull();
		});

		probe("accepts the address in any case", async (tx) => {
			const upper = await getCreator(ALICE_WALLET.toUpperCase().replace("0X", "0x"), { database: tx });
			expect(upper?.creator.walletAddress).toBe(ALICE_WALLET);
		});
	});
}
