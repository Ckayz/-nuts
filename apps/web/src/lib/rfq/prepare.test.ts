/**
 * The RFQ money path, offline.
 *
 * Every remote thing is injected: the store (`./store.ts`'s interface, backed by
 * a Map here), the chain reader, the dry run, the clock and the key mint. The
 * SDK client is REAL — `buildRfqCreate` has to encode real factory calldata for
 * these assertions to mean anything — with only its network methods replaced.
 * Nothing here touches Base, a database, or a key store.
 *
 * The load-bearing assertions, each with the mutant that turns it red:
 *
 *  - the approval's spender is the FACTORY  (mutant: expect the OptionBook)
 *  - the 10 USD escrow gate runs before either stage  (mutant: delete the gate)
 *  - the ticket is bound to the session  (mutant: drop the wallet comparison)
 *  - settle is refused before `offerEnd + revealWindow`  (mutant: drop the fence)
 *  - a receipt that does not call the factory, or carries another wallet's
 *    `QuotationRequested`, records nothing.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { keccak256, toHex } from "viem";
import { MemoryStorageProvider } from "@thetanuts-finance/thetanuts-client";
import { QUOTATION_REQUESTED_TOPIC, createRfqClient } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";
import type { NewRfqRequest, RfqRequest } from "@nuts/db/schema/index";
import { decodeApproval } from "@/lib/trade/approval";
import {
	prepareRfqCancelFor,
	prepareRfqCreateFor,
	prepareRfqSettleFor,
	recordRfqCancelFor,
	recordRfqCreateFor,
	recordRfqSettleFor,
	rfqStatusForRequest,
	type RfqChainReader,
	type RfqDeps,
	type RfqSdkClient,
} from "./prepare";
import type { RfqRowStore } from "./store";
import { decodeRfqTicket } from "./ticket";

/* ───────────────────────────── fixtures ───────────────────────────── */

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const SESSION = { userId: USER, walletAddress: WALLET };
const PUBLIC_KEY = `0x02${"33".repeat(32)}`;
const OPTION_BOOK = "0x1bDff855d6811728acaDC00989e79143a2bdfDed";
const OPTION_ADDRESS = "0x4444444444444444444444444444444444444444";
const WINNER = "0x5555555555555555555555555555555555555555";
const ZERO = "0x0000000000000000000000000000000000000000";
const TX = `0x${"ab".repeat(32)}`;
const NOW_MS = 1_788_600_000_000;
const NOW_S = NOW_MS / 1000;
const EXPIRY = NOW_S + 7 * 86_400;
const DEADLINE_MINUTES = 60;
const OFFER_END = NOW_S + DEADLINE_MINUTES * 60;
const REVEAL = 60;

/**
 * `QuotationSettled(uint256,address,address,address)` topic0, hashed here from
 * the signature string rather than looked up in the ABI — a DIFFERENT means from
 * the one `prepare.ts` uses, so the two agreeing is evidence.
 */
const SETTLED_TOPIC = keccak256(toHex("QuotationSettled(uint256,address,address,address)"));

const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const idTopic = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}`;

const createInput = (over: Partial<Parameters<typeof prepareRfqCreateFor>[1]> = {}) => ({
	underlying: "ETH",
	strikesUsd: ["2300"],
	expiry: EXPIRY,
	numContracts: "1",
	reservePricePerContract: "0.5",
	offerDeadlineMinutes: DEADLINE_MINUTES,
	...over,
});

/* ───────────────────────────── the seams ───────────────────────────── */

interface Recorded {
	readonly rows: Map<string, RfqRequest>;
	readonly dryRuns: { to: string; data: string; account: string }[];
	readonly mintedKeys: string[];
}

function memoryStore(state: Recorded): RfqRowStore {
	let next = 0;
	return {
		async insertPending(row: NewRfqRequest) {
			next += 1;
			const id = `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
			const stored = {
				id,
				quotationId: null,
				createTx: null,
				cancelTx: null,
				settleTx: null,
				optionAddress: null,
				failureReason: null,
				createdAt: new Date(NOW_MS),
				updatedAt: new Date(NOW_MS),
				...row,
			} as RfqRequest;
			state.rows.set(id, stored);
			return stored;
		},
		async findOwn(id, wallet) {
			const row = state.rows.get(id);
			return row && row.walletAddress === wallet ? row : null;
		},
		async listForWallet(wallet, limit) {
			return [...state.rows.values()].filter((row) => row.walletAddress === wallet).slice(0, limit);
		},
		async bindQuotation({ id, wallet, quotationId, createTx, at }) {
			const row = state.rows.get(id);
			if (!row || row.walletAddress !== wallet || row.quotationId !== null) return null;
			const updated = { ...row, status: "active" as const, quotationId, createTx, failureReason: null, updatedAt: at };
			state.rows.set(id, updated);
			return updated;
		},
		async markTerminal({ id, wallet, status, cancelTx, settleTx, optionAddress, at }) {
			const row = state.rows.get(id);
			if (!row || row.walletAddress !== wallet || row.status !== "active") return null;
			const updated = {
				...row,
				status,
				...(cancelTx === undefined ? {} : { cancelTx }),
				...(settleTx === undefined ? {} : { settleTx }),
				...(optionAddress === undefined ? {} : { optionAddress }),
				updatedAt: at,
			};
			state.rows.set(id, updated);
			return updated;
		},
		async markFailed({ id, wallet, reason, at }) {
			const row = state.rows.get(id);
			if (!row || row.walletAddress !== wallet) return;
			state.rows.set(id, { ...row, status: "failed" as const, failureReason: reason, updatedAt: at });
		},
	};
}

