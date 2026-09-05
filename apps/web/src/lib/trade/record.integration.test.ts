import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import type { Log } from "viem";
import { db } from "@nuts/db";
import { positions, theses, users, activity } from "@nuts/db/schema/index";
import { deriveSlug } from "@nuts/db/slug";
import { createOrFetchUser } from "@/lib/auth/store";
import { formatBaseUnits } from "@/lib/market/units";
import { structureIdOf } from "@/lib/market/structures";
import { prepareTradeFor } from "./prepare";
import { recordTradeFor, type ChainReader } from "./record";
import { encodeTradeTicket, decodeTradeTicket, type TradeTicketPayload } from "./ticket";
import { loadProductionFill, PRODUCTION_FILLS, type LoadedFill } from "./production-fills";
import { publicClient } from "./chain";

/**
 * These run against the writer's own throwaway database `trade_r1` and replay
 * real Base mainnet transactions over read-only RPC. No transaction is sent.
 *
 * The two production fills are the ones decoded in
 * `.research/thetanuts/finding-fill-debits.md`; the taker address is taken from
 * each fill's own `OrderFilled` log and used as the test session, which is the
 * only way the wallet fence can pass for someone else's transaction.
 */

/**
 * This suite owns its throwaway database (`trade_r1`) and replays two fixed
 * mainnet hashes, which `positions_chain_id_tx_hash_unique` allows only once.
 * Starting from empty tables is what makes a re-run mean the same thing as the
 * first run.
 */
/**
 * Gated on `DATABASE_URL` like every other integration file, so the offline
 * suite (`DATABASE_URL='' SKIP_ENV_VALIDATION=1 bun test`) skips instead of
 * dereferencing a client that was never created.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.log("trade record integration skipped: DATABASE_URL is not set");
	test.skip("trade record integration requires DATABASE_URL", () => {});
}
const describeLive = databaseUrl ? describe : describe.skip;

beforeAll(async () => {
	if (!databaseUrl) return;
	await db.delete(activity);
	await db.update(theses).set({ creatorPositionId: null });
	await db.delete(positions);
	await db.delete(theses);
});

async function seedUser(address: string) {
	return createOrFetchUser(db, address);
}

/** An open, structured post, so the participant path has something to attach to. */
async function seedThesis(creatorUserId: string, fill: LoadedFill) {
	const raw = fill.order.rawApiData;
	if (!raw) throw new Error("no raw order");
	const id = randomUUID();
	const headline = `Test post ${id.slice(0, 8)}`;
	const [row] = await db
		.insert(theses)
		.values({
			id,
			slug: deriveSlug(headline, id),
			creatorUserId,
			headline,
			status: "open",
			publishedAt: new Date(),
			taggedAsset: "BTC",
			direction: fill.takerSide === "buy" ? "bull" : "bear",
			underlyingAsset: "BTC",
			expiryAt: new Date(Number(fill.order.order.expiry) * 1000),
			productType: "physical put",
			isCall: raw.isCall,
			isLong: fill.takerSide === "buy",
			strikes: raw.strikes,
			strikeDecimals: 8,
			collateralAddress: raw.collateral,
			collateralSymbol: "USDC",
			collateralDecimals: 6,
			creatorOrderSnapshot: fill.snapshot,
		})
		.returning();
	if (!row) throw new Error("could not seed thesis");
	return row;
}

function ticketFor(input: {
	fill: LoadedFill;
	userId: string;
	thesisId: string | null;
	role: "creator" | "participant" | "standalone";
	collateralSymbol: string;
	collateralDecimals: number;
	contractSizeDecimals: number;
	contracts: bigint;
	premium: bigint;
	fee: bigint;
	collateral: bigint;
}): TradeTicketPayload {
	const raw = input.fill.order.rawApiData;
	if (!raw) throw new Error("no raw order");
	return {
		v: 1,
		userId: input.userId,
		wallet: input.fill.taker,
		chainId: 8453,
		structureId: structureIdOf({
			priceFeed: raw.priceFeed,
			implementationAddress: raw.implementation,
			collateralAddress: raw.collateral,
			isCall: raw.isCall,
			strikes: raw.strikes.map((strike) => BigInt(strike)),
			expiry: input.fill.order.order.expiry,
		}),
		instrumentLabel: "BTC physical put",
		side: input.fill.takerSide === "buy" ? "bull" : "bear",
		taker: input.fill.takerSide,
		thesisId: input.thesisId,
		role: input.role,
		positionSide: input.fill.takerSide === "buy" ? "back" : "counter",
		optionBook: "0x1bDff855d6811728acaDC00989e79143a2bdfDed",
		budget: (input.collateral === 0n ? input.premium : input.collateral).toString(),
		collateralAddress: raw.collateral,
		collateralSymbol: input.collateralSymbol,
		collateralDecimals: input.collateralDecimals,
		contractSizeDecimals: input.contractSizeDecimals,
		expectedContracts: input.contracts.toString(),
		expectedPremium: input.premium.toString(),
		expectedFee: input.fee.toString(),
		expectedCollateral: input.collateral.toString(),
		maxLossUsd8: null,
		maxPayoutUsd8: null,
		breakEvenUsd8: null,
		orderSnapshot: input.fill.snapshot,
		issuedAt: Math.floor(Date.now() / 1000),
	};
}

