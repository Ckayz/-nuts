/**
 * The wallet and the server actions, injected once for every money-path probe.
 *
 * `mock.module` in bun is process-wide, so two probe files each registering
 * their own "wagmi" would have the LAST registration win for both — a probe
 * would then record its sends into the other file's array and silently pass.
 * One registration, one `calls` object, reset per test.
 */
import { mock } from "bun:test";
import * as realWagmi from "wagmi";
import type { PrepareResult, RecordResult, TicketQuoteView } from "@/lib/trade/types";

export const WALLET = "0x00000000000000000000000000000000000000a1";
export const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** A real `eth_sendTransaction` answer: 32 bytes. */
export const HASH = `0x${"1".repeat(64)}` as const;

export interface Calls {
	quotes: Array<{ structureId?: string; side: string; budgetInput: string; taker?: string }>;
	/** I-1: `taker` is the side of the BOOK the ticket resolved for its button. */
	prepares: Array<{ side: string; budgetInput: string; taker?: string }>;
	agentPrepares: number;
	sends: Array<{ to: string; data: string }>;
	records: Array<{ token: string; txHash: string }>;
	/**
	 * K-1 (pass-4 lane C BLOCKER-1). The two facts a SERVER-side fence could
	 * actually see, kept apart from the two above, which are what the BROWSER
	 * did.
	 *
	 * `broadcast` — hashes the wallet ANSWERED for, i.e. what is on chain and
	 * therefore in `OrderFilled` logs (`lib/trade/chain-fills.ts`).
	 * `recorded` — hashes whose `recordTrade` call REACHED the server and came
	 * back `ok`, i.e. what has a `positions` row (`lib/trade/record.ts`).
	 *
	 * `records` counts the browser having ATTEMPTED the call, which is not
	 * evidence of anything server-side: a probe that fenced on it passed
	 * vacuously in exactly the lost-request case it was named for.
	 */
	broadcast: string[];
	recorded: string[];
}

export const calls: Calls = {
	quotes: [],
	prepares: [],
	agentPrepares: 0,
	sends: [],
	records: [],
	broadcast: [],
	recorded: [],
};

/** M5. What the mocked `waitForTransactionReceipt` answers, given its parameters. */
export type ReceiptReply = (params: {
	hash: string;
	chainId?: number;
	timeout?: number;
}) => Promise<{ status: string }>;

export const replies = {
	quote: (async () => {
		throw new Error("quoteTicket not stubbed");
	}) as (input: { side: string; budgetInput: string }) => Promise<TicketQuoteView>,
	prepare: (async () => {
		throw new Error("prepareTrade not stubbed");
	}) as (input: { side: string; budgetInput: string }) => Promise<PrepareResult>,
	agentPrepare: (async () => {
		throw new Error("prepareAgentTrade not stubbed");
	}) as () => Promise<PrepareResult>,
	record: (async () => {
		throw new Error("recordTrade not stubbed");
	}) as (input: { token: string; txHash: string }) => Promise<RecordResult>,
	send: (async () => HASH) as (input: { to: string; data: string }) => Promise<string>,
	receiptStatus: "success" as "success" | "reverted",
	/**
	 * M5 (Opus user-flow tester, confirming round). What `waitForTransactionReceipt`
	 * does, as a function of the parameters it was CALLED with.
	 *
	 * The default answers with `receiptStatus`, so every existing probe is
	 * unchanged. `neverLandingReceipt()` below stands in for viem's own behaviour
	 * when a broadcast transaction never mines: it rejects at the `timeout` the
	 * caller passed, and hangs FOREVER when the caller passed none — which is
	 * exactly the difference the M5 fix is about, and what makes a mutant that
	 * drops the bound go red instead of merely slow.
	 */
	receipt: (async () => ({ status: "success" })) as ReceiptReply,
	/** What `useConnection()` reports. */
	connection: { address: WALLET as string | undefined, isConnected: true, chainId: 8453 as number | undefined },
};

/** `sessionStorage` for `lib/trade/held-fill.ts`. Bun has no DOM. */
export const storage = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => {
		storage.set(key, value);
	},
	removeItem: (key: string) => {
		storage.delete(key);
	},
};

export function resetTradeMocks(): void {
	storage.clear();
	calls.quotes = [];
	calls.prepares = [];
	calls.agentPrepares = 0;
	calls.sends = [];
	calls.records = [];
	calls.broadcast = [];
	calls.recorded = [];
	replies.receiptStatus = "success";
	replies.receipt = async () => ({ status: replies.receiptStatus });
	replies.connection = { address: WALLET, isConnected: true, chainId: 8453 };
	replies.send = async () => HASH;
	replies.record = async () => ({
		ok: true,
		status: "confirmed",
		positionId: "p1",
		thesisId: null,
		txHash: HASH,
		card: null,
		settled: null,
	});
}

/**
 * Spread over the REAL module: other test files import components that use
 * `useAccount`, `useConnect` and friends, and a mock that replaced wagmi with
 * four hooks made those files fail with "Export named 'useAccount' not found"
 * whenever they ran after this one in the same process (measured).
 */
mock.module("wagmi", () => ({
	...realWagmi,
	useConfig: () => ({}),
	useConnection: () => replies.connection,
	useSendTransaction: () => ({
		mutateAsync: async (input: { to: string; data: string }) => {
			calls.sends.push({ to: input.to, data: input.data });
			const hash = await replies.send(input);
			// K-1. Recorded only after the wallet ANSWERED: a broadcast that threw
			// put nothing on chain, so no log would exist for it either.
			calls.broadcast.push(hash);
			return hash;
		},
	}),
	useSwitchChain: () => ({ switchChain: () => {}, isPending: false }),
}));

mock.module("wagmi/actions", () => ({
	waitForTransactionReceipt: (_config: unknown, params: { hash: string; chainId?: number; timeout?: number }) =>
		replies.receipt(params),
}));

/**
 * M5. A transaction hash the chain never mines.
 *
 * With a `timeout` the wait ends in a rejection, the way viem's own
 * `waitForTransactionReceipt` ends it (`WaitForTransactionReceiptTimeoutError`,
 * `viem/_esm/actions/public/waitForTransactionReceipt.js:73`). With no
 * `timeout` the promise never settles, which is what a caller that passes none
 * is asking for as far as this harness can tell.
 */
export function neverLandingReceipt(): void {
	replies.receipt = async (params: Parameters<ReceiptReply>[0]) => {
		if (params.timeout === undefined) return await new Promise<never>(() => {});
		throw new Error(`Timed out while waiting for transaction with hash "${params.hash}" to be confirmed.`);
	};
}

mock.module("@/lib/trade/actions", () => ({
	quoteTicket: (input: { structureId?: string; side: string; budgetInput: string; taker?: string }) => {
		calls.quotes.push(input);
		return replies.quote(input);
	},
	prepareTrade: (input: { side: string; budgetInput: string; taker?: string }) => {
		calls.prepares.push({ side: input.side, budgetInput: input.budgetInput, taker: input.taker });
		return replies.prepare(input);
	},
	recordTrade: async (input: { token: string; txHash: string }) => {
		calls.records.push(input);
		const result = await replies.record(input);
		// K-1. A row exists only when the handler RAN and succeeded. An `ok:false`
		// answer the client invented for a request that never arrived is not one.
		if (result.ok) calls.recorded.push(input.txHash);
		return result;
	},
}));

mock.module("@/lib/agent/actions", () => ({
	prepareAgentTrade: () => {
		calls.agentPrepares += 1;
		return replies.agentPrepare();
	},
}));