interface ClientOptions {
	allowance?: bigint;
	isActive?: boolean;
	currentWinner?: string;
	optionContract?: string;
	offerEndTimestamp?: number;
	revealWindow?: bigint | null;
	quotationThrows?: boolean;
}

/** The real SDK encoders and chain config; every network method replaced. */
function testClient(options: ClientOptions = {}): RfqSdkClient {
	const base = createRfqClient({
		rpcUrl: env.BASE_RPC_URL,
		referrer: env.THESIS_REFERRER,
		keyStorageProvider: new MemoryStorageProvider(),
	});
	const factory = base.optionFactory;
	return {
		chainConfig: base.chainConfig,
		optionFactory: {
			buildRFQRequest: factory.buildRFQRequest.bind(factory),
			encodeRequestForQuotation: factory.encodeRequestForQuotation.bind(factory),
			encodeCancelQuotation: factory.encodeCancelQuotation.bind(factory),
			encodeSettleQuotation: factory.encodeSettleQuotation.bind(factory),
			getQuotation: async () => {
				if (options.quotationThrows) throw new Error("rpc down");
				return {
					params: {
						offerEndTimestamp: BigInt(options.offerEndTimestamp ?? OFFER_END),
						expiryTimestamp: BigInt(EXPIRY),
					},
					state: {
						isActive: options.isActive ?? true,
						currentWinner: options.currentWinner ?? ZERO,
						currentBestPriceOrReserve: 500_000n,
						feeCollected: 0n,
						optionContract: options.optionContract ?? ZERO,
					},
				} as unknown as Awaited<ReturnType<RfqSdkClient["optionFactory"]["getQuotation"]>>;
			},
			getRevealWindow: async () => {
				if (options.revealWindow === null) throw new Error("rpc down");
				return options.revealWindow ?? BigInt(REVEAL);
			},
		},
		erc20: {
			encodeApprove: base.erc20.encodeApprove.bind(base.erc20),
			getAllowance: async () => options.allowance ?? 0n,
		},
		api: {
			getRfq: async () => {
				throw new Error("indexer unreadable in these tests");
			},
			getUserOptionsFromRfq: async () => [],
		},
		mmPricing: {
			getAllPricing: async () => ({}),
		},
	};
}

interface DepsOptions extends ClientOptions {
	keysConfigured?: boolean;
	dryRunReverts?: string | null;
	receipt?: { status: string; logs: { address: string; topics: string[]; data: string }[] };
	transaction?: { to: string | null; input: `0x${string}` };
	readerThrows?: boolean;
	nowMs?: number;
}

function makeDeps(options: DepsOptions = {}): { deps: RfqDeps; state: Recorded; factory: string } {
	const state: Recorded = { rows: new Map(), dryRuns: [], mintedKeys: [] };
	const client = testClient(options);
	const factory = String(client.chainConfig.contracts.optionFactory);
	const reader: RfqChainReader = {
		async waitForTransactionReceipt() {
			if (options.readerThrows) throw new Error("rpc down");
			return (options.receipt ?? { status: "success", logs: [] }) as never;
		},
		async getTransaction() {
			if (options.readerThrows) throw new Error("rpc down");
			return options.transaction ?? { to: factory, input: "0x" };
		},
	};
	const deps: RfqDeps = {
		clientFor: () => client,
		dryRun: async ({ account, to, data }) => {
			state.dryRuns.push({ account, to, data });
			return options.dryRunReverts ? { ok: false, reason: options.dryRunReverts } : { ok: true };
		},
		reader,
		store: memoryStore(state),
		database: null as unknown as RfqDeps["database"],
		now: () => new Date(options.nowMs ?? NOW_MS),
		ensureKey: async (wallet) => {
			state.mintedKeys.push(wallet);
			return { compressedPublicKey: PUBLIC_KEY };
		},
		keysConfigured: () => options.keysConfigured ?? true,
	};
	return { deps, state, factory };
}