/**
 * Removes a position and anything referencing it. A confirmed position has an
 * `activity` row (`activity_position_id_positions_id_fk`), so deleting the
 * position alone fails.
 */
async function dropPosition(positionId: string | undefined): Promise<void> {
	if (!positionId) return;
	await db.delete(activity).where(eq(activity.positionId, positionId));
	await db.delete(positions).where(eq(positions.id, positionId));
}

describeLive("recordTrade cross-checks every number against the chain", () => {
	test("a contract count that does not reproduce the emitted premium is not confirmed", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			// One contract unit too many: the premium the OptionBook emitted can no
			// longer be reproduced from it.
			contracts: expectation.numContracts + 1n,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});

		// C-m5. This test used to point the ticket at OptionBook 0x…01, so the
		// fill was never found and RECONCILIATION WAS NEVER EXERCISED. The real
		// OptionBook is used now, so the wrong contract count reaches
		// `contractsFrom` and the decoded calldata is what refuses it.
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		// The transaction IS a direct `fillOrder`, so the decoded count (which is
		// correct) is used and reproduces the premium — the wrong ticket count is
		// simply never consulted, and the stored count is the chain's.
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		const [confirmed] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(confirmed?.contracts).toBe(expectation.numContracts.toString());
		expect(confirmed?.contracts).not.toBe((expectation.numContracts + 1n).toString());
		await dropPosition(result.positionId);

		// And when the calldata CANNOT be read as a direct fill (a smart wallet's
		// batch), the ticket's count is used — and a count that does not
		// reproduce the emitted premium is refused rather than stored.
		const indirect: ChainReader = {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => ({ to: "0x00000000000000000000000000000000000000ff", input: "0x" }),
		};
		const refused = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
			indirect,
		);
		expect(refused).toMatchObject({ ok: false, code: "FILL_DOES_NOT_MATCH" });
		const [row] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("filled_order_differs_from_prepared");
		await dropPosition(row?.id);

		// The same indirect route with the RIGHT count is accepted, so the
		// refusal above is the count and not the route.
		const good = { ...ticket, expectedContracts: expectation.numContracts.toString() };
		const accepted = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(good), txHash: fill.hash },
			indirect,
		);
		expect(accepted.ok).toBe(true);
		if (!accepted.ok) throw new Error("unreachable");
		await dropPosition(accepted.positionId);
	}, 60_000);

	test("a collateral that does not match the debit measured on chain is not confirmed", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "sell");
		if (expectation === undefined) throw new Error("no sell fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			// One base unit off the 22,000,000 the wallet actually sent.
			collateral: expectation.takerCollateral + 1n,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result).toMatchObject({ ok: false, code: "DEBIT_MISMATCH" });
		if (result.ok) throw new Error("unreachable");
		console.log(`[debit fence] ${result.reason}`);
		const [row] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		// C2: refused rows are `failed`, not `pending`.
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("debit_differs_from_prepared");
		expect(row?.confirmedAt).toBeNull();
		await dropPosition(row?.id);
	}, 60_000);

	test("a fill that belongs to another wallet is refused", async () => {
		// A third decoded fill, so the two fixtures above stay untouched.
		const hash = "0x2d2fc8c7158e2b8dc102dd35c12771bdfec4994f9a287bb2053bb91e9ba3206b" as const;
		const fill = await loadProductionFill(hash);
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: "USDC",
			collateralDecimals: 6,
			contractSizeDecimals: 6,
			contracts: 1n,
			premium: 1n,
			fee: 0n,
			collateral: 0n,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ token: encodeTradeTicket({ ...ticket, wallet }), txHash: hash },
		);
		// The OrderFilled log names the real taker, not this wallet.
		expect(result).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });
		expect(fill.taker).not.toBe(wallet);
	}, 60_000);
});

