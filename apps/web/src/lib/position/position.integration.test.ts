/**
 * `lib/position/read.ts` against real Postgres, in a transaction that is always
 * rolled back. Gated on `DATABASE_URL` exactly as `reads.integration.test.ts` is,
 * so the suite still runs offline; without the variable it emits one skipped test.
 *
 * Run it against an isolated database, NEVER the shared `postgres` one:
 *   createdb position_r1 && cd packages/db &&
 *     DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/position_r1 \
 *     DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/position_r1 \
 *     bunx drizzle-kit migrate
 *   cd apps/web &&
 *     DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/position_r1 \
 *     bun test src/lib/position/position.integration.test.ts
 *
 * MIGRATION 0007. Standalone positions need `positions.thesis_id` nullable and
 * the `standalone` role, which live in the trade round's migration
 * `0007_standalone_positions` — another worktree's file, not this one's to add.
 * Until it merges, this suite applies that DDL to its OWN database, behind a
 * positive identity fence: the connection's `current_database()` must literally
 * be `position_r1`. Anywhere else the standalone cases are skipped and the rest
 * of the suite still runs. The statements are idempotent, so they are a no-op
 * once the real migration lands.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { positions, theses, users } from "@nuts/db/schema/index";
import type { NewPosition, NewThesis } from "@nuts/db/schema/index";
import { encodeFillEventSnapshot } from "@nuts/db/fill-event-snapshot";
import { orderSnapshotV1Schema } from "@nuts/db/order-snapshot";
import type { Database } from "./read";
import { readPositionDetail } from "./read";
import { positionPage } from "./view";

const databaseUrl = process.env.DATABASE_URL;

/** The one database this file is allowed to reshape. */
const OWN_DATABASE = "position_r1";

// Deterministic ids in this file's own namespace; never real.
const ALICE = "44440000-0000-4000-8000-000000000001";
const BOB = "44440000-0000-4000-8000-000000000002";
const ALICE_WALLET = "0x00000000000000000000000000000000feed2001";
const BOB_WALLET = "0x00000000000000000000000000000000feed2002";
const T_BACKED = "55550000-0000-4000-8000-000000000001";
const P_CREATOR = "66660000-0000-4000-8000-000000000001";
const P_PENDING = "66660000-0000-4000-8000-000000000002";
const P_FAILED = "66660000-0000-4000-8000-000000000003";
const P_STANDALONE = "66660000-0000-4000-8000-000000000004";
const UNKNOWN = "66660000-0000-4000-8000-0000000000ff";

const EXPIRY = new Date("2026-09-11T08:00:00.000Z");
/** 2026-09-11T08:00:00Z in seconds. */
const EXPIRY_SECONDS = "1789113600";

// SDK-measured Base mainnet addresses (getChainConfigById(8453) and its
// optionImplementations map), so the instrument resolves the way production does.
const PUT_IMPL = "0xf480f636301d50ed570d026254dc5728b746a90f";
const ABASUSDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";
const BTC_FEED = "0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f";

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

/**
 * Synthetic maker order for tests only; not a real signed order. `rawApiData`
 * carries the fields `positionInstrument` reads: a taker-BUY (maker `isLong`)
 * 78,000 BTC put collateralised in aBasUSDC.
 */
const ORDER_SNAPSHOT = orderSnapshotV1Schema.parse({
	version: 1,
	order: {
		maker: "0xmaker",
		taker: "0xtaker",
		option: "0xoption",
		isBuyer: false,
		numContracts: "10000",
		price: "1",
		expiry: EXPIRY_SECONDS,
		nonce: "1",
	},
	signature: "0x",
	availableAmount: "0",
	makerAddress: "0xmaker",
	rawApiData: {
		collateral: ABASUSDC,
		priceFeed: BTC_FEED,
		implementation: PUT_IMPL,
		strikes: ["7800000000000"],
		isCall: false,
		isLong: true,
		orderExpiryTimestamp: 1789113600,
		extraOptionData: "0x",
		maxCollateralUsable: "1000000",
	},
});

const STRUCTURE = {
	taggedAsset: "BTC",
	underlyingAsset: "BTC",
	direction: "bull",
	expiryAt: EXPIRY,
	productType: "put",
	isCall: false,
	isLong: true,
	strikes: ["7800000000000"],
	strikeDecimals: 8,
	collateralAddress: ABASUSDC,
	collateralSymbol: "aBasUSDC",
	collateralDecimals: 6,
	creatorOrderSnapshot: ORDER_SNAPSHOT,
} satisfies Partial<NewThesis>;

