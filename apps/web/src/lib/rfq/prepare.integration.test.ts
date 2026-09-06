/**
 * The RFQ path against a real database: prepare → record → cancel, and two
 * wallets that cannot see each other's requests.
 *
 * Needs BOTH a loopback `DATABASE_URL` passed on the command (the shared fence
 * in `packages/db/src/test-fence.ts` refuses anything else, and refuses a value
 * only an env file supplied) and an `RFQ_KEY_MASTER_KEY` — `@nuts/env/server`
 * validates once at import, so the variable has to be in the environment before
 * the process starts:
 *
 *   cd apps/web && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/claude_rfq2 \
 *     bun test src/lib/rfq/prepare.integration.test.ts
 *
 * It writes and deletes only the `rfq_requests` and `agent_rfq_keys` rows for
 * the random wallets it mints. The CHAIN is still injected: nothing here reads
 * Base and nothing here signs or sends.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@nuts/db";
import { agentRfqKeys, rfqRequests } from "@nuts/db/schema/index";
import { MemoryStorageProvider } from "@thetanuts-finance/thetanuts-client";
import { QUOTATION_REQUESTED_TOPIC, createRfqClient } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";
import {
	prepareRfqCancelFor,
	prepareRfqCreateFor,
	recordRfqCancelFor,
	recordRfqCreateFor,
	type RfqDeps,
	type RfqSdkClient,
} from "./prepare";
import { getOrCreateWalletRfqKey, rfqKeysConfigured } from "./keys";
import { drizzleRfqStore } from "./store";

const databaseUrl = process.env.DATABASE_URL;
const ready = Boolean(databaseUrl) && rfqKeysConfigured();
if (!ready) {
	console.log(
		`rfq prepare integration skipped: ${databaseUrl ? "" : "DATABASE_URL is not set; "}${rfqKeysConfigured() ? "" : "RFQ_KEY_MASTER_KEY is not set"}`,
	);
}
const describeLive = ready ? describe : describe.skip;

const wallets: string[] = [];
const newWallet = () => {
	const wallet = `0x${randomBytes(20).toString("hex")}`;
	wallets.push(wallet);
	return wallet;
};

afterAll(async () => {
	if (ready && wallets.length > 0) {
		await db.delete(rfqRequests).where(inArray(rfqRequests.walletAddress, wallets));
		await db.delete(agentRfqKeys).where(inArray(agentRfqKeys.walletAddress, wallets));
	}
});

const TX = (seed: string) => `0x${seed.repeat(64).slice(0, 64)}`;
const NOW = new Date();
const EXPIRY = Math.floor(NOW.getTime() / 1000) + 7 * 86_400;
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const idTopic = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}`;

function liveDeps(options: {
	receipt?: { status: string; logs: { address: string; topics: string[]; data: string }[] };
	transactionTo?: string;
	transactionInput?: `0x${string}`;
	isActive?: boolean;
}): { deps: RfqDeps; factory: string } {
	const base = createRfqClient({
		rpcUrl: env.BASE_RPC_URL,
		referrer: env.THESIS_REFERRER,
		keyStorageProvider: new MemoryStorageProvider(),
	});
	const factoryModule = base.optionFactory;
	const factory = String(base.chainConfig.contracts.optionFactory);
	const client: RfqSdkClient = {
		chainConfig: base.chainConfig,
		optionFactory: {
			buildRFQRequest: factoryModule.buildRFQRequest.bind(factoryModule),
			encodeRequestForQuotation: factoryModule.encodeRequestForQuotation.bind(factoryModule),
			encodeCancelQuotation: factoryModule.encodeCancelQuotation.bind(factoryModule),
			encodeSettleQuotation: factoryModule.encodeSettleQuotation.bind(factoryModule),
			getQuotation: async () =>
				({
					params: { offerEndTimestamp: BigInt(EXPIRY - 86_400), expiryTimestamp: BigInt(EXPIRY) },
					state: {
						isActive: options.isActive ?? true,
						currentWinner: "0x0000000000000000000000000000000000000000",
						currentBestPriceOrReserve: 500_000n,
						feeCollected: 0n,
						optionContract: "0x0000000000000000000000000000000000000000",
					},
				}) as unknown as Awaited<ReturnType<RfqSdkClient["optionFactory"]["getQuotation"]>>,
			getRevealWindow: async () => 60n,
		},
		erc20: {
			encodeApprove: base.erc20.encodeApprove.bind(base.erc20),
			// Already approved, so every case below reaches the create stage.
			getAllowance: async () => 10n ** 12n,
		},
		api: {
			getRfq: async () => {
				throw new Error("indexer not used in this test");
			},
			getUserOptionsFromRfq: async () => [],
		},
		mmPricing: { getAllPricing: async () => ({}) },
	};
	return {
		factory,
		deps: {
			clientFor: () => client,
			dryRun: async () => ({ ok: true }),
			reader: {
				async waitForTransactionReceipt() {
					return (options.receipt ?? { status: "success", logs: [] }) as never;
				},
				async getTransaction() {
					return { to: options.transactionTo ?? factory, input: options.transactionInput ?? "0x" };
				},
			},
			// THE REAL STORE and THE REAL DATABASE: this is what the file is for.
			store: drizzleRfqStore(db),
			database: db,
			now: () => new Date(),
			// THE REAL KEY MINT, so `agent_rfq_keys` is exercised end to end.
			ensureKey: (wallet, database) => getOrCreateWalletRfqKey(wallet, database),
			keysConfigured: rfqKeysConfigured,
		},
	};
}

const input = {
	underlying: "ETH" as const,
	strikesUsd: ["2300"],
	expiry: EXPIRY,
	numContracts: "1",
	reservePricePerContract: "0.5",
	offerDeadlineMinutes: 60,
};

describeLive("the RFQ path against a real database", () => {
	test("prepare writes a pending row and mints the wallet's key", async () => {
		const wallet = newWallet();
		const { deps } = liveDeps({});
		const prepared = await prepareRfqCreateFor({ userId: crypto.randomUUID(), walletAddress: wallet }, input, deps);
		expect(prepared.ok).toBe(true);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("expected the create stage");

		const stored = await drizzleRfqStore(db).findOwn(prepared.rfqRequestId, wallet);
		expect(stored?.status).toBe("pending_create");
		expect(stored?.deposit).toBe("500000");
		expect(stored?.collateralSymbol).toBe("USDC");
		expect(stored?.quotationId).toBeNull();
		// The public key on the row is the one the calldata carried, and the
		// PRIVATE half never leaves `agent_rfq_keys`.
		const keys = await db.select().from(agentRfqKeys);
		const mine = keys.find((row) => row.walletAddress === wallet);
		expect(mine?.publicKey).toBe(stored?.requesterPublicKey as string);
		expect(JSON.stringify(stored)).not.toContain(String(mine?.encryptedPrivateKey));
	});

	test("record binds the quotation id, then the row can be cancelled and closed", async () => {
		const wallet = newWallet();
		const session = { userId: crypto.randomUUID(), walletAddress: wallet };
		const created = liveDeps({});
		const prepared = await prepareRfqCreateFor(session, input, created.deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("expected the create stage");

		const createTx = TX("1");
		const recording = liveDeps({
			receipt: {
				status: "success",
				logs: [
					{
						address: created.factory,
						topics: [QUOTATION_REQUESTED_TOPIC, idTopic(4242n), topicOf(wallet)],
						data: "0x",
					},
				],
			},
		});
		const recorded = await recordRfqCreateFor(session, { token: prepared.token, txHash: createTx }, recording.deps);
		expect(recorded).toEqual({
			ok: true,
			rfqRequestId: prepared.rfqRequestId,
			quotationId: "4242",
			status: "active",
		});

		const cancelPrep = await prepareRfqCancelFor(session, { rfqRequestId: prepared.rfqRequestId }, recording.deps);
		expect(cancelPrep.ok).toBe(true);
		if (!cancelPrep.ok) throw new Error("unreachable");
		expect(cancelPrep.quotationId).toBe("4242");

		const cancelTx = TX("2");
		const cancelling = liveDeps({
			transactionInput: cancelPrep.cancel.data,
		});
		const closed = await recordRfqCancelFor(session, { token: cancelPrep.token, txHash: cancelTx }, cancelling.deps);
		expect(closed.ok).toBe(true);

		const row = await drizzleRfqStore(db).findOwn(prepared.rfqRequestId, wallet);
		expect(row?.status).toBe("cancelled");
		expect(row?.cancelTx).toBe(cancelTx);
		expect(row?.createTx).toBe(createTx);
	});

	/**
	 * THE CONCURRENCY FENCE, against the real `UPDATE ... WHERE quotation_id IS
	 * NULL`. Two recordings of the same create cannot both bind the row, and the
	 * loser reads the winner's answer rather than writing a second one.
	 */
	test("two concurrent recordings of one create bind it once", async () => {
		const wallet = newWallet();
		const session = { userId: crypto.randomUUID(), walletAddress: wallet };
		const base = liveDeps({});
		const prepared = await prepareRfqCreateFor(session, input, base.deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("expected the create stage");

		const recording = liveDeps({
			receipt: {
				status: "success",
				logs: [
					{
						address: base.factory,
						topics: [QUOTATION_REQUESTED_TOPIC, idTopic(777n), topicOf(wallet)],
						data: "0x",
					},
				],
			},
		});
		const [first, second] = await Promise.all([
			recordRfqCreateFor(session, { token: prepared.token, txHash: TX("3") }, recording.deps),
			recordRfqCreateFor(session, { token: prepared.token, txHash: TX("3") }, recording.deps),
		]);
		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		if (!first.ok || !second.ok) throw new Error("unreachable");
		expect(first.quotationId).toBe("777");
		expect(second.quotationId).toBe("777");
		const rows = await drizzleRfqStore(db).listForWallet(wallet, 10);
		expect(rows.length).toBe(1);
		expect(rows[0]?.status).toBe("active");
	});

	/**
	 * MEASURED, and stated because it is easy to get wrong: through
	 * `recordRfqCreateFor` this case is caught by the IDEMPOTENCY branch (a row
	 * that is already `active` returns its stored answer and never reaches the
	 * store), so `WHERE quotation_id IS NULL` is a SECOND fence behind an
	 * application-level one. The store-level test below is what proves the
	 * condition itself; this one proves the behaviour a caller sees.
	 */
	test("a later receipt cannot re-point a bound row at another quotation", async () => {
		const wallet = newWallet();
		const session = { userId: crypto.randomUUID(), walletAddress: wallet };
		const base = liveDeps({});
		const prepared = await prepareRfqCreateFor(session, input, base.deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("expected the create stage");

		const withId = (id: bigint) =>
			liveDeps({
				receipt: {
					status: "success",
					logs: [
						{
							address: base.factory,
							topics: [QUOTATION_REQUESTED_TOPIC, idTopic(id), topicOf(wallet)],
							data: "0x",
						},
					],
				},
			});
		const first = await recordRfqCreateFor(session, { token: prepared.token, txHash: TX("5") }, withId(111n).deps);
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error("unreachable");
		expect(first.quotationId).toBe("111");

		const second = await recordRfqCreateFor(session, { token: prepared.token, txHash: TX("6") }, withId(222n).deps);
		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error("unreachable");
		expect(second.quotationId).toBe("111");

		const row = await drizzleRfqStore(db).findOwn(prepared.rfqRequestId, wallet);
		expect(row?.quotationId).toBe("111");
		expect(row?.createTx).toBe(TX("5"));
	});

	/** Two wallets, two key rows, and neither can read or cancel the other's request. */
	test("wallets are isolated", async () => {
		const mine = newWallet();
		const theirs = newWallet();
		const myself = { userId: crypto.randomUUID(), walletAddress: mine };
		const other = { userId: crypto.randomUUID(), walletAddress: theirs };
		const { deps } = liveDeps({});

		const prepared = await prepareRfqCreateFor(myself, input, deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("expected the create stage");
		const theirPrepared = await prepareRfqCreateFor(other, input, deps);
		if (!theirPrepared.ok || theirPrepared.stage !== "create") throw new Error("expected the create stage");

		const store = drizzleRfqStore(db);
		expect(await store.findOwn(prepared.rfqRequestId, theirs)).toBeNull();
		expect((await store.listForWallet(mine, 10)).map((row) => row.id)).toEqual([prepared.rfqRequestId]);

		// Their session cannot even prepare a cancel for my row.
		const refused = await prepareRfqCancelFor(other, { rfqRequestId: prepared.rfqRequestId }, deps);
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error("unreachable");
		expect(refused.code).toBe("RFQ_NOT_FOUND");

		// And their key is their own.
		const keys = await db.select().from(agentRfqKeys).where(inArray(agentRfqKeys.walletAddress, [mine, theirs]));
		expect(keys.length).toBe(2);
		expect(keys[0]?.publicKey).not.toBe(keys[1]?.publicKey);
	});

	test("a receipt that is not the factory's marks the row failed and leaves it unbound", async () => {
		const wallet = newWallet();
		const session = { userId: crypto.randomUUID(), walletAddress: wallet };
		const base = liveDeps({});
		const prepared = await prepareRfqCreateFor(session, input, base.deps);
		if (!prepared.ok || prepared.stage !== "create") throw new Error("expected the create stage");

		const wrong = liveDeps({ transactionTo: "0x1bDff855d6811728acaDC00989e79143a2bdfDed" });
		const result = await recordRfqCreateFor(session, { token: prepared.token, txHash: TX("4") }, wrong.deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.code).toBe("RECEIPT_MISMATCH");
		const row = await drizzleRfqStore(db).findOwn(prepared.rfqRequestId, wallet);
		expect(row?.status).toBe("failed");
		expect(row?.quotationId).toBeNull();
	});
});

describeLive("the rfq_requests store's own conditions", () => {
	const store = () => drizzleRfqStore(db);
	/**
	 * Fresh quotation ids per case. MEASURED the hard way: reusing an id another
	 * case in this file had already bound made the UPDATE throw, because
	 * `rfq_requests_factory_quotation_key` (migration 0010) is unique over
	 * (factory_address, quotation_id) where the id is not null — the index doing
	 * exactly what it is for.
	 */
	let nextId = 900_000;
	const quotationId = () => String((nextId += 1));
	const seed = async (wallet: string) =>
		await store().insertPending({
			walletAddress: wallet,
			status: "pending_create",
			params: { underlying: "ETH" },
			deposit: "500000",
			collateralSymbol: "USDC",
			factoryAddress: "0x8118dad971debffb49b9280047659174128a8b94",
			requesterPublicKey: `0x02${"33".repeat(32)}`,
		});

	/**
	 * `WHERE quotation_id IS NULL`. Mutant: drop that clause and the second bind
	 * silently re-points the row at an id it never created.
	 */
	test("bindQuotation binds once and only once", async () => {
		const wallet = newWallet();
		const row = await seed(wallet);
		const bound = quotationId();
		const first = await store().bindQuotation({
			id: row.id,
			wallet,
			quotationId: bound,
			createTx: TX("7"),
			at: new Date(),
		});
		expect(first?.quotationId).toBe(bound);
		const second = await store().bindQuotation({
			id: row.id,
			wallet,
			quotationId: quotationId(),
			createTx: TX("8"),
			at: new Date(),
		});
		expect(second).toBeNull();
		expect((await store().findOwn(row.id, wallet))?.quotationId).toBe(bound);
	});

	/**
	 * `WHERE status = 'active'`. Mutant: drop it and a cancel can overwrite a
	 * settlement, or a replayed recording can regress a terminal row.
	 */
	test("markTerminal closes an active row once, and never re-opens or re-closes one", async () => {
		const wallet = newWallet();
		const row = await seed(wallet);
		// A pending row is not active, so it cannot be closed at all.
		expect(
			await store().markTerminal({ id: row.id, wallet, status: "cancelled", cancelTx: TX("9"), at: new Date() }),
		).toBeNull();

		await store().bindQuotation({ id: row.id, wallet, quotationId: quotationId(), createTx: TX("a"), at: new Date() });
		const settled = await store().markTerminal({
			id: row.id,
			wallet,
			status: "settled",
			settleTx: TX("b"),
			optionAddress: "0x4444444444444444444444444444444444444444",
			at: new Date(),
		});
		expect(settled?.status).toBe("settled");

		const overwritten = await store().markTerminal({
			id: row.id,
			wallet,
			status: "cancelled",
			cancelTx: TX("c"),
			at: new Date(),
		});
		expect(overwritten).toBeNull();
		const final = await store().findOwn(row.id, wallet);
		expect(final?.status).toBe("settled");
		expect(final?.cancelTx).toBeNull();
	});

	/** Every method is scoped by wallet, not only by id. */
	test("another wallet can neither read nor write the row", async () => {
		const wallet = newWallet();
		const stranger = newWallet();
		const row = await seed(wallet);
		expect(await store().findOwn(row.id, stranger)).toBeNull();
		expect(
			await store().bindQuotation({ id: row.id, wallet: stranger, quotationId: quotationId(), createTx: TX("d"), at: new Date() }),
		).toBeNull();
		await store().markFailed({ id: row.id, wallet: stranger, reason: "not_yours", at: new Date() });
		expect((await store().findOwn(row.id, wallet))?.status).toBe("pending_create");
	});

	/** A malformed id is answered, not sent to Postgres as a broken `uuid` cast. */
	test("findOwn answers null for an id that is not a uuid", async () => {
		expect(await store().findOwn("not-a-uuid", newWallet())).toBeNull();
	});
});