describeLive("recordTrade against decoded Base production fills", () => {
	test("taker BUY 0x9c4bb1… is stored with the economics the chain shows, as a participant", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const thesis = await seedThesis(user.id, fill);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: thesis.id,
			role: "participant",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("confirmed");

		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		if (!row) throw new Error("no stored position");
		expect(BigInt(row.contracts)).toBe(expectation.numContracts);
		expect(BigInt(row.premium)).toBe(expectation.premium);
		expect(BigInt(row.fees)).toBe(expectation.fee);
		expect(BigInt(row.collateral)).toBe(expectation.takerCollateral);
		expect(row.status).toBe("confirmed");
		expect(row.confirmedAt).not.toBeNull();
		expect(row.fillEvent?.premiumAmount).toBe(expectation.premium.toString());
		expect(row.optionAddress?.toLowerCase()).toBe(fill.event.optionAddress.toLowerCase());
		expect(row.role).toBe("participant");
		expect(row.thesisId).toBe(thesis.id);
		// max loss on a long option is exactly the premium.
		expect(row.maximumLoss === null ? null : BigInt(row.maximumLoss)).toBe(expectation.premium);
		expect(row.entryPremiumUsd).toBe(formatBaseUnits(expectation.premium * 100n, 8));

		const events = await db.select().from(activity).where(eq(activity.positionId, row.id));
		expect(events.map((event) => event.eventType)).toEqual(["position_confirmed"]);

		console.log(
			[
				`[record buy ${fill.hash.slice(0, 12)}] stored`,
				`  contracts ${row.contracts} (decoded ${expectation.numContracts})`,
				`  premium   ${row.premium} = ${formatBaseUnits(BigInt(row.premium), 6)} USDC (decoded ${expectation.premium})`,
				`  fees      ${row.fees} (decoded ${expectation.fee})`,
				`  collateral ${row.collateral} (decoded ${expectation.takerCollateral})`,
				`  entry premium USD ${row.entryPremiumUsd}`,
				`  max loss  ${row.maximumLoss} = premium`,
			].join("\n"),
		);
	}, 60_000);

	test("taker SELL 0xdf3323… is stored standalone, with the collateral the chain measured", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "sell");
		if (expectation === undefined) throw new Error("no sell fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("confirmed");
		expect(result.thesisId).toBeNull();

		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		if (!row) throw new Error("no stored position");
		expect(row.role).toBe("standalone");
		expect(row.thesisId).toBeNull();
		expect(BigInt(row.contracts)).toBe(expectation.numContracts);
		expect(BigInt(row.premium)).toBe(expectation.premium);
		expect(BigInt(row.fees)).toBe(expectation.fee);
		// The taker's collateral is the debit measured from the token's Transfer
		// logs, not a formula: strike x contracts / 1e8 = 22,000,000.
		expect(BigInt(row.collateral)).toBe(expectation.takerCollateral);
		// A short position's loss reaches the collateral, less the premium kept.
		expect(row.maximumLoss === null ? null : BigInt(row.maximumLoss)).toBe(
			expectation.takerCollateral - (expectation.premium - expectation.fee),
		);
		expect(row.maximumPayout === null ? null : BigInt(row.maximumPayout)).toBe(
			expectation.premium - expectation.fee,
		);
		// Round-1 fold item 16: the dialog's card IS `View.PnlCard`, so the tiles
		// are the shared set and the money is USD at the collateral's peg.
		expect(result.card?.stats[0]?.label).toBe("Collateral locked");
		expect(result.card?.stats[0]?.value).toBe("$22.00");
		expect(result.card?.owner.initials.length).toBeGreaterThan(0);
		expect(result.card?.dateLabel).toMatch(/^\d{1,2} \w{3} \d{4}$/);
		console.log(
			[
				`[record sell ${fill.hash.slice(0, 12)}] stored standalone`,
				`  contracts ${row.contracts}`,
				`  premium   ${row.premium} fees ${row.fees}`,
				`  collateral ${row.collateral} = ${formatBaseUnits(BigInt(row.collateral), 6)} aBasUSDC`,
				`  max loss  ${row.maximumLoss}  max payout ${row.maximumPayout}`,
				`  share card tiles: ${result.card?.stats.map((t: { label: string; value: string }) => `${t.label}=${t.value}`).join(", ")}`,
			].join("\n"),
		);
	}, 60_000);

	test("a second call with the same hash is idempotent, not a second position", async () => {
		const expectation = PRODUCTION_FILLS.find((f) => f.takerSide === "buy");
		if (expectation === undefined) throw new Error("no buy fixture");
		const fill = await loadProductionFill(expectation.hash);
		const user = await seedUser(fill.taker);
		const [existing] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		if (!existing) throw new Error("the first test must have stored it");
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: existing.thesisId,
			role: "participant",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash: fill.hash },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.positionId).toBe(existing.id);
		const rows = await db
			.select({ total: sql<string>`count(*)` })
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, fill.hash)));
		expect(rows[0]?.total).toBe("1");
	}, 60_000);
});

/**
 * C1, C2, C3 — the money-path fences the one-shot review found open. Every case
 * replays a REAL decoded Base fill and changes exactly one thing.
 */
