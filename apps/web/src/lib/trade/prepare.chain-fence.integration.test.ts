/**
 * K-1 (pass-4 lane C BLOCKER-1). The server's double-fill fence, driven through
 * the REAL `prepareTradeFor` against a real database, with only the chain
 * reader injected.
 *
 * The wound this closes, measured on the pre-fix bytes at the market ticket
 * with a faithfully modelled server (a `pending` row exists only when the
 * `recordTrade` handler actually ran):
 *
 *   MIN1_MARKET {"afterFirst":{"sends":1,"serverPendingRows":0},
 *                "secondLabel":"Trade","afterSecond":{"sends":2},
 *                "sent":["0xBUY_A","0xBUY_A"]}
 *
 * Live, so it needs `DATABASE_URL`. It reaches no chain — the reader is a fake
 * — and it signs and sends nothing. The refusal cases never get as far as the
 * order book, because the fence runs before the structure is looked up.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { db } from "@nuts/db";
import { positions } from "@nuts/db/schema/index";
import { eq, sql } from "drizzle-orm";
import { createOrFetchUser } from "@/lib/auth/store";
import type { FillReader } from "./chain-fills";
import { firstUnknownFill } from "./store";
import { prepareTradeFor } from "./prepare";

const databaseUrl = process.env.DATABASE_URL;
const describeLive = databaseUrl ? describe : describe.skip;
if (!databaseUrl) console.log("prepare chain-fence integration skipped: DATABASE_URL is not set");

/** A reader that reports exactly these fills for the wallet, whichever role is asked for. */
function readerWith(fills: Array<{ txHash: Hex; block: bigint; asBuyer: boolean }>): FillReader {
	return {
		getBlockNumber: async () => 1_000_000n,
		getLogs: async (args) => {
			const wantsBuyer = (args.args as { buyer?: Address }).buyer !== undefined;
			return fills
				.filter((fill) => fill.asBuyer === wantsBuyer)
				.map((fill) => ({ transactionHash: fill.txHash, blockNumber: fill.block }));
		},
	};
}

const EMPTY: FillReader = { getBlockNumber: async () => 1_000_000n, getLogs: async () => [] };

const REJECTS: FillReader = {
	getBlockNumber: async () => {
		throw new Error("RPC down");
	},
	getLogs: async () => [],
};

/** The minimum a row needs. Nothing in these tests depends on the numbers. */
async function row(input: {
	userId: string;
	wallet: string;
	txHash: string;
	status: "pending" | "confirmed" | "failed";
}): Promise<void> {
	await db.insert(positions).values({
		thesisId: null,
		userId: input.userId,
		role: "standalone",
		side: "back",
		status: input.status,
		failureReason: input.status === "failed" ? "fill_does_not_match" : null,
		// `positions_confirmed_fill_event_required`: a terminal row must carry the
		// decoded `OrderFilled` it was confirmed from.
		fillEvent:
			input.status === "confirmed"
				? {
						version: 1 as const,
						nonce: "1",
						buyer: input.wallet,
						seller: input.wallet,
						optionAddress: input.wallet,
						premiumAmount: "1",
						feeCollected: "0",
						referrer: input.wallet,
						referralFeePaid: "0",
						sellerWasMaker: true,
					}
				: null,
		chainId: 8453,
		walletAddress: input.wallet,
		orderId: "0".repeat(16),
		orderSnapshot: {
			version: 1 as const,
			order: {
				maker: `0x${"1".repeat(40)}`,
				taker: `0x${"0".repeat(40)}`,
				option: `0x${"2".repeat(40)}`,
				isBuyer: false,
				numContracts: "10000",
				price: "50000000",
				expiry: "1893456000",
				nonce: "1",
			},
			signature: "0x00",
			availableAmount: "1000000",
			makerAddress: `0x${"1".repeat(40)}`,
		},
		txHash: input.txHash,
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
	});
}

