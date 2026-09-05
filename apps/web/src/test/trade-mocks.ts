/**
 * The wallet and the server actions, injected once for every money-path probe.
 *
 * `mock.module` in bun is process-wide, so two probe files each registering
 * their own "wagmi" would have the LAST registration win for both — a probe
 * would then record its sends into the other file's array and silently pass.
 * One registration, one `calls` object, reset per test.
 */
import { mock } from "bun:test";
import type { PrepareResult, RecordResult, TicketQuoteView } from "@/lib/trade/types";

export const WALLET = "0x00000000000000000000000000000000000000a1";
export const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** A real `eth_sendTransaction` answer: 32 bytes. */
export const HASH = `0x${"1".repeat(64)}` as const;

export interface Calls {
	quotes: Array<{ side: string; budgetInput: string }>;
	prepares: Array<{ side: string; budgetInput: string }>;
	agentPrepares: number;
	sends: Array<{ to: string; data: string }>;
	records: Array<{ token: string; txHash: string }>;
}

export const calls: Calls = { quotes: [], prepares: [], agentPrepares: 0, sends: [], records: [] };

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
	replies.receiptStatus = "success";
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

mock.module("wagmi", () => ({
	useConfig: () => ({}),
	useConnection: () => replies.connection,
	useSendTransaction: () => ({
		mutateAsync: (input: { to: string; data: string }) => {
			calls.sends.push({ to: input.to, data: input.data });
			return replies.send(input);
		},
	}),
	useSwitchChain: () => ({ switchChain: () => {}, isPending: false }),
}));

mock.module("wagmi/actions", () => ({
	waitForTransactionReceipt: async () => ({ status: replies.receiptStatus }),
}));

mock.module("@/lib/trade/actions", () => ({
	quoteTicket: (input: { side: string; budgetInput: string }) => {
		calls.quotes.push(input);
		return replies.quote(input);
	},
	prepareTrade: (input: { side: string; budgetInput: string }) => {
		calls.prepares.push({ side: input.side, budgetInput: input.budgetInput });
		return replies.prepare(input);
	},
	recordTrade: (input: { token: string; txHash: string }) => {
		calls.records.push(input);
		return replies.record(input);
	},
}));

mock.module("@/lib/agent/actions", () => ({
	prepareAgentTrade: () => {
		calls.agentPrepares += 1;
		return replies.agentPrepare();
	},
}));