describeLive("money-path fences (C1 receipt binding, C2 hash squatting, C3 ticket binding)", () => {
	/**
	 * Every case here replays the REAL logs and the REAL `fillOrder` calldata of
	 * a decoded mainnet fill, but under its OWN synthetic transaction hash.
	 *
	 * That matters: the suite above stores a permanent row for the production
	 * hash (its idempotency case depends on it), and nothing in `record.ts`
	 * derives economics from the hash itself — the receipt's logs and the
	 * transaction's calldata are the evidence. Synthetic hashes therefore make
	 * these cases independent of each other and of that stored row, without
	 * weakening a single check.
	 */
	async function loadFixture(side: "buy" | "sell", hash?: `0x${string}`) {
		const expectation = hash
			? PRODUCTION_FILLS.find((f) => f.hash === hash)
			: PRODUCTION_FILLS.find((f) => f.takerSide === side);
		if (expectation === undefined) throw new Error(`no ${side} fixture`);
		const fill = await loadProductionFill(expectation.hash);
		const input = (await publicClient().getTransaction({ hash: expectation.hash })).input;
		const user = await seedUser(fill.taker);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		return { expectation, fill, user, ticket, input, txHash: `0x${randomBytes(32).toString("hex")}` };
	}

	const buyFixture = () => loadFixture("buy");

	/** The real receipt AND the real direct `fillOrder` calldata. */
	function directReader(fill: LoadedFill, input: `0x${string}`): ChainReader {
		return {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => ({ to: "0x1bDff855d6811728acaDC00989e79143a2bdfDed", input }),
		};
	}

	/** The real receipt, with the top-level call hidden (a smart wallet's batch). */
	function indirectReader(fill: LoadedFill): ChainReader {
		return {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => ({ to: "0x00000000000000000000000000000000000000ff", input: "0x" }),
		};
	}

	test("C1: a snapshot naming a DIFFERENT maker is refused even though the premium reproduces", async () => {
		const { fill, user, ticket, txHash } = await buyFixture();
		// Only the maker changes. The premium, the contract count and the wallet
		// are the real ones, so the pre-fold code would have accepted this: the
		// event was bound to our wallet alone and the ticket count reproduced the
		// emitted premium.
		const impostor = "0x00000000000000000000000000000000deadbeef";
		const snapshot = {
			...ticket.orderSnapshot,
			makerAddress: impostor,
			order: { ...ticket.orderSnapshot.order, maker: impostor },
		} as typeof ticket.orderSnapshot;
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: snapshot }), txHash },
			indirectReader(fill),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(row?.status).toBe("failed");
		await dropPosition(row?.id);
	}, 60_000);

	test("C1: a snapshot with a DIFFERENT nonce is refused", async () => {
		const { fill, user, ticket, txHash } = await buyFixture();
		const snapshot = {
			...ticket.orderSnapshot,
			order: { ...ticket.orderSnapshot.order, nonce: (BigInt(ticket.orderSnapshot.order.nonce) + 1n).toString() },
		} as typeof ticket.orderSnapshot;
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: snapshot }), txHash },
			indirectReader(fill),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		await dropPosition(row?.id);
	}, 60_000);

	test("C1: a DIFFERENT strike in the snapshot is refused by the decoded calldata", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		const raw = ticket.orderSnapshot.rawApiData;
		if (!raw) throw new Error("fixture snapshot has no rawApiData");
		const snapshot = {
			...ticket.orderSnapshot,
			rawApiData: { ...raw, strikes: raw.strikes.map((strike) => (BigInt(strike) + 100_000_000n).toString()) },
		} as typeof ticket.orderSnapshot;
		// The transaction IS a direct `fillOrder`, so the decoded order is
		// compared field by field; the premium still reproduces, which is exactly
		// the case that used to fall through and be accepted.
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: snapshot }), txHash },
			directReader(fill, input),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_DOES_NOT_MATCH" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("filled_order_differs_from_prepared");
		await dropPosition(row?.id);
	}, 60_000);

	test("C1: a DIFFERENT extraOptionData is refused (the third fixture carries a real one)", async () => {
		const { expectation, fill, user, ticket, input, txHash } = await loadFixture(
			"sell",
			"0x3e7417c5c676109e737f540debe95d0aec9477c9797c19f37e626d0c611cff04",
		);
		const raw = fill.snapshot.rawApiData;
		if (!raw) throw new Error("no rawApiData");
		// Proves the field is load-bearing on this order rather than always "0x".
		expect(raw.extraOptionData).not.toBe("0x");
		const tampered = {
			...ticket.orderSnapshot,
			rawApiData: { ...raw, extraOptionData: `0x${"0".repeat(64)}` },
		} as typeof ticket.orderSnapshot;
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, orderSnapshot: tampered }), txHash },
			directReader(fill, input),
		);
		expect(result).toMatchObject({ ok: false, code: "FILL_DOES_NOT_MATCH" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		await dropPosition(row?.id);

		// The untampered ticket confirms, so the refusal above is that one field.
		const clean = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
		);
		expect(clean.ok).toBe(true);
		if (!clean.ok) throw new Error("unreachable");
		const [stored] = await db.select().from(positions).where(eq(positions.id, clean.positionId));
		// The third fixture's own economics, measured from chain.
		expect(stored?.premium).toBe(expectation.premium.toString());
		expect(stored?.fees).toBe(expectation.fee.toString());
		expect(stored?.collateral).toBe(expectation.takerCollateral.toString());
		expect(stored?.contracts).toBe(expectation.numContracts.toString());
		expect(stored?.premium).toBe("9009");
		expect(stored?.fees).toBe("737");
		expect(stored?.collateral).toBe("1150000");
		await dropPosition(clean.positionId);
	}, 60_000);

	test("C1: a chain read that FAILS is reported unavailable, never downgraded to the ticket's numbers", async () => {
		const { fill, user, ticket, txHash } = await buyFixture();
		const broken: ChainReader = {
			waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
			getTransaction: async () => {
				throw new Error("RPC timeout");
			},
		};
		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			broken,
		);
		expect(result).toMatchObject({ ok: false, code: "CHAIN_UNAVAILABLE" });
		const [row] = await db.select().from(positions).where(eq(positions.txHash, txHash));
		// The fill is fine; only our reading of it failed, so the row stays
		// pending and a retry still finds it.
		expect(row?.status).toBe("pending");
		await dropPosition(row?.id);
	}, 60_000);

	test("C2: an attacker who reserves a hash cannot stop the true taker recording it", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();

		// The attacker holds a perfectly valid ticket of their OWN and simply
		// submits the victim's transaction hash. The pre-fold code inserted their
		// pending row against the globally unique key and the victim's later
		// attempt threw "already belongs to another wallet" for ever.
		const attackerWallet = `0x${randomBytes(20).toString("hex")}`;
		const attacker = await seedUser(attackerWallet);
		const attackerTicket = { ...ticket, userId: attacker.id, wallet: attackerWallet };
		const stall: ChainReader = {
			waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
			getTransaction: async () => ({ to: null, input: "0x" }),
		};
		const grab = await recordTradeFor(
			{ userId: attacker.id, walletAddress: attackerWallet },
			{ token: encodeTradeTicket(attackerTicket), txHash },
			stall,
		);
		expect(grab).toMatchObject({ ok: false, code: "FILL_NOT_FOUND" });

		// The victim — the wallet the chain shows as the taker — records normally.
		const victim = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
		);
		expect(victim.ok).toBe(true);
		if (!victim.ok) throw new Error("unreachable");
		const [stored] = await db.select().from(positions).where(eq(positions.id, victim.positionId));
		expect(stored?.walletAddress).toBe(fill.taker);
		expect(stored?.status).toBe("confirmed");

		const live = await db.select().from(positions).where(eq(positions.txHash, txHash));
		// Exactly one non-failed row, and it is the true taker's.
		expect(live.filter((row) => row.status !== "failed")).toHaveLength(1);
		for (const row of live) await dropPosition(row.id);
	}, 60_000);

	test("C2: a squatter's ABANDONED pending row is superseded by the on-chain taker", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		const squatterWallet = `0x${randomBytes(20).toString("hex")}`;
		const squatter = await seedUser(squatterWallet);

		// The squatter's row is left `pending` — they never came back to finish.
		const [held] = await db
			.insert(positions)
			.values({
				thesisId: null,
				userId: squatter.id,
				role: "standalone",
				side: "back",
				status: "pending",
				chainId: 8453,
				walletAddress: squatterWallet,
				orderId: ticket.structureId,
				orderSnapshot: ticket.orderSnapshot,
				txHash,
				referrer: null,
				budget: "1",
				budgetDecimals: 6,
				contracts: "1",
				contractDecimals: 6,
				premium: "0",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "0",
				collateralDecimals: 6,
				breakEvenPrices: [],
				breakEvenPriceDecimals: 8,
				breakEvenPricesUsd: [],
			})
			.returning();
		expect(held?.status).toBe("pending");

		const result = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			directReader(fill, input),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		const [squatted] = await db.select().from(positions).where(eq(positions.id, held?.id ?? ""));
		expect(squatted?.status).toBe("failed");
		expect(squatted?.failureReason).toBe("superseded_by_onchain_taker");
		const [mine] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(mine?.walletAddress).toBe(fill.taker);
		await dropPosition(result.positionId);
		await dropPosition(held?.id);
	}, 60_000);

	test("C2: a wallet that is NOT the on-chain taker cannot supersede a pending row", async () => {
		const { fill, ticket, txHash } = await buyFixture();
		const holderWallet = `0x${randomBytes(20).toString("hex")}`;
		const holder = await seedUser(holderWallet);
		const outsiderWallet = `0x${randomBytes(20).toString("hex")}`;
		const outsider = await seedUser(outsiderWallet);

		// A pending row held by someone else, exactly as `claimPending` sees one.
		const [held] = await db
			.insert(positions)
			.values({
				thesisId: null,
				userId: holder.id,
				role: "standalone",
				side: "back",
				status: "pending",
				chainId: 8453,
				walletAddress: holderWallet,
				orderId: ticket.structureId,
				orderSnapshot: ticket.orderSnapshot,
				txHash,
				referrer: null,
				budget: "1",
				budgetDecimals: 6,
				contracts: "1",
				contractDecimals: 6,
				premium: "0",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "0",
				collateralDecimals: 6,
				breakEvenPrices: [],
				breakEvenPriceDecimals: 8,
				breakEvenPricesUsd: [],
			})
			.returning();
		expect(held?.status).toBe("pending");

		// The outsider is on neither side of this fill's `OrderFilled` log, so
		// their claim is refused and the holder's row is left exactly as it was.
		const steal = await recordTradeFor(
			{ userId: outsider.id, walletAddress: outsiderWallet },
			{ token: encodeTradeTicket({ ...ticket, userId: outsider.id, wallet: outsiderWallet }), txHash },
			{
				waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
				getTransaction: async () => ({ to: null, input: "0x" }),
			},
		);
		expect(steal).toMatchObject({ ok: false, code: "TX_HASH_TAKEN" });
		const rows = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(held?.id ?? "");
		expect(rows[0]?.walletAddress).toBe(holderWallet);
		expect(rows[0]?.status).toBe("pending");
		expect(rows[0]?.failureReason).toBeNull();
		for (const row of rows) await dropPosition(row.id);
	}, 60_000);

	test("C3: a pending row cannot be confirmed with a DIFFERENT ticket's economics", async () => {
		const { expectation, fill, user, ticket, input, txHash } = await buyFixture();
		// First attempt leaves a pending row (the chain read fails).
		const stalled = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(ticket), txHash },
			{
				waitForTransactionReceipt: async () => ({ status: "success", logs: fill.logs }),
				getTransaction: async () => {
					throw new Error("RPC timeout");
				},
			},
		);
		expect(stalled).toMatchObject({ ok: false, code: "CHAIN_UNAVAILABLE" });

		// A DIFFERENT ticket for the same hash: same wallet, different budget.
		const other = { ...ticket, budget: (BigInt(ticket.budget) + 1n).toString() };
		const mismatch = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket(other), txHash },
			directReader(fill, input),
		);
		expect(mismatch).toMatchObject({ ok: false, code: "TICKET_MISMATCH" });

		// The ORIGINAL ticket still confirms the row it created; only `issuedAt`
		// differs, which is deliberately outside the identity.
		const retry = await recordTradeFor(
			{ userId: user.id, walletAddress: fill.taker },
			{ token: encodeTradeTicket({ ...ticket, issuedAt: ticket.issuedAt + 60 }), txHash },
			directReader(fill, input),
		);
		expect(retry.ok).toBe(true);
		if (!retry.ok) throw new Error("unreachable");
		const [row] = await db.select().from(positions).where(eq(positions.id, retry.positionId));
		expect(row?.status).toBe("confirmed");
		expect(row?.premium).toBe(expectation.premium.toString());
		await dropPosition(retry.positionId);
	}, 60_000);

	test("C3: two concurrent confirmations write ONE row and ONE activity entry", async () => {
		const { fill, user, ticket, input, txHash } = await buyFixture();
		const token = encodeTradeTicket(ticket);
		const reader = directReader(fill, input);
		const [a, b] = await Promise.all([
			recordTradeFor({ userId: user.id, walletAddress: fill.taker }, { token, txHash }, reader),
			recordTradeFor({ userId: user.id, walletAddress: fill.taker }, { token, txHash }, reader),
		]);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		if (!a.ok || !b.ok) throw new Error("unreachable");
		expect(a.positionId).toBe(b.positionId);
		const rows = await db.select().from(positions).where(eq(positions.txHash, txHash));
		expect(rows.filter((row) => row.status !== "failed")).toHaveLength(1);
		const events = await db.select().from(activity).where(eq(activity.positionId, a.positionId));
		expect(events).toHaveLength(1);
		for (const row of rows) await dropPosition(row.id);
	}, 60_000);
});