async function freshWallet(): Promise<{ wallet: string; session: { userId: string; walletAddress: string } }> {
	const wallet = `0x${randomBytes(20).toString("hex")}`;
	const user = await createOrFetchUser(db, wallet);
	return { wallet, session: { userId: user.id, walletAddress: wallet } };
}

/** Never on the book, so anything past the fence stops at `STRUCTURE_GONE`. */
const INPUT = { structureId: "deadbeefdeadbeef", side: "bull" as const, budgetInput: "10" };

describeLive("K-1: a fill the CHAIN shows and no row knows about owns the ticket", () => {
	test("an unknown chain fill refuses preparation with the recorded-fill sentence", async () => {
		const { session } = await freshWallet();
		const txHash = `0x${randomBytes(32).toString("hex")}` as Hex;

		const result = await prepareTradeFor(
			session,
			INPUT,
			readerWith([{ txHash, block: 999_999n, asBuyer: true }]),
		);
		expect(result).toMatchObject({ ok: false, code: "UNRECORDED_FILL" });
		if (result.ok) throw new Error("unreachable");
		expect(result.reason).toContain(txHash.slice(0, 10));
	});

	test("a taker-SELL fill counts too — the taker is `seller` on that side", async () => {
		const { session } = await freshWallet();
		const txHash = `0x${randomBytes(32).toString("hex")}` as Hex;
		const result = await prepareTradeFor(
			session,
			INPUT,
			readerWith([{ txHash, block: 999_999n, asBuyer: false }]),
		);
		expect(result).toMatchObject({ ok: false, code: "UNRECORDED_FILL" });
	});

	test("a row of ANY status makes the fill known and the fence lets the ticket through", async () => {
		for (const status of ["confirmed", "failed", "pending"] as const) {
			const { wallet, session } = await freshWallet();
			const txHash = `0x${randomBytes(32).toString("hex")}` as Hex;
			await row({ userId: session.userId, wallet, txHash, status });

			const result = await prepareTradeFor(
				session,
				INPUT,
				readerWith([{ txHash, block: 999_999n, asBuyer: true }]),
			);
			// `pending` is still refused, by the OTHER fence (`findUnrecordedFill`),
			// and that refusal names the same hash — what must not happen is the
			// chain fence firing for a fill this wallet's rows already know.
			if (status === "pending") {
				expect(result).toMatchObject({ ok: false, code: "UNRECORDED_FILL" });
			} else {
				expect({ status, code: result.ok ? "ok" : result.code }).toEqual({
					status,
					code: "STRUCTURE_GONE",
				});
			}
		}
	});

	test("a row for the same hash under ANOTHER wallet does not unblock this one", async () => {
		const mine = await freshWallet();
		const theirs = await freshWallet();
		const txHash = `0x${randomBytes(32).toString("hex")}` as Hex;
		await row({ userId: theirs.session.userId, wallet: theirs.wallet, txHash, status: "confirmed" });

		expect(await firstUnknownFill(db, theirs.wallet, [{ txHash }])).toBeNull();
		expect(await firstUnknownFill(db, mine.wallet, [{ txHash }])).toEqual({ txHash });

		const result = await prepareTradeFor(
			mine.session,
			INPUT,
			readerWith([{ txHash, block: 999_999n, asBuyer: true }]),
		);
		expect(result).toMatchObject({ ok: false, code: "UNRECORDED_FILL" });
	});

	test("a chain that cannot be read is a REFUSAL, not a throw and not a pass", async () => {
		const { session } = await freshWallet();
		const result = await prepareTradeFor(session, INPUT, REJECTS);
		expect(result).toMatchObject({ ok: false, code: "CHAIN_UNAVAILABLE" });
	});

	test("with no fills on chain the ticket proceeds, and nothing was written", async () => {
		const { session } = await freshWallet();
		const result = await prepareTradeFor(session, INPUT, EMPTY);
		expect(result).toMatchObject({ ok: false, code: "STRUCTURE_GONE" });

		const rows = await db
			.select({ total: sql<string>`count(*)` })
			.from(positions)
			.where(eq(positions.userId, session.userId));
		expect(rows[0]?.total).toBe("0");
	});
});