/**
 * The OptionFactory this build is configured for, read once from `chainConfig`
 * — never a literal. Measured 2026-09-06 on Base:
 * `0x8118daD971dEbffB49B9280047659174128A8B94`.
 */
const FACTORY = String(testClient().chainConfig.contracts.optionFactory);

/** A row already bound to a quotation, as a mined create would leave it. */
async function activeRow(deps: RfqDeps, state: Recorded, quotationId = "125"): Promise<RfqRequest> {
	const prepared = await prepareRfqCreateFor(SESSION, createInput(), deps);
	if (!prepared.ok || prepared.stage !== "create") throw new Error("fixture: expected a create stage");
	const row = state.rows.get(prepared.rfqRequestId);
	if (!row) throw new Error("fixture: no row");
	const bound = { ...row, status: "active" as const, quotationId, createTx: TX };
	state.rows.set(row.id, bound);
	return bound;
}

/* ───────────────────────────── create ───────────────────────────── */

describe("prepareRfqCreateFor", () => {
	test("refuses without a session and asks for sign-in", async () => {
		const { deps, state } = makeDeps();
		const result = await prepareRfqCreateFor(null, createInput(), deps);
		expect(result).toEqual({ ok: false, code: "NO_SESSION", reason: expect.any(String), needsSignIn: true });
		expect(state.rows.size).toBe(0);
		expect(state.mintedKeys).toEqual([]);
	});

	test("fails closed with no master key, before a key is minted or a row written", async () => {
		const { deps, state } = makeDeps({ keysConfigured: false });
		const result = await prepareRfqCreateFor(SESSION, createInput(), deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_KEYS_UNCONFIGURED");
		expect(state.mintedKeys).toEqual([]);
		expect(state.rows.size).toBe(0);
	});

	test("with no allowance it returns the approval alone, EXACT and spent by the FACTORY", async () => {
		const { deps, state, factory } = makeDeps({ allowance: 0n });
		const result = await prepareRfqCreateFor(SESSION, createInput(), deps);
		expect(result.ok).toBe(true);
		if (!result.ok || result.stage !== "approve") throw new Error("expected the approve stage");

		const decoded = decodeApproval(result.approve.data);
		expect(decoded).not.toBeNull();
		// THE FENCE: the spender is the OptionFactory, which is what pulls the
		// escrow. A mutant that expects the OptionBook here fails.
		expect(decoded?.spender).toBe(factory.toLowerCase());
		expect(decoded?.spender).not.toBe(OPTION_BOOK.toLowerCase());
		expect(decoded?.amount).toBe("500000");
		expect(result.allowance.spender).toBe(factory.toLowerCase());
		expect(result.allowance.tokenSymbol).toBe("USDC");
		expect(result.expected.deposit).toBe("0.5");
		expect(result.expected.depositBaseUnits).toBe("500000");

		// No row and no dry run at the approval stage: nothing has been requested.
		expect(state.rows.size).toBe(0);
		expect(state.dryRuns).toEqual([]);
	});

	test("with the allowance covered it dry-runs, writes a pending row and issues a bound ticket", async () => {
		const { deps, state, factory } = makeDeps({ allowance: 500_000n });
		const result = await prepareRfqCreateFor(SESSION, createInput(), deps);
		expect(result.ok).toBe(true);
		if (!result.ok || result.stage !== "create") throw new Error("expected the create stage");

		expect(result.create.to.toLowerCase()).toBe(factory.toLowerCase());
		expect(state.dryRuns).toEqual([
			{ account: WALLET, to: result.create.to, data: result.create.data },
		]);
		expect(result.expected.strikesUsd).toEqual(["2300"]);
		expect(result.expected.numContracts).toBe("1");
		expect(result.expected.maxLossUsd).toBe("0.5");
		expect(result.expected.expiryAt).toBe(new Date(EXPIRY * 1000).toISOString());
		// The offer end is the SDK's own `Date.now() + minutes`, so it tracks the
		// REAL clock rather than the injected one (`buildRFQParams` reads its own
		// clock; `buildRfqCreate` checks the two agree to within 5 s). Asserted as
		// a band around real now for exactly that reason.
		const offerEndSeconds = Date.parse(result.expected.offerEndAt) / 1000;
		expect(Math.abs(offerEndSeconds - (Date.now() / 1000 + DEADLINE_MINUTES * 60))).toBeLessThanOrEqual(5);
		expect(result.preparedAt).toBe(new Date(NOW_MS).toISOString());

		const row = state.rows.get(result.rfqRequestId);
		expect(row?.status).toBe("pending_create");
		expect(row?.walletAddress).toBe(WALLET);
		expect(row?.deposit).toBe("500000");
		expect(row?.quotationId).toBeNull();
		expect(row?.requesterPublicKey).toBe(PUBLIC_KEY);

		const ticket = decodeRfqTicket(result.token);
		expect(ticket?.kind).toBe("rfq_create");
		expect(ticket?.wallet).toBe(WALLET);
		expect(ticket?.userId).toBe(USER);
		expect(ticket?.rfqRequestId).toBe(result.rfqRequestId);
		expect(ticket?.factory).toBe(factory.toLowerCase());
	});

	/**
	 * THE CEILING. It runs before EITHER stage returns, so the approval leg can
	 * never grant an allowance for an escrow the create leg would refuse.
	 * Mutant: delete the `withinRfqDepositLimit` call in `prepare.ts`.
	 */
	test("an escrow over 10 USD is refused at BOTH stages, with no row and no approval", async () => {
		const over = createInput({ reservePricePerContract: "11" });
		for (const allowance of [0n, 500_000_000n]) {
			const { deps, state } = makeDeps({ allowance });
			const result = await prepareRfqCreateFor(SESSION, over, deps);
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("unreachable");
			expect(result.code).toBe("RFQ_OVER_LIMIT");
			expect(result.reason).toContain("11 USD");
			expect(state.rows.size).toBe(0);
			expect(state.dryRuns).toEqual([]);
		}
	});

	test("exactly 10 USD passes", async () => {
		const { deps } = makeDeps({ allowance: 10_000_000n });
		const result = await prepareRfqCreateFor(SESSION, createInput({ reservePricePerContract: "10" }), deps);
		expect(result.ok).toBe(true);
	});

	test("a reverting dry run refuses and writes no row", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n, dryRunReverts: "execution reverted: BAD_EXPIRY" });
		const result = await prepareRfqCreateFor(SESSION, createInput(), deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_SIMULATION_REVERTED");
		expect(result.reason).toContain("BAD_EXPIRY");
		expect(state.rows.size).toBe(0);
	});

	test("an unreadable allowance refuses rather than assuming zero", async () => {
		const { deps, state } = makeDeps();
		const broken: RfqDeps = {
			...deps,
			clientFor: () => {
				const client = testClient();
				return {
					...client,
					erc20: {
						encodeApprove: client.erc20.encodeApprove,
						getAllowance: async () => {
							throw new Error("rpc down");
						},
					},
				};
			},
		};
		const result = await prepareRfqCreateFor(SESSION, createInput(), broken);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("CHAIN_UNAVAILABLE");
		expect(state.rows.size).toBe(0);
	});

	test.each([
		["an unsupported underlying", createInput({ underlying: "SOL" }), "RFQ_UNSUPPORTED_UNDERLYING"],
		["an unparseable expiry", createInput({ expiry: "next friday" }), "RFQ_INVALID_DEADLINE"],
		["an expiry before the offer deadline", createInput({ expiry: NOW_S + 60 }), "RFQ_INVALID_DEADLINE"],
		["three strikes", createInput({ strikesUsd: ["1", "2", "3"] }), "RFQ_STRUCTURE_UNSUPPORTED"],
		["duplicate strikes", createInput({ strikesUsd: ["2300", "2300"] }), "RFQ_DUPLICATE_STRIKES"],
		["a zero contract count", createInput({ numContracts: "0" }), "RFQ_INVALID_AMOUNT"],
		["more reserve decimals than USDC holds", createInput({ reservePricePerContract: "0.1234567" }), "RFQ_PRECISION_UNSUPPORTED"],
	])("refuses %s", async (_name, input, code) => {
		const { deps, state } = makeDeps({ allowance: 10n ** 12n });
		const result = await prepareRfqCreateFor(SESSION, input as Parameters<typeof prepareRfqCreateFor>[1], deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe(code as string);
		expect(state.rows.size).toBe(0);
	});

	test("a put SPREAD encodes both strikes and shows them ascending", async () => {
		const { deps } = makeDeps({ allowance: 500_000n });
		const result = await prepareRfqCreateFor(SESSION, createInput({ strikesUsd: ["2100", "2300"] }), deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.expected.strikesUsd).toEqual(["2100", "2300"]);
	});

	test("an ISO expiry is accepted and lands on the same instant", async () => {
		const iso = new Date(EXPIRY * 1000).toISOString();
		const { deps } = makeDeps({ allowance: 500_000n });
		const result = await prepareRfqCreateFor(SESSION, createInput({ expiry: iso }), deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.expected.expiryAt).toBe(iso);
	});
});

