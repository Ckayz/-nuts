/**
 * K-1 (pass-4 lane C BLOCKER-1). The chain read the server's double-fill fence
 * stands on.
 *
 * Offline: the reader is a fake, so no RPC is made. What the LIVE chain
 * answers for these filters was measured separately and is pinned in
 * `chain-fills.ts`'s docblock (block 50884962, tx `0x9c4bb1…`: filtering by
 * `buyer` returns that fill, filtering by `seller` with the same address
 * returns nothing).
 */
import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import {
	BASE_BLOCK_TIME_MS,
	FILL_LOOKBACK_BLOCKS,
	recentFillsByWallet,
	type FillReader,
} from "./chain-fills";
import { UNRECORDED_FILL_WINDOW_MS } from "./store";

const WALLET = "0x00000000000000000000000000000000000000a1" as Address;
const BUY_TX = `0x${"1".repeat(64)}` as Hex;
const SELL_TX = `0x${"2".repeat(64)}` as Hex;

interface Ask {
	readonly fromBlock: bigint;
	readonly toBlock: bigint;
	readonly args: { buyer?: Address; seller?: Address };
	readonly address: string;
}

/** A reader that answers from a fixture and records exactly what it was asked. */
function reader(input: {
	latest: bigint;
	byBuyer?: Array<{ transactionHash: Hex | null; blockNumber: bigint | null }>;
	bySeller?: Array<{ transactionHash: Hex | null; blockNumber: bigint | null }>;
}): { reader: FillReader; asks: Ask[] } {
	const asks: Ask[] = [];
	return {
		asks,
		reader: {
			getBlockNumber: async () => input.latest,
			getLogs: async (args) => {
				asks.push(args as unknown as Ask);
				const wants = args.args as { buyer?: Address; seller?: Address };
				return wants.buyer !== undefined ? (input.byBuyer ?? []) : (input.bySeller ?? []);
			},
		},
	};
}

describe("K-1: recentFillsByWallet reads both taker roles from OrderFilled", () => {
	test("a buyer log and a seller log both come back, newest first, with the role", async () => {
		const { reader: r, asks } = reader({
			latest: 1000n,
			byBuyer: [{ transactionHash: BUY_TX, blockNumber: 900n }],
			bySeller: [{ transactionHash: SELL_TX, blockNumber: 950n }],
		});
		expect(await recentFillsByWallet(WALLET, r)).toEqual([
			{ txHash: SELL_TX, blockNumber: 950n, asBuyer: false },
			{ txHash: BUY_TX, blockNumber: 900n, asBuyer: true },
		]);
		// Both taker roles are asked for: the taker is `buyer` on a taker-BUY and
		// `seller` on a taker-SELL (CLAUDE.md § Thetanuts, chain-verified).
		expect(asks.map((ask) => ask.args)).toEqual([{ buyer: WALLET }, { seller: WALLET }]);
		expect(asks.every((ask) => ask.address === "0x1bDff855d6811728acaDC00989e79143a2bdfDed")).toBe(true);
	});

	test("the lookback covers the recording window in TIME, and is asked for as a block range", async () => {
		expect(FILL_LOOKBACK_BLOCKS * BigInt(BASE_BLOCK_TIME_MS)).toBeGreaterThanOrEqual(
			BigInt(UNRECORDED_FILL_WINDOW_MS),
		);
		const { reader: r, asks } = reader({ latest: 1_000_000n });
		await recentFillsByWallet(WALLET, r);
		expect(asks.map((ask) => ({ from: ask.fromBlock, to: ask.toBlock }))).toEqual([
			{ from: 1_000_000n - FILL_LOOKBACK_BLOCKS, to: 1_000_000n },
			{ from: 1_000_000n - FILL_LOOKBACK_BLOCKS, to: 1_000_000n },
		]);
	});

	test("a chain shorter than the lookback clamps at block 0 instead of underflowing", async () => {
		const { reader: r, asks } = reader({ latest: 10n });
		await recentFillsByWallet(WALLET, r);
		expect(asks[0]?.fromBlock).toBe(0n);
	});

	test("a log with no transaction hash or block is dropped, never turned into a null hash", async () => {
		const { reader: r } = reader({
			latest: 1000n,
			byBuyer: [
				{ transactionHash: null, blockNumber: 900n },
				{ transactionHash: BUY_TX, blockNumber: null },
				{ transactionHash: BUY_TX, blockNumber: 900n },
			],
		});
		expect(await recentFillsByWallet(WALLET, r)).toEqual([
			{ txHash: BUY_TX, blockNumber: 900n, asBuyer: true },
		]);
	});

	/**
	 * The fail-posture. A read that could not run must never look like "no
	 * fills": that is the difference between a fence and a decoration.
	 */
	test("a reader that rejects PROPAGATES — an unreadable chain is never no fills", async () => {
		const blockFailure: FillReader = {
			getBlockNumber: async () => {
				throw new Error("RPC down");
			},
			getLogs: async () => [],
		};
		await expect(recentFillsByWallet(WALLET, blockFailure)).rejects.toThrow("RPC down");

		const logFailure: FillReader = {
			getBlockNumber: async () => 1000n,
			getLogs: async () => {
				throw new Error("getLogs refused");
			},
		};
		await expect(recentFillsByWallet(WALLET, logFailure)).rejects.toThrow("getLogs refused");
	});
});