describeLive("refusals: nothing is stored when the chain does not agree", () => {
	const reader = (status: string, logs: readonly Log<bigint, number, false>[] = []): ChainReader => ({
		waitForTransactionReceipt: async () => ({ status, logs }),
		getTransaction: async () => ({ to: null, input: "0x" }),
	});

	async function standaloneTicket(hashSeed: string) {
		const expectation = PRODUCTION_FILLS[0];
		if (expectation === undefined) throw new Error("no fixture");
		const fill = await loadProductionFill(expectation.hash);
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const ticket = ticketFor({
			fill,
			userId: user.id,
			thesisId: null,
			role: "standalone",
			collateralSymbol: expectation.collateralSymbol,
			collateralDecimals: expectation.collateralDecimals,
			contractSizeDecimals: expectation.contractSizeDecimals,
			contracts: expectation.numContracts,
			premium: expectation.premium,
			fee: expectation.fee,
			collateral: expectation.takerCollateral,
		});
		return {
			user,
			wallet,
			ticket: { ...ticket, wallet },
			txHash: `0x${hashSeed.padEnd(64, "0")}`,
		};
	}

	test("a reverted receipt marks the position failed and stores no economics", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const result = await recordTradeFor(
			{ userId: setup.user.id, walletAddress: setup.wallet },
			{ token: encodeTradeTicket(setup.ticket), txHash: setup.txHash },
			reader("reverted"),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("failed");
		expect(result.card).toBeNull();
		const [row] = await db.select().from(positions).where(eq(positions.id, result.positionId));
		expect(row?.status).toBe("failed");
		expect(row?.fillEvent).toBeNull();
		expect(row?.confirmedAt).toBeNull();
	});

	test("a receipt with no OptionBook fill for this wallet stores nothing more", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const result = await recordTradeFor(
			{ userId: setup.user.id, walletAddress: setup.wallet },
			{ token: encodeTradeTicket(setup.ticket), txHash: setup.txHash },
			reader("success"),
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("FILL_NOT_FOUND");
		// C2. A refusal must NOT leave a `pending` row squatting the transaction
		// hash: the uniqueness is partial over non-failed rows since 0008, so the
		// row is marked `failed` with the reason and the hash is free again.
		const [row] = await db
			.select()
			.from(positions)
			.where(and(eq(positions.chainId, 8453), eq(positions.txHash, setup.txHash)));
		expect(row?.status).toBe("failed");
		expect(row?.failureReason).toBe("no_matching_order_filled");
		expect(row?.confirmedAt).toBeNull();
		expect(row?.fillEvent).toBeNull();
	});

	test("no session, a wallet that is not the session's, and a tampered token are all refused", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const token = encodeTradeTicket(setup.ticket);

		expect(await recordTradeFor(null, { token, txHash: setup.txHash })).toMatchObject({
			ok: false,
			code: "NO_SESSION",
		});
		const other = `0x${randomBytes(20).toString("hex")}`;
		const otherUser = await seedUser(other);
		expect(
			await recordTradeFor({ userId: otherUser.id, walletAddress: other }, { token, txHash: setup.txHash }),
		).toMatchObject({ ok: false, code: "WALLET_MISMATCH" });

		// One flipped character in the payload invalidates the signature.
		const [body, signature] = token.split(".");
		const tampered = `${(body ?? "").slice(0, -1)}${(body ?? "").endsWith("A") ? "B" : "A"}.${signature}`;
		expect(decodeTradeTicket(tampered)).toBeNull();
		expect(
			await recordTradeFor({ userId: setup.user.id, walletAddress: setup.wallet }, { token: tampered, txHash: setup.txHash }),
		).toMatchObject({ ok: false, code: "BAD_TICKET" });

		expect(
			await recordTradeFor({ userId: setup.user.id, walletAddress: setup.wallet }, { token, txHash: "not-a-hash" }),
		).toMatchObject({ ok: false, code: "BAD_TX_HASH" });
	});

	test("a ticket for another chain never decodes", async () => {
		const setup = await standaloneTicket(randomBytes(24).toString("hex"));
		const wrongChain = encodeTradeTicket({ ...setup.ticket, chainId: 1 as unknown as 8453 });
		expect(decodeTradeTicket(wrongChain)).toBeNull();
	});
});

