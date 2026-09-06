import "server-only";

/**
 * K-1 (pass-4 lane C BLOCKER-1). The server's evidence that this wallet has an
 * unrecorded fill must come from something the browser cannot lose: the chain.
 *
 * `findUnrecordedFill` (`./store.ts`) sees a fill only once `recordTrade`
 * REACHED the server — the only writer of a `pending` row is `insertPending`
 * (`record.ts`), reachable only from `recordTradeFor`. A lost request with no
 * session store left nothing anywhere, and the next preparation let the same
 * order fill twice. Reproduced on these bytes before the fix, with the market
 * ticket and a server modelled faithfully (a row exists only if the handler
 * ran):
 *
 *   MIN1_MARKET {"afterFirst":{"sends":1,"serverPendingRows":0},
 *                "secondLabel":"Trade","afterSecond":{"sends":2},
 *                "sent":["0xBUY_A","0xBUY_A"]}
 *
 * So every OptionBook fill this wallet took inside the recording window is read
 * straight from `OrderFilled` logs, as buyer AND as seller: the taker is
 * `buyer` on a taker-BUY and `seller` on a taker-SELL (CLAUDE.md § Thetanuts,
 * chain-verified on tx `0x9c4bb1…` / `0xdf3323…`). Both fields are `indexed`
 * (measured from `OPTION_BOOK_ABI` in the installed SDK 0.3.0), so the filter
 * is a topic filter and costs one cheap `eth_getLogs` per side.
 *
 * DELIBERATELY WIDE: `buyer OR seller` is every party to the fill, so a wallet
 * that is also a MAKER on the book matches its own makers' fills. Narrowing it
 * is a product decision (it changes when the app refuses), so it is not taken
 * here — but the discriminator is measured and written down: on all three
 * chain-verified production fills the TAKER is `sellerWasMaker ? buyer : seller`
 * (`0x9c4bb1…` buyer / `sellerWasMaker: true`; `0xdf3323…` and `0x3e7417…`
 * seller / `false`, each matching the transaction's own `from`).
 *
 * Fails LOUD: any RPC failure throws. A read that could not run is never "no
 * fills" — the caller turns the throw into a refusal, never into a pass.
 */
import { getAbiItem, type Address, type Hex } from "viem";
import { OPTION_BOOK_ABI } from "@thetanuts-finance/thetanuts-client";
import { OPTION_BOOK_ADDRESS } from "@/lib/market/live";
import { publicClient } from "./chain";
import { UNRECORDED_FILL_WINDOW_MS } from "./store";

/**
 * Base produces one block every 2 s. MEASURED 2026-09-06 on
 * `https://mainnet.base.org`: blocks 50930197..50930872 (675 blocks) spanned
 * exactly 1350 s.
 */
export const BASE_BLOCK_TIME_MS = 2_000;

/**
 * How far back the logs are read: the recording window, in blocks, with a
 * margin so a slow stretch of blocks cannot shorten the window in TIME below
 * `UNRECORDED_FILL_WINDOW_MS`. At today's numbers that is 450 blocks = 15
 * minutes of chain against a 10-minute window.
 *
 * TODO-OWNER: the 1.5 margin is this file's choice, like the window it scales.
 */
export const FILL_LOOKBACK_MARGIN = 1.5;
export const FILL_LOOKBACK_BLOCKS = BigInt(
	Math.ceil((UNRECORDED_FILL_WINDOW_MS / BASE_BLOCK_TIME_MS) * FILL_LOOKBACK_MARGIN),
);

const ORDER_FILLED = getAbiItem({ abi: OPTION_BOOK_ABI, name: "OrderFilled" });

/**
 * The two read methods this module uses, so a test can drive it without a
 * chain. Structural on purpose: wagmi ships its own copy of viem and the two
 * `PublicClient` types are not assignable to each other (see `./chain.ts`).
 */
export interface FillReader {
	getBlockNumber(): Promise<bigint>;
	getLogs(args: {
		address: `0x${string}`;
		event: typeof ORDER_FILLED;
		args: { buyer: Address } | { seller: Address };
		fromBlock: bigint;
		toBlock: bigint;
	}): Promise<ReadonlyArray<{ transactionHash: Hex | null; blockNumber: bigint | null }>>;
}

export interface ChainFill {
	readonly txHash: Hex;
	readonly blockNumber: bigint;
	/** true when the wallet was `buyer` (taker-BUY), false when `seller` (taker-SELL). */
	readonly asBuyer: boolean;
}

/**
 * Every OptionBook fill this wallet took inside the lookback, newest first.
 * Throws on any read failure.
 *
 * viem types `transactionHash` and `blockNumber` as nullable because a PENDING
 * log has neither. `getLogs` over a mined block range returns none of those, so
 * the pair is narrowed rather than asserted — a null-carrying log is dropped
 * instead of becoming a `null` transaction hash the fence would then compare.
 */
export async function recentFillsByWallet(
	wallet: Address,
	reader: FillReader = publicClient(),
): Promise<ChainFill[]> {
	const latest = await reader.getBlockNumber();
	const fromBlock = latest > FILL_LOOKBACK_BLOCKS ? latest - FILL_LOOKBACK_BLOCKS : 0n;
	const range = { address: OPTION_BOOK_ADDRESS, event: ORDER_FILLED, fromBlock, toBlock: latest } as const;
	const [bought, sold] = await Promise.all([
		reader.getLogs({ ...range, args: { buyer: wallet } }),
		reader.getLogs({ ...range, args: { seller: wallet } }),
	]);
	const fills: ChainFill[] = [];
	for (const [logs, asBuyer] of [
		[bought, true],
		[sold, false],
	] as const) {
		for (const log of logs) {
			if (log.transactionHash === null || log.blockNumber === null) continue;
			fills.push({ txHash: log.transactionHash, blockNumber: log.blockNumber, asBuyer });
		}
	}
	return fills.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? 1 : -1));
}
