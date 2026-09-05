/**
 * C6. The post-fill share card must never fail the recording.
 *
 * `fillCard` runs AFTER the confirming transaction commits. Before the fold, a
 * throw there rejected the whole server action: the browser returned to idle
 * with no position id, and the next "Trade" click sent a SECOND fill against a
 * fill that had already happened on chain. The row is durable and the money is
 * already spent by that point, so the only correct behaviour is to return the
 * position and leave the card null.
 *
 * The card builder is replaced with one that throws — the failure mode itself,
 * rather than a proxy for it. It lives in its own file because `mock.module`
 * is process-wide and must be installed before `record.ts` is imported.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;
const describeLive = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
	console.log("record card integration skipped: DATABASE_URL is not set");
}

describeLive("C6: the share card never fails the recording", () => {
	// Bound in beforeAll so the mock is installed before record.ts loads.
	let recordTradeFor: typeof import("./record").recordTradeFor;
	let deps: {
		db: typeof import("@nuts/db").db;
		positions: typeof import("@nuts/db/schema/index").positions;
		activity: typeof import("@nuts/db/schema/index").activity;
		loadProductionFill: typeof import("./production-fills").loadProductionFill;
		PRODUCTION_FILLS: typeof import("./production-fills").PRODUCTION_FILLS;
		encodeTradeTicket: typeof import("./ticket").encodeTradeTicket;
		createOrFetchUser: typeof import("@/lib/auth/store").createOrFetchUser;
		publicClient: typeof import("./chain").publicClient;
		structureIdOf: typeof import("@/lib/market/structures").structureIdOf;
	};

	beforeAll(async () => {
		const display = await import("@/lib/display");
		mock.module("@/lib/display", () => ({
			...display,
			pnlCard: () => {
				throw new Error("card builder exploded");
			},
		}));
		recordTradeFor = (await import("./record")).recordTradeFor;
		const schema = await import("@nuts/db/schema/index");
		deps = {
			db: (await import("@nuts/db")).db,
			positions: schema.positions,
			activity: schema.activity,
			loadProductionFill: (await import("./production-fills")).loadProductionFill,
			PRODUCTION_FILLS: (await import("./production-fills")).PRODUCTION_FILLS,
			encodeTradeTicket: (await import("./ticket")).encodeTradeTicket,
			createOrFetchUser: (await import("@/lib/auth/store")).createOrFetchUser,
			publicClient: (await import("./chain")).publicClient,
			structureIdOf: (await import("@/lib/market/structures")).structureIdOf,
		};
	});

	test("a throwing card builder yields card: null, never a rejected action", async () => {
		const expectation = deps.PRODUCTION_FILLS.find((fill) => fill.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await deps.loadProductionFill(expectation.hash);
		const input = (await deps.publicClient().getTransaction({ hash: expectation.hash })).input;
		const user = await deps.createOrFetchUser(deps.db, fill.taker);
		const raw = fill.snapshot.rawApiData;
		if (!raw) throw new Error("no rawApiData");
		const txHash = `0x${randomBytes(32).toString("hex")}`;

		const ticket = {
			v: 1 as const,
			userId: user.id,
			wallet: fill.taker,
			chainId: 8453 as const,
			structureId: deps.structureIdOf({
				priceFeed: raw.priceFeed,
				implementationAddress: raw.implementation,
				collateralAddress: raw.collateral,
				strikes: raw.strikes,
				expiry: fill.order.order.expiry,
				isCall: raw.isCall,
			}),
			instrumentLabel: "fixture instrument",
			side: "bull" as const,
			taker: "buy" as const,
			thesisId: null,
			role: "standalone" as const,
			positionSide: "back" as const,
			optionBook: "0x1bDff855d6811728acaDC00989e79143a2bdfDed",
			budget: expectation.premium.toString(),
			collateralAddress: raw.collateral,
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			expectedContracts: expectation.numContracts.toString(),
			expectedPremium: expectation.premium.toString(),
			expectedFee: expectation.fee.toString(),
			expectedCollateral: expectation.takerCollateral.toString(),
			maxLossUsd8: null,
			maxPayoutUsd8: null,
			breakEvenUsd8: null,
			orderSnapshot: fill.snapshot,
			issuedAt: Math.floor(Date.now() / 1000),
		};

		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: deps.encodeTradeTicket(ticket), txHash },
			{
				waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
				getTransaction: async () => ({ to: "0x1bDff855d6811728acaDC00989e79143a2bdfDed", input }),
			},
		);

		// The action SUCCEEDS: the fill is real and already recorded.
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("the card must not fail the recording");
		expect(result.status).toBe("confirmed");
		expect(result.positionId).toBeTruthy();
		expect(result.txHash).toBe(txHash);
		// The card is the only thing lost.
		expect(result.card).toBeNull();
		// The row is durable and carries the chain's economics.
		const [row] = await deps.db.select().from(deps.positions).where(eq(deps.positions.id, result.positionId));
		expect(row?.status).toBe("confirmed");
		expect(row?.premium).toBe(expectation.premium.toString());

		await deps.db.delete(deps.activity).where(eq(deps.activity.positionId, result.positionId));
		await deps.db.delete(deps.positions).where(eq(deps.positions.id, result.positionId));
	}, 60_000);
});