/* ───────────────────────────── record create ───────────────────────────── */

const requestedLog = (input: { factory: string; id: bigint; requester: string }) => ({
	address: input.factory,
	topics: [QUOTATION_REQUESTED_TOPIC, idTopic(input.id), topicOf(input.requester)],
	data: "0x",
});

async function preparedCreate(options: DepsOptions = {}) {
	const { deps, state } = makeDeps({ allowance: 500_000n, ...options });
	const prepared = await prepareRfqCreateFor(SESSION, createInput(), deps);
	if (!prepared.ok || prepared.stage !== "create") throw new Error("fixture: expected a create stage");
	return { deps, state, token: prepared.token, rowId: prepared.rfqRequestId };
}

describe("recordRfqCreateFor", () => {
	test("binds the quotation id from the factory's own log", async () => {
		const { deps, state, token, rowId } = await preparedCreate({
			receipt: {
				status: "success",
				logs: [requestedLog({ factory: FACTORY, id: 900n, requester: WALLET })],
			},
		});
		const result = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(result).toEqual({ ok: true, rfqRequestId: rowId, quotationId: "900", status: "active" });
		const row = state.rows.get(rowId);
		expect(row?.status).toBe("active");
		expect(row?.quotationId).toBe("900");
		expect(row?.createTx).toBe(TX);
	});

	/**
	 * A reverted create is a RECORDED failure, not a refusal: the row carries it
	 * and the answer is `ok` with `status: "failed"`, so the browser can let go of
	 * the transaction it is holding instead of retrying a reverted hash forever.
	 * `components/agent/rfq-execution.tsx` branches on exactly that.
	 */
	test("a reverted receipt records the failure and says so", async () => {
		const { deps, state, token, rowId } = await preparedCreate({ receipt: { status: "reverted", logs: [] } });
		const result = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("failed");
		expect(result.quotationId).toBeNull();
		expect(String(result.note)).toContain("nothing was escrowed");
		expect(state.rows.get(rowId)?.status).toBe("failed");
		expect(state.rows.get(rowId)?.failureReason).toBe("transaction_reverted");
	});

	test("a transaction that does not call the factory records nothing", async () => {
		const { deps, state, token, rowId } = await preparedCreate({
			transaction: { to: OPTION_BOOK, input: "0x" },
			receipt: {
				status: "success",
				logs: [requestedLog({ factory: FACTORY, id: 900n, requester: WALLET })],
			},
		});
		const result = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RECEIPT_MISMATCH");
		expect(state.rows.get(rowId)?.quotationId).toBeNull();
		expect(state.rows.get(rowId)?.status).toBe("failed");
	});

	test("a QuotationRequested for ANOTHER requester is not this wallet's request", async () => {
		const { deps, state, token, rowId } = await preparedCreate({
			receipt: {
				status: "success",
				logs: [requestedLog({ factory: FACTORY, id: 900n, requester: OTHER_WALLET })],
			},
		});
		const result = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RECEIPT_MISMATCH");
		expect(state.rows.get(rowId)?.quotationId).toBeNull();
	});

	test("a QuotationRequested emitted by another contract is ignored", async () => {
		const { deps, token } = await preparedCreate({
			receipt: {
				status: "success",
				logs: [requestedLog({ factory: OPTION_BOOK, id: 900n, requester: WALLET })],
			},
		});
		const result = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RECEIPT_MISMATCH");
	});

	/**
	 * THE SESSION BINDING. Mutant: drop the `ticket.wallet !== session.wallet`
	 * comparison in `verifyForRecord`.
	 */
	test("a ticket cannot be replayed by another wallet or another user", async () => {
		const { deps, token } = await preparedCreate({
			receipt: { status: "success", logs: [] },
		});
		const otherWallet = await recordRfqCreateFor(
			{ userId: USER, walletAddress: OTHER_WALLET },
			{ token, txHash: TX },
			deps,
		);
		expect(otherWallet.ok).toBe(false);
		if (otherWallet.ok) throw new Error("unreachable");
		expect(otherWallet.code).toBe("WALLET_MISMATCH");

		const otherUser = await recordRfqCreateFor(
			{ userId: OTHER_USER, walletAddress: WALLET },
			{ token, txHash: TX },
			deps,
		);
		expect(otherUser.ok).toBe(false);
		if (otherUser.ok) throw new Error("unreachable");
		expect(otherUser.code).toBe("WALLET_MISMATCH");
	});

	test("a cancel ticket cannot record a create", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n, isActive: true });
		const row = await activeRow(deps, state);
		const cancel = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(cancel.ok).toBe(true);
		if (!cancel.ok) throw new Error("unreachable");
		const result = await recordRfqCreateFor(SESSION, { token: cancel.token, txHash: TX }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("BAD_TICKET");
	});

	test("an unreadable chain leaves the row pending so a retry can still find it", async () => {
		const { deps, state, token, rowId } = await preparedCreate({ readerThrows: true });
		const result = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("CHAIN_UNAVAILABLE");
		expect(state.rows.get(rowId)?.status).toBe("pending_create");
	});

	test("a malformed transaction hash is refused before any chain read", async () => {
		const { deps, token } = await preparedCreate();
		const result = await recordRfqCreateFor(SESSION, { token, txHash: "0xnope" }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("BAD_TX_HASH");
	});

	test("a second recording of the same create returns the stored row rather than a second bind", async () => {
		const { deps, state, token, rowId } = await preparedCreate({
			receipt: {
				status: "success",
				logs: [requestedLog({ factory: FACTORY, id: 900n, requester: WALLET })],
			},
		});
		expect((await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps)).ok).toBe(true);
		const again = await recordRfqCreateFor(SESSION, { token, txHash: TX }, deps);
		expect(again).toEqual({ ok: true, rfqRequestId: rowId, quotationId: "900", status: "active" });
		expect(state.rows.size).toBe(1);
	});
});

