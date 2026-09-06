/// <reference types="bun" />
/**
 * The two position tools against a real database.
 *
 * The offline suite (`positions.test.ts`) pins the arithmetic and the schema.
 * The two facts it CANNOT pin are the two that need rows:
 *
 *  1. `getUserPositions` reads the SIGNED-IN wallet's positions and only those.
 *  2. `whatIfAtExpiry` refuses a positionId that belongs to somebody else —
 *     the fence that stops a prompt-injected model valuing a stranger's fill.
 *
 * `getPortfolio` and `getPosition` take no `database` option and the tools
 * expose no seam for one, which is deliberate: there is no way for a caller to
 * point them at another connection. So these rows are COMMITTED and deleted in
 * `afterAll`, the shape `attachment.integration.test.ts` uses, rather than
 * written inside a transaction that is rolled back.
 *
 * Run it against a migrated loopback throwaway, passed on the command:
 *   cd apps/web && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/<throwaway> \
 *     bun test src/lib/agent/positions.integration.test.ts
 *
 * NO NETWORK IS NEEDED. `whatIfAtExpiry` values the position at the price the
 * caller names, and the only live input is the collateral token's USD price,
 * which `lib/thetanuts/orders.ts` answers from its own peg map before the order
 * feed is touched (`livePriceBook` fills the collateral map first). An
 * unreachable feed therefore changes `getUserPositions`'s `derivedPnlUsd` — it
 * is not asserted here — and nothing else below.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { encodeFillEventSnapshot } from "@nuts/db/fill-event-snapshot";
import type { NewPosition } from "@nuts/db/schema/index";

import { createPositionTools } from "./positions";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.log("agent positions integration skipped: DATABASE_URL is not set");
	test.skip("agent positions integration requires DATABASE_URL", () => {});
}
const describeLive = databaseUrl ? describe : describe.skip;

const CTX = { toolCallId: "test", messages: [], context: {} } as never;

/** This file's own id namespace; never a real user, wallet or fill. */
const MINE = "44440000-0000-4000-8000-0000000000a1";
const THEIRS = "44440000-0000-4000-8000-0000000000a2";
const MY_WALLET = "0x00000000000000000000000000000000feedb201";
const THEIR_WALLET = "0x00000000000000000000000000000000feedb202";
const P_MINE = "44440000-0000-4000-8000-0000000000b1";
const P_THEIRS = "44440000-0000-4000-8000-0000000000b2";

/**
 * The documented Base fill `0x9c4bb145…828f8c` replayed, exactly as
 * `lib/position/live-pnl.test.ts` carries it: an ETH 2340 put, taker BUY,
 * 999998 USDC premium. Its addresses are the real Base ones, so
 * `positionInstrument` decodes a real instrument from it and the risk model has
 * everything it needs.
 */
const ORDER_SNAPSHOT = {
	version: 1 as const,
	order: {
		maker: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
		nonce: "66204603414887816953614478114089474291546535720490116488777793285874330342942",
		price: "256458427",
		taker: "0x0000000000000000000000000000000000000000",
		expiry: "1788768000",
		option: "0x96C2c0d1d1aD8Ea8483B8294B802352363b16422",
		isBuyer: true,
		numContracts: "389926",
	},
	signature: "0x25",
	rawApiData: {
		isCall: false,
		isLong: false,
		strikes: ["234000000000"],
		priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
		collateral: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		implementation: "0x7355EB92dfb0503DB558a70c10843618932ab290",
		extraOptionData: "0x",
		maxCollateralUsable: "10000000000",
		orderExpiryTimestamp: 1788559332,
	},
	makerAddress: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
	availableAmount: "10000000000",
};

/**
 * The payoff of the fixture at $2,000, computed independently in
 * `packages/thetanuts/src/risk.ts` terms:
 *
 *   intrinsic = (2340 - 2000) * 1e8            = 34_000_000_000
 *   gross     = intrinsic * 389926 / 1e6       = 13_257_484_000
 *   premium   = 999998 * 1e8 / 1e6             =     99_999_800
 *   payoff    = gross - premium                = 13_157_484_200  ->  131.574842
 *
 * A literal, not a re-run of the code under test, so the tool changing what it
 * calls cannot move the expected value with it.
 */
const AT_2000 = "131.574842";

/**
 * A synthetic receipt, for the `positions_confirmed_fill_event_required` CHECK
 * only. Not evidence of an on-chain fill, and nothing below reads it — the same
 * placeholder `lib/data/reads.integration.test.ts` seeds.
 */
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