describeLive("prepareTrade refuses before any calldata exists", () => {
	test("without a session", async () => {
		const result = await prepareTradeFor(null, {
			structureId: "0".repeat(16),
			side: "bull",
			budgetInput: "10",
		});
		expect(result).toMatchObject({ ok: false, code: "NO_SESSION", needsSignIn: true });
	});

	test("with a structure that is not on the book", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const result = await prepareTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ structureId: "deadbeefdeadbeef", side: "bull", budgetInput: "10" },
		);
		expect(result).toMatchObject({ ok: false, code: "STRUCTURE_GONE" });
	}, 60_000);

	test("on a live structure with an unfunded wallet, past the side gate (the package agrees with the chain since core round 9)", async () => {
		const { getLiveMarkets } = await import("@/lib/market/live");
		const book = await getLiveMarkets();
		if ("error" in book) throw new Error(book.detail);
		const structure = book.assets
			.flatMap((asset) => asset.structures)
			.find((candidate) => candidate.buy !== null && candidate.collateralDecimals === 6);
		if (structure === undefined) throw new Error("no 6-decimal buy structure on the book");
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const result = await prepareTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ structureId: structure.id, side: "bull", budgetInput: "10" },
		);
		// A fresh random wallet has no allowance, so preparation stops at the
		// APPROVE stage: it hands back approval calldata only (nothing is sent,
		// the fill is not even simulated yet) — and never the side gate. Measured.
		if (result.ok) {
			expect(result.stage).toBe("approve");
			console.log(`[prepare] stage=${result.stage}`);
		} else {
			expect(result.code).not.toBe("TAKER_SIDE_CONTRADICTION");
			console.log(`[prepare refused] ${result.code}: ${result.reason}`);
		}
		// Nothing was written: no draft post, no position.
		const rows = await db.select({ total: sql<string>`count(*)` }).from(positions).where(eq(positions.userId, user.id));
		expect(rows[0]?.total).toBe("0");
	}, 60_000);
});