/* ───────────────────────────── cancel ───────────────────────────── */

describe("prepareRfqCancelFor", () => {
	test("prepares a cancel for an active request and issues a cancel ticket", async () => {
		const { deps, state, factory } = makeDeps({ allowance: 500_000n });
		const row = await activeRow(deps, state);
		const result = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.cancel.to.toLowerCase()).toBe(factory.toLowerCase());
		expect(result.quotationId).toBe("125");
		expect(state.dryRuns.at(-1)?.to).toBe(result.cancel.to);
		const ticket = decodeRfqTicket(result.token);
		expect(ticket?.kind).toBe("rfq_cancel");
		expect(ticket?.quotationId).toBe("125");
	});

	test("refuses a request that belongs to another wallet", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n });
		const row = await activeRow(deps, state);
		const result = await prepareRfqCancelFor(
			{ userId: OTHER_USER, walletAddress: OTHER_WALLET },
			{ rfqRequestId: row.id },
			deps,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_FOUND");
	});

	test("refuses a row that never reached the chain", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n });
		const prepared = await prepareRfqCreateFor(SESSION, createInput(), deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("fixture");
		expect(state.rows.get(prepared.rfqRequestId)?.quotationId).toBeNull();
		const result = await prepareRfqCancelFor(SESSION, { rfqRequestId: prepared.rfqRequestId }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_ON_CHAIN");
	});

	test("refuses when the factory says the quotation is no longer active", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n, isActive: false });
		const row = await activeRow(deps, state);
		const result = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_ACTIVE");
	});

	test("an unreadable chain refuses rather than assuming the request is cancellable", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n, quotationThrows: true });
		const row = await activeRow(deps, state);
		const result = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("CHAIN_UNAVAILABLE");
	});
});