function position(
	overrides: Partial<NewPosition> & { id: string; userId: string; walletAddress: string },
): NewPosition {
	const confirmed = overrides.status === undefined || overrides.status === "confirmed";
	return {
		thesisId: T_BACKED,
		role: "participant",
		side: "back",
		status: "confirmed",
		chainId: 8453,
		orderId: "o",
		orderSnapshot: ORDER_SNAPSHOT,
		fillEvent: confirmed ? FILL_EVENT : null,
		txHash: `0x${overrides.id.replaceAll("-", "").repeat(2)}`,
		// 0.05 aBasUSDC premium, 0.01 contracts, 780 aBasUSDC collateral.
		budget: "1000000",
		budgetDecimals: 6,
		contracts: "10000",
		contractDecimals: 6,
		premium: "50000",
		premiumDecimals: 6,
		fees: "0",
		feeDecimals: 6,
		collateral: "780000000",
		collateralDecimals: 6,
		breakEvenPrices: [],
		breakEvenPriceDecimals: 8,
		breakEvenPricesUsd: [],
		confirmedAt: confirmed ? new Date() : null,
		...overrides,
	};
}

if (!databaseUrl) {
	console.log("position integration skipped: DATABASE_URL is not set");
	test.skip("position read requires DATABASE_URL", () => {});
} else {
	const { db } = await import("@nuts/db");

	const [current] = await db.execute<{ name: string }>(
		sql`select current_database() as name`,
	).then((result) => (Array.isArray(result) ? result : result.rows));
	const databaseName = current?.name ?? "";
	// Positive identity fence: reshape only the database this file owns.
	const ownsDatabase = databaseName === OWN_DATABASE;

	const [role] = await db.execute<{ present: boolean }>(sql`
		select exists (
			select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
			where t.typname = 'position_role' and e.enumlabel = 'standalone'
		) as present
	`).then((result) => (Array.isArray(result) ? result : result.rows));
	let standaloneSupported = role?.present === true;

	if (!standaloneSupported && ownsDatabase) {
		// `ALTER TYPE ... ADD VALUE` and a use of the new literal cannot share one
		// transaction, so these run as separate statements, exactly as migration
		// 0007 does.
		await db.execute(sql`ALTER TYPE "public"."position_role" ADD VALUE IF NOT EXISTS 'standalone'`);
		await db.execute(sql`ALTER TABLE "positions" ALTER COLUMN "thesis_id" DROP NOT NULL`);
		await db.execute(sql`
			DO $$ BEGIN
				ALTER TABLE "positions" ADD CONSTRAINT "positions_thesis_role_consistent"
					CHECK (("positions"."thesis_id" is null) = ("positions"."role"::text = 'standalone'));
			EXCEPTION WHEN duplicate_object THEN NULL; END $$
		`);
		standaloneSupported = true;
	}

	async function seed(tx: Database): Promise<void> {
		await tx.insert(users).values([
			{ id: ALICE, walletAddress: ALICE_WALLET, displayName: "Alice Probe", handle: "alice_probe" },
			{ id: BOB, walletAddress: BOB_WALLET, displayName: null },
		]);
		await tx.insert(theses).values([
			{
				id: T_BACKED,
				slug: "backed-post-5555",
				creatorUserId: ALICE,
				headline: "BTC bleeds after NFP",
				rationale: "why",
				status: "open",
				publishedAt: new Date(),
				...STRUCTURE,
			},
		] as NewThesis[]);
		const rows: NewPosition[] = [
			position({
				id: P_CREATOR,
				userId: ALICE,
				walletAddress: ALICE_WALLET,
				role: "creator",
				entryPremiumUsd: "500.00",
				maximumLossUsd: "500.00",
				maximumPayoutUsd: "2300.00",
				estimatedPnlUsd: "25.00",
			}),
			position({ id: P_PENDING, userId: BOB, walletAddress: BOB_WALLET, status: "pending" }),
			position({ id: P_FAILED, userId: BOB, walletAddress: BOB_WALLET, status: "failed" }),
		];
		await tx.insert(positions).values(rows);
		if (standaloneSupported) {
			// Raw SQL, not `tx.insert`: `NewPosition` in THIS tree still types
			// `thesis_id` as NOT NULL and `role` without `standalone`, because the
			// schema widening travels with migration 0007 in the trade round's
			// worktree. Writing the row through the query builder would need a cast
			// that lies about the current types; the statement below states exactly
			// what the widened table accepts, and drizzle's own types cover it again
			// once 0007 merges.
			await tx.execute(sql`
				insert into positions (
					id, thesis_id, user_id, role, side, status, chain_id, wallet_address,
					order_id, order_snapshot, fill_event, tx_hash,
					budget, budget_decimals, contracts, contract_decimals,
					premium, premium_decimals, fees, fee_decimals,
					collateral, collateral_decimals,
					break_even_prices, break_even_price_decimals, break_even_prices_usd,
					confirmed_at
				) values (
					${P_STANDALONE}, null, ${BOB}, 'standalone', 'back', 'confirmed', 8453, ${BOB_WALLET},
					'o', ${JSON.stringify(ORDER_SNAPSHOT)}::jsonb, ${JSON.stringify(FILL_EVENT)}::jsonb,
					${`0x${P_STANDALONE.replaceAll("-", "").repeat(2)}`},
					1000000, 6, 10000, 6,
					50000, 6, 0, 6,
					780000000, 6,
					'{}'::numeric[], 8, '{}'::numeric[],
					now()
				)
			`);
		}
		await tx.update(theses).set({ creatorPositionId: P_CREATOR }).where(sql`${theses.id} = ${T_BACKED}`);
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

	describe("readPositionDetail", () => {
		probe("a position on a post carries the post and its owner", async (tx) => {
			const detail = await readPositionDetail(P_CREATOR, { database: tx });
			expect(detail).not.toBeNull();
			expect(detail?.position.id).toBe(P_CREATOR);
			expect(detail?.position.role).toBe("creator");
			expect(detail?.position.thesisId).toBe(T_BACKED);
			expect(detail?.thesis).toEqual({ slug: "backed-post-5555", headline: "BTC bleeds after NFP" });
			expect(detail?.owner.handle).toBe("alice_probe");
			expect(detail?.position.walletAddress).toBe(ALICE_WALLET);
		});

		probe("the instrument comes out of the position's own order snapshot", async (tx) => {
			const detail = await readPositionDetail(P_CREATOR, { database: tx });
			expect(detail?.instrument?.asset).toBe("BTC");
			expect(detail?.instrument?.riskKind).toBe("put");
			expect(detail?.instrument?.takerSide).toBe("buy");
			expect(detail?.instrument?.collateralSymbol).toBe("aBasUSDC");
			// contracts 10000 base units at 6 decimals = 0.01
			expect(detail?.position.contracts).toBe("0.01");
			expect(detail?.quantities).toEqual({
				contracts: "10000",
				contractDecimals: 6,
				premium: "50000",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "780000000",
				collateralDecimals: 6,
			});
		});

		probe("a pending transaction is visible on its own page, and is not a P&L", async (tx) => {
			const detail = await readPositionDetail(P_PENDING, { database: tx });
			expect(detail).not.toBeNull();
			expect(detail?.position.status).toBe("pending");
			const page = positionPage({
				detail: detail!,
				spotUsd8: "7400000000000",
				collateralUsdPrice8: "100000000",
				asOf: new Date("2026-09-05T06:00:00.000Z"),
			});
			expect(page.card.pnl.signed2).toBe("—");
			expect(page.card.statusLabel).toBe("Pending");
			expect(page.card.pnlBasisLabel).toContain("not been confirmed");
		});

		probe("a failed transaction is visible and says it is not a position", async (tx) => {
			const detail = await readPositionDetail(P_FAILED, { database: tx });
			expect(detail?.position.status).toBe("failed");
			const page = positionPage({
				detail: detail!,
				spotUsd8: "7400000000000",
				collateralUsdPrice8: "100000000",
				asOf: new Date("2026-09-05T06:00:00.000Z"),
			});
			expect(page.card.pnlBasisLabel).toBe("This transaction failed, so there is no position.");
			expect(page.card.verified).toBe(false);
		});

		probe("an unknown id is null, and a non-uuid never reaches the database", async (tx) => {
			expect(await readPositionDetail(UNKNOWN, { database: tx })).toBeNull();
			expect(await readPositionDetail("not-a-uuid", { database: tx })).toBeNull();
			expect(await readPositionDetail("", { database: tx })).toBeNull();
			// A SQL fragment must be refused by the shape check, not escaped later.
			expect(await readPositionDetail("'; drop table positions; --", { database: tx })).toBeNull();
		});

		probe("the recorded estimate is what the card shows, unchanged", async (tx) => {
			const detail = await readPositionDetail(P_CREATOR, { database: tx });
			const page = positionPage({
				detail: detail!,
				spotUsd8: "7400000000000",
				collateralUsdPrice8: "100000000",
				asOf: new Date("2026-09-05T06:00:00.000Z"),
			});
			expect(page.card.pnl.signed2).toBe("+$25.00");
			expect(page.card.basis).toBe("estimate");
			expect(page.card.stats).toEqual([
				{ label: "Premium paid", value: "$500.00" },
				{ label: "Max loss", value: "$500.00" },
				{ label: "Max payout", value: "$2,300.00" },
			]);
			// 25 / 500 = 5%
			expect(page.card.pnlPctLabel).toBe("+5.0% of max loss");
			expect(page.marketSlug).toBe("btc");
			expect(page.thesis?.slug).toBe("backed-post-5555");
		});

		probe("with no recorded estimate the P&L is derived from the raw units", async (tx) => {
			await tx.execute(sql`update positions set estimated_pnl_usd = null, maximum_loss_usd = null, maximum_payout_usd = null, entry_premium_usd = null where id = ${P_CREATOR}`);
			const detail = await readPositionDetail(P_CREATOR, { database: tx });
			const page = positionPage({
				detail: detail!,
				spotUsd8: "7400000000000",
				collateralUsdPrice8: "100000000",
				asOf: new Date("2026-09-05T06:00:00.000Z"),
			});
			// intrinsic 7800000000000 - 7400000000000 = 400000000000
			// gross     400000000000 * 10000 / 10^6   = 4000000000
			// long      4000000000 - 5000000          = 3995000000 = $39.95
			expect(page.card.pnl.signed2).toBe("+$39.95");
			expect(page.card.basis).toBe("derived");
			// maxPayout(long put) = 7800000000000 * 10000/10^6 - 5000000 = 77995000000
			expect(page.card.stats[2]).toEqual({ label: "Max payout", value: "$779.95" });
		});
	});

	describe("standalone positions (migration 0007)", () => {
		if (!standaloneSupported) {
			test.skip(`standalone cases need migration 0007; this database is "${databaseName}"`, () => {});
		} else {
			probe("a standalone fill belongs to no post", async (tx) => {
				const detail = await readPositionDetail(P_STANDALONE, { database: tx });
				expect(detail).not.toBeNull();
				expect(detail?.position.role).toBe("standalone");
				expect(detail?.position.thesisId).toBeNull();
				expect(detail?.position.thesisSlug).toBeNull();
				expect(detail?.position.thesisHeadline).toBeNull();
				expect(detail?.thesis).toBeNull();
				// The ticker comes from the order's own price feed, not from a post.
				expect(detail?.position.underlyingAsset).toBe("BTC");
			});

			probe("its page still names the market and the structure", async (tx) => {
				const detail = await readPositionDetail(P_STANDALONE, { database: tx });
				const page = positionPage({
					detail: detail!,
					spotUsd8: "7400000000000",
					collateralUsdPrice8: "100000000",
					asOf: new Date("2026-09-05T06:00:00.000Z"),
				});
				expect(page.thesis).toBeNull();
				expect(page.marketSlug).toBe("btc");
				expect(page.structureId).toMatch(/^[0-9a-f]{16}$/);
				// Round-1 fold item 9: the card splits the instrument the way the
				// mockup draws it — title, strikes sub-line, expiry chip.
				expect(page.card.instrumentLabel).toBe("BTC put");
				expect(page.card.strikesLabel).toBe("78,000 P");
				expect(page.card.expiryLabel).toBe("11 Sep");
				expect(page.card.pnl.signed2).toBe("+$39.95");
			});

			probe("the 0007 CHECK ties thesis_id and role together in both directions", async (tx) => {
				// A standalone row with a thesis, and a participant row without one,
				// must both be refused. Each attempt gets its own savepoint so the
				// failure does not poison the outer transaction.
				await expect(
					tx.transaction(async (inner) => {
						await inner.execute(sql`update positions set thesis_id = ${T_BACKED} where id = ${P_STANDALONE}`);
					}),
				).rejects.toThrow();
				await expect(
					tx.transaction(async (inner) => {
						await inner.execute(sql`update positions set thesis_id = null where id = ${P_PENDING}`);
					}),
				).rejects.toThrow();
			});
		}
	});
}