/**
 * drizzle wraps a driver error and its own message is only the failed SQL, so
 * the database's message lives on `cause`. Asserting on that is what proves
 * WHICH fence fired.
 */
function databaseError(error: unknown): { message: string; constraint?: string } {
	const cause = (error as { cause?: { message?: unknown; constraint?: unknown } }).cause;
	return {
		message: typeof cause?.message === "string" ? cause.message : String(error),
		constraint: typeof cause?.constraint === "string" ? cause.constraint : undefined,
	};
}

async function failure(run: () => Promise<unknown>): Promise<{ message: string; constraint?: string }> {
	try {
		await run();
	} catch (error) {
		return databaseError(error);
	}
	throw new Error("expected the database to refuse this write");
}

describeLive("migration 0007 fences", () => {
	test("thesis_id and role must agree, in both directions", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const fill = await loadProductionFill(PRODUCTION_FILLS[0]?.hash ?? "0x");
		const base = {
			userId: user.id,
			side: "back" as const,
			status: "pending" as const,
			chainId: 8453,
			walletAddress: wallet,
			orderId: "x",
			orderSnapshot: fill.snapshot,
			budget: "1",
			budgetDecimals: 6,
			contracts: "1",
			contractDecimals: 6,
			premium: "1",
			premiumDecimals: 6,
			fees: "0",
			feeDecimals: 6,
			collateral: "0",
			collateralDecimals: 6,
			breakEvenPrices: [],
			breakEvenPriceDecimals: 8,
			breakEvenPricesUsd: [],
		};
		// standalone with a thesis -> refused
		const thesisId = (await seedThesis(user.id, fill)).id;
		const withThesis = await failure(() =>
			db.insert(positions).values({ ...base, role: "standalone", thesisId, txHash: `0x${randomBytes(32).toString("hex")}` }),
		);
		expect(withThesis.constraint).toBe("positions_thesis_role_consistent");
		// participant with no thesis -> refused
		const withoutThesis = await failure(() =>
			db.insert(positions).values({ ...base, role: "participant", thesisId: null, txHash: `0x${randomBytes(32).toString("hex")}` }),
		);
		expect(withoutThesis.constraint).toBe("positions_thesis_role_consistent");
		console.log(`[0007 CHECK] ${withThesis.message}`);
	}, 60_000);

	test("a standalone position can never be a post's creator position", async () => {
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await seedUser(wallet);
		const fill = await loadProductionFill(PRODUCTION_FILLS[0]?.hash ?? "0x");
		const thesis = await seedThesis(user.id, fill);
		const [standalone] = await db
			.insert(positions)
			.values({
				userId: user.id,
				thesisId: null,
				role: "standalone",
				side: "back",
				status: "confirmed",
				confirmedAt: new Date(),
				chainId: 8453,
				walletAddress: wallet,
				orderId: "x",
				orderSnapshot: fill.snapshot,
				fillEvent: {
					version: 1,
					nonce: "1",
					buyer: wallet,
					seller: wallet,
					optionAddress: wallet,
					premiumAmount: "1",
					feeCollected: "0",
					referrer: wallet,
					referralFeePaid: "0",
					sellerWasMaker: true,
				},
				txHash: `0x${randomBytes(32).toString("hex")}`,
				budget: "1",
				budgetDecimals: 6,
				contracts: "1",
				contractDecimals: 6,
				premium: "1",
				premiumDecimals: 6,
				fees: "0",
				feeDecimals: 6,
				collateral: "0",
				collateralDecimals: 6,
				breakEvenPrices: [],
				breakEvenPriceDecimals: 8,
				breakEvenPricesUsd: [],
			})
			.returning();
		if (!standalone) throw new Error("could not insert the standalone position");
		// The frozen 0002 trigger requires role = 'creator' and a matching
		// thesis_id, so the link is refused when the deferred check runs.
		const refused = await failure(() =>
			db.transaction(async (tx) => {
				await tx.update(theses).set({ creatorPositionId: standalone.id }).where(eq(theses.id, thesis.id));
			}),
		);
		// The deferred trigger fires at COMMIT, so the transaction is the thing
		// that fails, and the frozen 0002 wording is what fails it.
		expect(refused.message).toMatch(/invalid creator position for thesis/);
		console.log(`[0002 trigger] ${refused.message}`);
		const [after] = await db.select().from(theses).where(eq(theses.id, thesis.id));
		expect(after?.creatorPositionId).toBeNull();
	}, 60_000);
});

/** Kept so the RPC client is torn down after the suite instead of holding the process open. */
test("teardown", () => {
	expect(typeof publicClient().getBlockNumber).toBe("function");
	expect(typeof users).toBe("object");
});