/* ───────────────────────────── settle ───────────────────────────── */

describe("prepareRfqSettleFor", () => {
	/**
	 * THE READINESS FENCE. Mutant: drop the `status.nextAction !== "settle"`
	 * check in `prepareRfqSettleFor`.
	 */
	test("refuses before the offer deadline, naming what is still pending", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n, currentWinner: WINNER, nowMs: NOW_MS });
		const row = await activeRow(deps, state);
		const result = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_SETTLEABLE");
		expect(result.reason).toContain("Market makers can still send offers");
	});

	test("refuses inside the reveal window", async () => {
		const { deps, state } = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			nowMs: (OFFER_END + REVEAL - 1) * 1000,
		});
		const row = await activeRow(deps, state);
		const result = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_SETTLEABLE");
		expect(result.reason).toContain("reveal");
	});

	test("refuses after the reveal window when no offer won", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n, nowMs: (OFFER_END + REVEAL + 1) * 1000 });
		const row = await activeRow(deps, state);
		const result = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_SETTLEABLE");
		expect(result.reason).toContain("nothing to settle");
	});

	test("refuses when the reveal window itself could not be read", async () => {
		const { deps, state } = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			revealWindow: null,
			nowMs: (OFFER_END + 86_400) * 1000,
		});
		const row = await activeRow(deps, state);
		const result = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RFQ_NOT_SETTLEABLE");
	});

	test("prepares a settle once the window has passed and an offer has won", async () => {
		const { deps, state, factory } = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			nowMs: (OFFER_END + REVEAL + 1) * 1000,
		});
		const row = await activeRow(deps, state);
		const result = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.settle.to.toLowerCase()).toBe(factory.toLowerCase());
		expect(result.bestPrice).toBe("500000");
		expect(decodeRfqTicket(result.token)?.kind).toBe("rfq_settle");
	});
});