describeLive("the agent reads the signed-in wallet's positions, and nobody else's", () => {
	let db: typeof import("@nuts/db").db;

	beforeAll(async () => {
		if (!databaseUrl) return;
		({ db } = await import("@nuts/db"));
		const { positions, users } = await import("@nuts/db/schema/index");
		await db
			.insert(users)
			.values([
				{ id: MINE, walletAddress: MY_WALLET, displayName: "B2 probe" },
				{ id: THEIRS, walletAddress: THEIR_WALLET, displayName: "B2 stranger" },
			])
			.onConflictDoNothing();
		const row = (id: string, userId: string, walletAddress: string): NewPosition => ({
			id,
			thesisId: null,
			userId,
			walletAddress,
			role: "standalone" as const,
			side: "back" as const,
			status: "confirmed" as const,
			chainId: 8453,
			orderId: "b2-probe",
			orderSnapshot: ORDER_SNAPSHOT,
			fillEvent: FILL_EVENT,
			txHash: `0x${id.replaceAll("-", "").repeat(2)}`,
			budget: "1000000",
			budgetDecimals: 6,
			contracts: "389926",
			contractDecimals: 6,
			premium: "999998",
			premiumDecimals: 6,
			fees: "124999",
			feeDecimals: 6,
			collateral: "0",
			collateralDecimals: 6,
			breakEvenPrices: [],
			breakEvenPriceDecimals: 8,
			breakEvenPricesUsd: [],
			entryPremiumUsd: "0.999998",
			maximumLossUsd: "0.999998",
			confirmedAt: new Date(),
		});
		await db
			.insert(positions)
			.values([row(P_MINE, MINE, MY_WALLET), row(P_THEIRS, THEIRS, THEIR_WALLET)])
			.onConflictDoNothing();
	});

	afterAll(async () => {
		if (!databaseUrl) return;
		const { positions, users } = await import("@nuts/db/schema/index");
		await db.delete(positions).where(inArray(positions.id, [P_MINE, P_THEIRS]));
		await db.delete(users).where(inArray(users.id, [MINE, THEIRS]));
	});

	const mine = () => createPositionTools({ session: { userId: MINE, walletAddress: MY_WALLET } });

	test("getUserPositions returns MY position, described from its order snapshot", async () => {
		const result = (await mine().getUserPositions.execute?.({ limit: 10 }, CTX)) as unknown as {
			signedIn: boolean;
			positions: Array<Record<string, unknown>>;
			totals: { count: number; maxLossUsd: string | null };
		};
		expect(result.signedIn).toBe(true);
		const row = result.positions.find((entry) => entry["positionId"] === P_MINE);
		expect(row).toBeDefined();
		expect({
			path: row?.["path"],
			asset: row?.["asset"],
			side: row?.["side"],
			optionType: row?.["optionType"],
			direction: row?.["direction"],
			strikesUsd: row?.["strikesUsd"],
			maxLossUsd: row?.["maxLossUsd"],
			premium: row?.["premium"],
		}).toEqual({
			path: `/p/${P_MINE}`,
			asset: "ETH",
			side: "buy",
			optionType: "put",
			direction: "bear",
			strikesUsd: ["2340"],
			maxLossUsd: "0.999998",
			premium: { amount: "0.999998", token: "USDC" },
		});
		// And the stranger's fill is not in the answer at all.
		expect(result.positions.map((entry) => entry["positionId"])).not.toContain(P_THEIRS);
		expect(result.totals.count).toBe(result.positions.length);
	});

	test("whatIfAtExpiry values MY position at the price I name", async () => {
		const result = (await mine().whatIfAtExpiry.execute?.(
			{ settlementPriceUsd: "2000", positionId: P_MINE },
			CTX,
		)) as unknown as Record<string, unknown>;
		expect({
			found: result["found"],
			subject: result["subject"],
			basis: result["basis"],
			pnlUsd: result["pnlUsd"],
			maxLossUsd: result["maxLossUsd"],
		}).toEqual({
			found: true,
			subject: "position",
			basis: "at_expiry",
			pnlUsd: AT_2000,
			// From the risk model, not from the recorded column: this path values
			// the structure, it does not read `economics`.
			maxLossUsd: "0.999998",
		});
		expect(String(result["note"])).toContain("no time value");
	});

	/**
	 * THE FENCE. The id is real and the row exists; the only thing that refuses
	 * it is the wallet comparison in `whatIfAtExpiry`. Deleting that comparison
	 * makes this test the one that fails.
	 */
	test("whatIfAtExpiry refuses a position that belongs to another wallet", async () => {
		const result = (await mine().whatIfAtExpiry.execute?.(
			{ settlementPriceUsd: "2000", positionId: P_THEIRS },
			CTX,
		)) as unknown as { found: boolean; reason: string };
		expect(result.found).toBe(false);
		expect(result.reason).toContain("No position with that id");
	});

	test("...and the same answer for an id that does not exist at all", async () => {
		const result = (await mine().whatIfAtExpiry.execute?.(
			{ settlementPriceUsd: "2000", positionId: "44440000-0000-4000-8000-0000000000ff" },
			CTX,
		)) as unknown as { found: boolean; reason: string };
		expect(result.found).toBe(false);
		expect(result.reason).toContain("No position with that id");
	});

	test("the STRANGER's own session sees their fill and not mine", async () => {
		const theirs = createPositionTools({ session: { userId: THEIRS, walletAddress: THEIR_WALLET } });
		const result = (await theirs.getUserPositions.execute?.({ limit: 10 }, CTX)) as unknown as {
			positions: Array<Record<string, unknown>>;
		};
		const ids = result.positions.map((entry) => entry["positionId"]);
		expect(ids).toContain(P_THEIRS);
		expect(ids).not.toContain(P_MINE);
	});
});