/* ───────────────────────── record cancel and settle ───────────────────────── */

describe("recordRfqCancelFor and recordRfqSettleFor", () => {
	let prepared: Awaited<ReturnType<typeof makeDeps>>;
	beforeEach(() => {
		prepared = makeDeps({ allowance: 500_000n });
	});

	test("a cancel receipt whose calldata names ANOTHER quotation records nothing", async () => {
		const row = await activeRow(prepared.deps, prepared.state);
		const cancel = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, prepared.deps);
		if (!cancel.ok) throw new Error("fixture");
		// `cancelQuotation(uint256)` for id 999, not 125.
		const other = `0x${cancel.cancel.data.slice(2, 10)}${(999n).toString(16).padStart(64, "0")}` as `0x${string}`;
		const deps: RfqDeps = {
			...prepared.deps,
			reader: {
				async waitForTransactionReceipt() {
					return { status: "success", logs: [] } as never;
				},
				async getTransaction() {
					return { to: prepared.factory, input: other };
				},
			},
		};
		const result = await recordRfqCancelFor(SESSION, { token: cancel.token, txHash: TX }, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RECEIPT_MISMATCH");
		expect(prepared.state.rows.get(row.id)?.status).toBe("active");
	});

	test("a good cancel receipt closes the row", async () => {
		const row = await activeRow(prepared.deps, prepared.state);
		const cancel = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, prepared.deps);
		if (!cancel.ok) throw new Error("fixture");
		const deps: RfqDeps = {
			...prepared.deps,
			reader: {
				async waitForTransactionReceipt() {
					return { status: "success", logs: [] } as never;
				},
				async getTransaction() {
					return { to: prepared.factory, input: cancel.cancel.data };
				},
			},
		};
		const result = await recordRfqCancelFor(SESSION, { token: cancel.token, txHash: TX }, deps);
		expect(result.ok).toBe(true);
		expect(prepared.state.rows.get(row.id)?.status).toBe("cancelled");
		expect(prepared.state.rows.get(row.id)?.cancelTx).toBe(TX);
	});

	/** Nothing happened on chain, so the row stays exactly as it was — and says so. */
	test("a reverted cancel leaves the request active", async () => {
		const row = await activeRow(prepared.deps, prepared.state);
		const cancel = await prepareRfqCancelFor(SESSION, { rfqRequestId: row.id }, prepared.deps);
		if (!cancel.ok) throw new Error("fixture");
		const deps: RfqDeps = {
			...prepared.deps,
			reader: {
				async waitForTransactionReceipt() {
					return { status: "reverted", logs: [] } as never;
				},
				async getTransaction() {
					return { to: prepared.factory, input: cancel.cancel.data };
				},
			},
		};
		const result = await recordRfqCancelFor(SESSION, { token: cancel.token, txHash: TX }, deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.status).toBe("active");
		expect(String(result.note)).toContain("the request is unchanged");
		expect(prepared.state.rows.get(row.id)?.status).toBe("active");
		expect(prepared.state.rows.get(row.id)?.cancelTx).toBeNull();
	});

	test("a settle receipt records the option address out of QuotationSettled", async () => {
		const ready = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			nowMs: (OFFER_END + REVEAL + 1) * 1000,
		});
		const row = await activeRow(ready.deps, ready.state);
		const settle = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, ready.deps);
		if (!settle.ok) throw new Error("fixture");
		const deps: RfqDeps = {
			...ready.deps,
			reader: {
				async waitForTransactionReceipt() {
					return {
						status: "success",
						logs: [
							{
								address: ready.factory,
								topics: [SETTLED_TOPIC, idTopic(125n), topicOf(WALLET), topicOf(WINNER)],
								data: topicOf(OPTION_ADDRESS),
							},
						],
					} as never;
				},
				async getTransaction() {
					return { to: ready.factory, input: settle.settle.data };
				},
			},
		};
		const result = await recordRfqSettleFor(SESSION, { token: settle.token, txHash: TX }, deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.optionAddress?.toLowerCase()).toBe(OPTION_ADDRESS.toLowerCase());
		expect(ready.state.rows.get(row.id)?.status).toBe("settled");
		expect(ready.state.rows.get(row.id)?.settleTx).toBe(TX);
	});

	test("a settle with no decodable log stores null rather than guessing", async () => {
		const ready = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			nowMs: (OFFER_END + REVEAL + 1) * 1000,
		});
		const row = await activeRow(ready.deps, ready.state);
		const settle = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, ready.deps);
		if (!settle.ok) throw new Error("fixture");
		const deps: RfqDeps = {
			...ready.deps,
			reader: {
				async waitForTransactionReceipt() {
					return { status: "success", logs: [] } as never;
				},
				async getTransaction() {
					return { to: ready.factory, input: settle.settle.data };
				},
			},
		};
		const result = await recordRfqSettleFor(SESSION, { token: settle.token, txHash: TX }, deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("unreachable");
		expect(result.optionAddress).toBeNull();
	});

	test("a settle ticket cannot record a cancellation", async () => {
		const ready = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			nowMs: (OFFER_END + REVEAL + 1) * 1000,
		});
		const row = await activeRow(ready.deps, ready.state);
		const settle = await prepareRfqSettleFor(SESSION, { rfqRequestId: row.id }, ready.deps);
		if (!settle.ok) throw new Error("fixture");
		const result = await recordRfqCancelFor(SESSION, { token: settle.token, txHash: TX }, ready.deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("BAD_TICKET");
	});
});

/* ───────────────────────────── status readout ───────────────────────────── */

describe("rfqStatusForRequest", () => {
	test("refuses without a session and for another wallet's request", async () => {
		const { deps, state } = makeDeps({ allowance: 500_000n });
		const row = await activeRow(deps, state);
		expect(await rfqStatusForRequest(null, { rfqRequestId: row.id }, deps)).toMatchObject({
			ok: false,
			code: "NO_SESSION",
			needsSignIn: true,
		});
		const theirs = await rfqStatusForRequest(
			{ userId: OTHER_USER, walletAddress: OTHER_WALLET },
			{ rfqRequestId: row.id },
			deps,
		);
		expect(theirs).toMatchObject({ ok: false, code: "RFQ_NOT_FOUND" });
	});

	test("reports the plain-words status with the identifiers the card renders", async () => {
		const { deps, state } = makeDeps({
			allowance: 500_000n,
			currentWinner: WINNER,
			nowMs: (OFFER_END + REVEAL + 1) * 1000,
		});
		const row = await activeRow(deps, state);
		const answer = await rfqStatusForRequest(SESSION, { rfqRequestId: row.id }, deps);
		expect(answer.ok).toBe(true);
		if (!answer.ok) throw new Error("unreachable");
		expect(answer.rfqRequestId).toBe(row.id);
		expect(answer.status).toMatchObject({
			status: "ready_to_settle",
			nextAction: "settle",
			quotationId: "125",
			hasWinner: true,
			// The indexer throws in these fixtures, so this is the FACTORY's own
			// `currentBestPriceOrReserve` — which is why `hasWinner` sits beside it.
			bestPrice: "500000",
		});
		expect(answer.status.sentence).toContain("permissionless");
		expect(answer.status.settleReadyAt).toBe(new Date((OFFER_END + REVEAL) * 1000).toISOString());
	});

	test("a row that never reached the chain reads pending_create and offers nothing to do", async () => {
		const { deps } = makeDeps({ allowance: 500_000n });
		const prepared = await prepareRfqCreateFor(SESSION, createInput(), deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("fixture");
		const answer = await rfqStatusForRequest(SESSION, { rfqRequestId: prepared.rfqRequestId }, deps);
		expect(answer.ok).toBe(true);
		if (!answer.ok) throw new Error("unreachable");
		expect(answer.status).toMatchObject({
			status: "pending_create",
			nextAction: "none",
			quotationId: null,
			optionAddress: null,
		});
	});
});
