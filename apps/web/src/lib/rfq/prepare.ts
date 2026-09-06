import "server-only";

/**
 * The one RFQ money path: prepare an OptionFactory create, cancel or settle for
 * the user's wallet to sign, and bind the mined receipt back to a row.
 *
 * Same shape and the same fences as `lib/trade/prepare.ts` + `lib/trade/record.ts`,
 * because it is the same class of thing — unsigned calldata handed to a wallet,
 * and a receipt read back from Base afterwards. Read those two first.
 *
 * WHAT IS DIFFERENT ABOUT AN RFQ.
 *
 *  - The escrow is charged at CREATION. A BUY RFQ locks
 *    `reservePricePerContract × numContracts` of USDC, pulled by the FACTORY,
 *    so USDC is approved to the factory (never the OptionBook) for exactly that
 *    amount. It is refunded on cancel and any unspent part is refunded at
 *    settlement, which makes the escrow the buyer's maximum loss — and the
 *    quantity `lib/rfq/limits.ts` bounds at 10 USD.
 *  - There is no fill to simulate and no maker signature to race. What is
 *    simulated instead is the create itself: a raw `eth_call` from the
 *    requester's address. The SDK's own `callStaticCreateRFQ` cannot be used —
 *    it calls `requireSigner()` and this process holds no key.
 *  - The option, if any, is minted at SETTLEMENT, by whoever sends
 *    `settleQuotation` — which is permissionless once the reveal window has
 *    passed. So the REQUEST is the row, `rfq_requests`, and there is no
 *    `positions` row for it. `option_address` records what settlement produced.
 *
 * NOTHING HERE SIGNS OR SENDS. Every write returns `{to, data}` for the wallet.
 * The wallet is taken from the server session and never from an argument, so a
 * prompt-injected model cannot point an escrow at an address the user never
 * chose.
 */
import { decodeFunctionData, encodeEventTopics, type Abi, type Address, type Hex } from "viem";
import { OPTION_FACTORY_ABI, type StateRfq, type ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import {
	QUOTATION_REQUESTED_TOPIC,
	ThetanutsLogicError,
	buildRfqCancel,
	buildRfqCreate,
	buildRfqSettle,
	createRfqClient,
	decodeQuotationRequested,
	type RfqUnderlying, RFQ_MAX_EXPIRY_DAYS } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";
import { db as defaultDb } from "@nuts/db";
import type { RfqRequest } from "@nuts/db/schema/index";
import { getSession } from "@/lib/auth/session";
import { decimalFromBaseUnits } from "@/lib/data/decimal";
import { approvalMatches, decodeApproval } from "@/lib/trade/approval";
import { publicClient, simulateFill } from "@/lib/trade/chain";
import { dbKeyStorage, getOrCreateWalletRfqKey, rfqKeysConfigured, type Database } from "./keys";
import { drizzleRfqStore, type RfqRowStore } from "./store";
import { withinRfqDepositLimit } from "./limits";
import { decodeRfqTicket, encodeRfqTicket, type RfqTicketKind, type RfqTicketPayload } from "./ticket";
import { rfqStatusFor, type RfqChainView, type RfqIndexerView, type RfqStatusName, type RfqNextAction } from "./status";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const factoryAbi = OPTION_FACTORY_ABI as unknown as Abi;

/** TODO-OWNER: every sentence in this object. Nothing in the PRD or the mockup words an RFQ. */
const COPY = {
	signIn: "Sign in with your wallet before preparing a request for quotation.",
	unconfigured:
		"Custom option requests are switched off in this deployment because no RFQ key is configured, so nothing was prepared.",
	approve:
		"Approve USDC for exactly this request. Nothing is escrowed until you sign the request itself.",
	create:
		"Sign in your wallet. This escrows the deposit; it is returned if you cancel, and anything unspent is returned when the request settles.",
	cancel: "Sign in your wallet. Cancelling returns the escrowed deposit to you.",
	settle:
		"Sign in your wallet. Settling is permissionless — anyone can send it — and it mints the option to the winning offer.",
	notYours: "No request with that id belongs to the signed-in wallet.",
	notOnChain: "That request is not on chain yet, so there is nothing to send for it.",
	notActive: "That request is no longer active on the factory, so it can no longer be cancelled or settled.",
} as const;

/* ────────────────────────────── result shapes ────────────────────────────── */

export interface TxRequest {
	readonly to: `0x${string}`;
	readonly data: `0x${string}`;
	readonly value: "0";
}

export interface RfqExpected {
	/** Escrow in USDC base units, decimal string. The buyer's maximum loss. */
	readonly depositBaseUnits: string;
	/** The same amount as a decimal USDC figure. */
	readonly deposit: string;
	/** ASCENDING for display; the calldata's own order is the factory's (a put spread is descending). */
	readonly strikesUsd: string[];
	/** Decimal contracts, as the user said them. */
	readonly numContracts: string;
	readonly expiryAt: string;
	readonly offerEndAt: string;
	readonly factory: string;
	/** Deposit valued in USD through `collateralUsdPrice` — the number the 10 USD gate read. */
	readonly maxLossUsd: string;
	readonly collateralSymbol: "USDC";
}

export interface RfqFailure {
	readonly ok: false;
	readonly code: string;
	readonly reason: string;
	readonly needsSignIn?: boolean;
}

export type RfqPrepareResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly stage: "approve";
			readonly approve: TxRequest;
			readonly allowance: {
				readonly amount: string;
				readonly spender: string;
				readonly tokenAddress: string;
				readonly tokenSymbol: "USDC";
				readonly tokenDecimals: 6;
			};
			readonly expected: RfqExpected;
			readonly note: string;
	  }
	| {
			readonly ok: true;
			readonly stage: "create";
			readonly create: TxRequest;
			/** Signed ticket; hand back to `recordRfqCreateFor` unchanged. */
			readonly token: string;
			readonly rfqRequestId: string;
			readonly expected: RfqExpected;
			readonly preparedAt: string;
			readonly note: string;
	  };

export type RfqCancelResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly cancel: TxRequest;
			readonly quotationId: string;
			readonly rfqRequestId: string;
			readonly token: string;
			readonly preparedAt: string;
			readonly note: string;
	  };

export type RfqSettleResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly settle: TxRequest;
			readonly quotationId: string;
			readonly rfqRequestId: string;
			readonly token: string;
			/** The winning offer on chain, in USDC base units, or null when unreadable. */
			readonly bestPrice: string | null;
			readonly preparedAt: string;
			readonly note: string;
	  };

export type RfqRecordResult =
	| RfqFailure
	| {
			readonly ok: true;
			readonly rfqRequestId: string;
			readonly quotationId: string | null;
			readonly status: string;
			/** Present on settle when the `QuotationSettled` log could be decoded. */
			readonly optionAddress?: string | null;
			/** One sentence when the transaction reverted, or when nothing changed. */
			readonly note?: string;
	  };

export interface PrepareRfqCreateInput {
	readonly underlying: string;
	readonly strikesUsd: readonly string[];
	/** Unix seconds, or an ISO instant. */
	readonly expiry: number | string;
	readonly numContracts: string;
	readonly reservePricePerContract: string;
	/**
	 * OPTIONAL on the wire because W3's `RfqCreateRequest` makes it optional, and
	 * REFUSED here when it is absent: nothing in this build picks a default offer
	 * deadline. TODO-OWNER — the Thetanuts docs use 60 in their examples, which is
	 * theirs, not the owner's.
	 */
	readonly offerDeadlineMinutes?: number;
}

/** What `rfq_requests.params` holds. Nothing here is key material. */
export interface RfqRowParams {
	readonly underlying: RfqUnderlying;
	/** ASCENDING, for display. */
	readonly strikesUsd: string[];
	/** 8-decimal integers in the FACTORY's own order, exactly as the calldata carries them. */
	readonly strikesUsd8: string[];
	readonly expiryTimestamp: number;
	readonly offerEndTimestamp: number;
	readonly numContracts: string;
	readonly numContractsBaseUnits: string;
	readonly reservePricePerContract: string;
	readonly offerDeadlineMinutes: number;
	readonly implementation: string;
	readonly collateralDecimals: number;
}

/* ─────────────────────────────── seams ─────────────────────────────── */

/** The SDK surface this module and `lib/agent/rfq-tools.ts` use. A `ThetanutsClient` satisfies it. */
export interface RfqSdkClient {
	readonly chainConfig: ThetanutsClient["chainConfig"];
	readonly optionFactory: Pick<
		ThetanutsClient["optionFactory"],
		| "buildRFQRequest"
		| "encodeRequestForQuotation"
		| "encodeCancelQuotation"
		| "encodeSettleQuotation"
		| "getQuotation"
		| "getRevealWindow"
	>;
	readonly erc20: Pick<ThetanutsClient["erc20"], "encodeApprove" | "getAllowance">;
	readonly api: Pick<ThetanutsClient["api"], "getRfq" | "getUserOptionsFromRfq">;
	readonly mmPricing: Pick<ThetanutsClient["mmPricing"], "getAllPricing">;
}

/** The two receipt reads. Structural, so viem's public client satisfies it and a test can supply one. */
export interface RfqChainReader {
	waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
		status: string;
		logs: readonly { address: string; topics: readonly string[]; data: string }[];
	}>;
	getTransaction(args: { hash: `0x${string}` }): Promise<{ to: string | null; input: `0x${string}` }>;
}

export interface RfqDeps {
	/** Per WALLET: the key storage the SDK reads the requester's ECDH key through. */
	readonly clientFor: (wallet: string) => RfqSdkClient;
	readonly dryRun: (input: {
		account: Address;
		to: Address;
		data: Hex;
	}) => Promise<{ ok: true } | { ok: false; reason: string }>;
	readonly reader: RfqChainReader;
	/** Every `rfq_requests` read and write. See `./store.ts`. */
	readonly store: RfqRowStore;
	/** Only the RFQ KEY path needs a raw handle; the rows go through `store`. */
	readonly database: Database;
	readonly now: () => Date;
	/** Mints or reads the wallet's RFQ keypair and returns ONLY the public half. */
	readonly ensureKey: (wallet: string, database: Database) => Promise<{ compressedPublicKey: string }>;
	readonly keysConfigured: () => boolean;
}

/** The real client for one wallet: durable per-wallet key storage, read-only RPC. */
export function rfqClientFor(wallet: string, database: Database = defaultDb): RfqSdkClient {
	return createRfqClient({
		rpcUrl: env.BASE_RPC_URL,
		referrer: env.THESIS_REFERRER,
		keyStorageProvider: dbKeyStorage(wallet, database),
	});
}

export function defaultRfqDeps(): RfqDeps {
	return {
		clientFor: (wallet) => rfqClientFor(wallet),
		dryRun: simulateFill,
		reader: publicClient(),
		store: drizzleRfqStore(defaultDb),
		database: defaultDb,
		now: () => new Date(),
		ensureKey: (wallet, database) => getOrCreateWalletRfqKey(wallet, database),
		keysConfigured: rfqKeysConfigured,
	};
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function fail(code: string, reason: string, needsSignIn = false): RfqFailure {
	return needsSignIn ? { ok: false, code, reason, needsSignIn } : { ok: false, code, reason };
}

function asTx(input: { to: string; data: string }): TxRequest {
	if (!HEX_ADDRESS.test(input.to) || !/^0x[0-9a-fA-F]*$/.test(input.data)) {
		throw new Error("Encoder returned malformed calldata");
	}
	return { to: input.to as `0x${string}`, data: input.data as `0x${string}`, value: "0" };
}

const sameAddress = (left: string | null | undefined, right: string | null | undefined): boolean =>
	typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

/** topic0 of one factory event, from the ABI — never a literal, and never an ambiguous name. */
function factoryEventTopic(name: string): Hex {
	const events = (OPTION_FACTORY_ABI as readonly { type?: string; name?: string }[]).filter(
		(entry) => entry.type === "event" && entry.name === name,
	);
	if (events.length !== 1) {
		throw new Error(`OPTION_FACTORY_ABI carries ${events.length} ${name} events; expected exactly 1`);
	}
	return encodeEventTopics({ abi: [events[0] as Abi[number]] })[0] as Hex;
}

/** `QuotationSettled(uint256 indexed, address indexed, address indexed, address optionAddress)`. */
const quotationSettledTopic: Hex = factoryEventTopic("QuotationSettled");
/** `QuotationCancelled(uint256 indexed quotationId)` — the id is its only argument. */
const quotationCancelledTopic: Hex = factoryEventTopic("QuotationCancelled");

/**
 * Unix seconds from either an ISO instant or a number, or null.
 *
 * `isSafeInteger`, not `isInteger` (A-4): past 2^53 the number is no longer the
 * one that was written, and `buildRfqCreate` bounds the plausible range from
 * both ends after this.
 */
export function unixSecondsFrom(value: number | string): number | null {
	if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
	}
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

const ascending = (values: readonly bigint[]): bigint[] =>
	[...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

/** A `ThetanutsLogicError` keeps its own code; anything else is a build failure. */
function buildFailure(error: unknown): RfqFailure {
	if (error instanceof ThetanutsLogicError) return fail(error.code, error.message);
	return fail("RFQ_BUILD_FAILED", error instanceof Error ? error.message : "This request could not be built.");
}

/** Runtime shape check for the `params` jsonb; nothing downstream trusts the column blindly. */
export function parseRfqRowParams(value: unknown): RfqRowParams | null {
	if (typeof value !== "object" || value === null) return null;
	const raw = value as Record<string, unknown>;
	const strings = (key: string): string[] | null => {
		const list = raw[key];
		return Array.isArray(list) && list.every((entry) => typeof entry === "string") ? (list as string[]) : null;
	};
	const number = (key: string): number | null => (typeof raw[key] === "number" ? (raw[key] as number) : null);
	const text = (key: string): string | null => (typeof raw[key] === "string" ? (raw[key] as string) : null);
	const underlying = text("underlying");
	const strikesUsd = strings("strikesUsd");
	const strikesUsd8 = strings("strikesUsd8");
	const expiryTimestamp = number("expiryTimestamp");
	const offerEndTimestamp = number("offerEndTimestamp");
	const numContracts = text("numContracts");
	const numContractsBaseUnits = text("numContractsBaseUnits");
	const reservePricePerContract = text("reservePricePerContract");
	const offerDeadlineMinutes = number("offerDeadlineMinutes");
	const implementation = text("implementation");
	const collateralDecimals = number("collateralDecimals");
	if (
		(underlying !== "ETH" && underlying !== "BTC") ||
		strikesUsd === null ||
		strikesUsd8 === null ||
		expiryTimestamp === null ||
		offerEndTimestamp === null ||
		numContracts === null ||
		numContractsBaseUnits === null ||
		reservePricePerContract === null ||
		offerDeadlineMinutes === null ||
		implementation === null ||
		collateralDecimals === null
	) {
		return null;
	}
	return {
		underlying,
		strikesUsd,
		strikesUsd8,
		expiryTimestamp,
		offerEndTimestamp,
		numContracts,
		numContractsBaseUnits,
		reservePricePerContract,
		offerDeadlineMinutes,
		implementation,
		collateralDecimals,
	};
}

/**
 * Are these two rows' terms the same request?
 *
 * Every field of `RfqRowParams`, compared as the strings and numbers they are —
 * `JSON.stringify` would not do, because Postgres normalises a `jsonb` object's
 * key order and a round-tripped row therefore serialises differently from the
 * object that was written.
 */
export function sameRfqParams(left: RfqRowParams, right: RfqRowParams): boolean {
	const sameList = (a: readonly string[], b: readonly string[]) =>
		a.length === b.length && a.every((value, index) => value === b[index]);
	return (
		left.underlying === right.underlying &&
		sameList(left.strikesUsd, right.strikesUsd) &&
		sameList(left.strikesUsd8, right.strikesUsd8) &&
		left.expiryTimestamp === right.expiryTimestamp &&
		left.numContracts === right.numContracts &&
		left.numContractsBaseUnits === right.numContractsBaseUnits &&
		left.reservePricePerContract === right.reservePricePerContract &&
		left.offerDeadlineMinutes === right.offerDeadlineMinutes &&
		left.implementation === right.implementation &&
		left.collateralDecimals === right.collateralDecimals
	);
	// `offerEndTimestamp` is deliberately NOT compared: it is "now + the deadline"
	// and moves with every prepare, so comparing it would make every re-prepare a
	// different request and defeat the reuse.
}

/** How many of a wallet's unbound pending rows a re-prepare will look through. */
const REUSABLE_PENDING_ROWS = 20;

/* ─────────────────────────────── create ─────────────────────────────── */

export async function prepareRfqCreateFor(
	session: { userId: string; walletAddress: string } | null,
	input: PrepareRfqCreateInput,
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqPrepareResult> {
	if (session === null) return fail("NO_SESSION", COPY.signIn, true);
	// Fail closed before anything is read: with no master key an RFQ key would
	// have to be written in clear, and `lib/rfq/keys.ts` refuses to do that.
	if (!deps.keysConfigured()) return fail("RFQ_KEYS_UNCONFIGURED", COPY.unconfigured);

	const wallet = session.walletAddress.toLowerCase();
	if (!HEX_ADDRESS.test(wallet)) return fail("BAD_WALLET", "The signed-in wallet is not a Base address.");
	const expiry = unixSecondsFrom(input.expiry);
	// A-4 on the SERVER's clock (not the SDK's wall clock, which the package uses for
	// its own band): an expiry further than RFQ_MAX_EXPIRY_DAYS from `deps.now()` is
	// refused before anything is built, so a fixed test clock governs the horizon.
	// Only values that read as SECONDS are judged here (below 1e11 = year 5138); anything
	// larger is left to `buildRfqCreate`, whose refusal names the millisecond mistake.
	if (typeof expiry === "number" && Number.isFinite(expiry) && expiry < 1e11 && expiry > Math.floor(deps.now().getTime() / 1000) + RFQ_MAX_EXPIRY_DAYS * 86_400) {
		return fail("RFQ_INVALID_DEADLINE", `The option expiry is further than ${RFQ_MAX_EXPIRY_DAYS} days away, which this build does not request.`);
	}
	if (expiry === null) {
		return fail("RFQ_INVALID_DEADLINE", "The expiry must be a unix timestamp in seconds or an ISO instant.");
	}
	if (input.underlying !== "ETH" && input.underlying !== "BTC") {
		return fail("RFQ_UNSUPPORTED_UNDERLYING", `Requests are built for ETH and BTC only, not ${String(input.underlying)}.`);
	}
	const offerDeadlineMinutes = input.offerDeadlineMinutes;
	if (offerDeadlineMinutes === undefined) {
		return fail(
			"RFQ_INVALID_DEADLINE",
			// TODO-OWNER: there is no default offer deadline in this build.
			"How many minutes market makers have to answer has to be chosen; nothing here picks a default.",
		);
	}

	// PRD 14's freshness clock, stamped BEFORE the reads so the age this reports
	// is never younger than the truth.
	const preparedAt = deps.now().toISOString();
	const client = deps.clientFor(wallet);

	// The public key has to exist before the build: `encodeRequestForQuotation`
	// validates it, and a request whose key was never stored could never have its
	// offers decrypted (docs: no recovery).
	let requesterPublicKey: string;
	try {
		({ compressedPublicKey: requesterPublicKey } = await deps.ensureKey(wallet, deps.database));
	} catch (error) {
		return fail(
			"RFQ_KEY_UNAVAILABLE",
			error instanceof Error ? error.message : "This wallet's request key could not be read.",
		);
	}

	const factory = client.chainConfig.contracts.optionFactory;
	if (!factory || !HEX_ADDRESS.test(factory) || sameAddress(factory, ZERO_ADDRESS)) {
		return fail("RFQ_FACTORY_UNAVAILABLE", "No OptionFactory is configured on Base in this build.");
	}
	const usdc = client.chainConfig.tokens.USDC;
	if (!usdc) return fail("RFQ_FACTORY_UNAVAILABLE", "USDC is not configured on Base in this build.");

	let allowance: bigint;
	try {
		allowance = await client.erc20.getAllowance(usdc.address, wallet, factory);
	} catch {
		return fail("CHAIN_UNAVAILABLE", "Base could not be read to check your USDC allowance, so nothing was prepared.");
	}

	let build: ReturnType<typeof buildRfqCreate>;
	try {
		build = buildRfqCreate({
			client,
			allowance,
			params: {
				requester: wallet as `0x${string}`,
				underlying: input.underlying,
				strikesUsd: input.strikesUsd,
				expiry,
				numContracts: input.numContracts,
				reservePricePerContract: input.reservePricePerContract,
				offerDeadlineMinutes,
				requesterPublicKey,
			},
		});
	} catch (error) {
		return buildFailure(error);
	}

	// THE CEILING, on the escrow the CALLDATA carries — not on a number computed
	// beside it. It runs before either stage returns, so the approval leg cannot
	// grant an allowance the create leg would then be refused for (the hole
	// `lib/agent/limits.ts` closed for the OptionBook path).
	const gate = withinRfqDepositLimit({
		depositBaseUnits: build.expected.depositBaseUnits.toString(),
		collateralSymbol: build.expected.collateral.symbol,
		collateralDecimals: build.expected.collateral.decimals,
	});
	if (!gate.ok) return fail(gate.code, gate.reason);

	// `toISOString` THROWS `RangeError` on a timestamp outside JavaScript's date
	// range, and it sits outside the try that wraps `buildRfqCreate`, so an
	// out-of-range value used to escape a server action as an unclassified error
	// instead of a refusal (A-4). `buildRfqCreate` now bounds the expiry, which
	// makes this unreachable through the product; it is caught anyway, because
	// "unreachable" is an argument and a refusal is a fact.
	let expected: RfqExpected;
	try {
		expected = {
			depositBaseUnits: build.expected.depositBaseUnits.toString(),
			deposit: decimalFromBaseUnits(build.expected.depositBaseUnits.toString(), build.expected.collateral.decimals),
			strikesUsd: ascending(build.expected.strikesUsd8).map((strike) => decimalFromBaseUnits(strike.toString(), 8)),
			numContracts: decimalFromBaseUnits(build.expected.numContracts.toString(), build.expected.collateral.decimals),
			expiryAt: new Date(Number(build.expected.expiryTimestamp) * 1000).toISOString(),
			offerEndAt: new Date(Number(build.expected.offerEndTimestamp) * 1000).toISOString(),
			factory: build.factory,
			maxLossUsd: gate.depositUsd,
			collateralSymbol: "USDC",
		};
	} catch {
		return fail(
			"RFQ_INVALID_DEADLINE",
			"The expiry or the offer deadline is not a date this build can express, so nothing was prepared.",
		);
	}

	if (build.approve !== undefined) {
		const approve = asTx(build.approve);
		// PRD 10.2: "Allowances must be exact for the approved transaction." Read
		// out of the bytes that will be signed, and the spender must be the
		// FACTORY — the contract that pulls the escrow — never the OptionBook.
		const check = approvalMatches({
			data: approve.data,
			expectedSpender: build.factory,
			expectedAmount: expected.depositBaseUnits,
		});
		if (!check.ok) return fail("APPROVAL_NOT_EXACT", check.reason);
		const decoded = decodeApproval(approve.data);
		if (decoded === null) return fail("APPROVAL_NOT_EXACT", "The approval calldata could not be read.");
		return {
			ok: true,
			stage: "approve",
			approve,
			allowance: {
				amount: decoded.amount,
				spender: decoded.spender,
				tokenAddress: approve.to,
				tokenSymbol: "USDC",
				tokenDecimals: 6,
			},
			expected,
			note: COPY.approve,
		};
	}

	const create = asTx(build.create);
	const simulated = await deps.dryRun({ account: wallet as Address, to: create.to, data: create.data });
	if (!simulated.ok) {
		return fail("RFQ_SIMULATION_REVERTED", `This request would revert on Base: ${simulated.reason}`);
	}

	const params: RfqRowParams = {
		underlying: input.underlying,
		strikesUsd: expected.strikesUsd,
		strikesUsd8: build.expected.strikesUsd8.map((strike) => strike.toString()),
		expiryTimestamp: Number(build.expected.expiryTimestamp),
		offerEndTimestamp: Number(build.expected.offerEndTimestamp),
		numContracts: expected.numContracts,
		numContractsBaseUnits: build.expected.numContracts.toString(),
		reservePricePerContract: decimalFromBaseUnits(
			build.expected.reservePriceBaseUnits.toString(),
			build.expected.collateral.decimals,
		),
		offerDeadlineMinutes,
		implementation: build.expected.implementation,
		collateralDecimals: build.expected.collateral.decimals,
	};

	// REUSE BEFORE INSERT. The card prepares more than once per press by design
	// (re-prepare, the pre-approval fence, the staleness re-check) and a wallet
	// rejection leaves its row behind, so identical terms used to pile up rows
	// that name no quotation and moved no money (C-5). An unbound `pending_create`
	// row of this wallet with exactly these terms IS this request: it is made
	// current again and its id handed back, so an earlier ticket still resolves.
	// Nothing is deleted — deleting a row a broadcast ticket points at would
	// strand a real escrow with no row to record it against.
	const factoryAddress = build.factory.toLowerCase();
	const reusable = (await deps.store.listUnboundPending(wallet, REUSABLE_PENDING_ROWS)).find((candidate) => {
		if (!sameAddress(candidate.factoryAddress, factoryAddress)) return false;
		if (candidate.deposit !== expected.depositBaseUnits) return false;
		if (candidate.requesterPublicKey !== requesterPublicKey) return false;
		const stored = parseRfqRowParams(candidate.params);
		return stored !== null && sameRfqParams(stored, params);
	});
	const row =
		(reusable === undefined ? null : await deps.store.touchPending({ id: reusable.id, wallet, at: deps.now() })) ??
		(await deps.store.insertPending({
			walletAddress: wallet,
			status: "pending_create",
			params,
			deposit: expected.depositBaseUnits,
			collateralSymbol: "USDC",
			factoryAddress,
			requesterPublicKey,
		}));

	return {
		ok: true,
		stage: "create",
		create,
		rfqRequestId: row.id,
		token: encodeRfqTicket(ticketFor("rfq_create", session, row.id, build.factory, null, expected.depositBaseUnits, deps)),
		expected,
		preparedAt,
		note: COPY.create,
	};
}

function ticketFor(
	kind: RfqTicketKind,
	session: { userId: string; walletAddress: string },
	rfqRequestId: string,
	factory: string,
	quotationId: string | null,
	depositBaseUnits: string | null,
	deps: RfqDeps,
): RfqTicketPayload {
	return {
		v: 1,
		kind,
		userId: session.userId,
		wallet: session.walletAddress.toLowerCase(),
		chainId: 8453,
		rfqRequestId,
		factory: factory.toLowerCase(),
		quotationId,
		depositBaseUnits,
		issuedAt: Math.floor(deps.now().getTime() / 1000),
	};
}

/* ────────────────────────── cancel and settle ────────────────────────── */

async function loadOwnRow(
	session: { walletAddress: string },
	rfqRequestId: string,
	deps: RfqDeps,
): Promise<RfqRequest | null> {
	return await deps.store.findOwn(rfqRequestId, session.walletAddress.toLowerCase());
}

/** The factory's own view of one quotation, or null when it could not be read. */
async function readQuotation(
	client: RfqSdkClient,
	quotationId: bigint,
): Promise<{ chain: RfqChainView; bestPrice: string } | null> {
	try {
		const quotation = await client.optionFactory.getQuotation(quotationId);
		return {
			chain: {
				isActive: quotation.state.isActive,
				currentWinner: quotation.state.currentWinner,
				optionContract: quotation.state.optionContract,
				offerEndTimestamp: Number(quotation.params.offerEndTimestamp),
			},
			bestPrice: quotation.state.currentBestPriceOrReserve.toString(),
		};
	} catch {
		return null;
	}
}

async function readRevealWindow(client: RfqSdkClient): Promise<number | null> {
	try {
		return Number(await client.optionFactory.getRevealWindow());
	} catch {
		return null;
	}
}

export async function prepareRfqCancelFor(
	session: { userId: string; walletAddress: string } | null,
	input: { rfqRequestId: string },
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqCancelResult> {
	if (session === null) return fail("NO_SESSION", COPY.signIn, true);
	const row = await loadOwnRow(session, input.rfqRequestId, deps);
	if (row === null) return fail("RFQ_NOT_FOUND", COPY.notYours);
	if (row.quotationId === null) return fail("RFQ_NOT_ON_CHAIN", COPY.notOnChain);
	if (row.status !== "active") {
		return fail("RFQ_NOT_ACTIVE", `That request is recorded as ${row.status}, so there is nothing to cancel.`);
	}

	const preparedAt = deps.now().toISOString();
	const client = deps.clientFor(session.walletAddress.toLowerCase());
	const quotationId = BigInt(row.quotationId);
	const quotation = await readQuotation(client, quotationId);
	if (quotation === null) {
		return fail("CHAIN_UNAVAILABLE", "Base could not be read to check this request, so nothing was prepared.");
	}
	// FAIL CLOSED: only an ACTIVE quotation can be cancelled, and "we could not
	// read it" is never treated as active.
	if (!quotation.chain.isActive) return fail("RFQ_NOT_ACTIVE", COPY.notActive);

	let cancel: TxRequest;
	try {
		cancel = asTx(buildRfqCancel(client, quotationId));
	} catch (error) {
		return buildFailure(error);
	}
	const simulated = await deps.dryRun({
		account: session.walletAddress as Address,
		to: cancel.to,
		data: cancel.data,
	});
	if (!simulated.ok) return fail("RFQ_SIMULATION_REVERTED", `Cancelling would revert on Base: ${simulated.reason}`);

	return {
		ok: true,
		cancel,
		quotationId: row.quotationId,
		rfqRequestId: row.id,
		token: encodeRfqTicket(ticketFor("rfq_cancel", session, row.id, row.factoryAddress, row.quotationId, null, deps)),
		preparedAt,
		note: COPY.cancel,
	};
}

export async function prepareRfqSettleFor(
	session: { userId: string; walletAddress: string } | null,
	input: { rfqRequestId: string },
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqSettleResult> {
	if (session === null) return fail("NO_SESSION", COPY.signIn, true);
	const row = await loadOwnRow(session, input.rfqRequestId, deps);
	if (row === null) return fail("RFQ_NOT_FOUND", COPY.notYours);
	if (row.quotationId === null) return fail("RFQ_NOT_ON_CHAIN", COPY.notOnChain);
	if (row.status !== "active") {
		return fail("RFQ_NOT_ACTIVE", `That request is recorded as ${row.status}, so there is nothing to settle.`);
	}

	const preparedAt = deps.now().toISOString();
	const client = deps.clientFor(session.walletAddress.toLowerCase());
	const quotationId = BigInt(row.quotationId);
	const quotation = await readQuotation(client, quotationId);
	if (quotation === null) {
		return fail("CHAIN_UNAVAILABLE", "Base could not be read to check this request, so nothing was prepared.");
	}
	if (!quotation.chain.isActive) return fail("RFQ_NOT_ACTIVE", COPY.notActive);

	const revealWindowSeconds = await readRevealWindow(client);
	const params = parseRfqRowParams(row.params);
	const status = rfqStatusFor({
		row: {
			status: row.status,
			quotationId: row.quotationId,
			offerEndTimestamp: params?.offerEndTimestamp ?? null,
			expiryTimestamp: params?.expiryTimestamp ?? null,
		},
		indexer: null,
		chain: quotation.chain,
		revealWindowSeconds,
		now: deps.now(),
	});
	// THE READINESS FENCE. `settleQuotation` is permissionless only after
	// `offerEndTimestamp + getRevealWindow()`, and only a quotation with a
	// winning offeror settles into an option. Anything else is refused with the
	// sentence that says what is still pending — never with silence.
	if (status.nextAction !== "settle") {
		return fail("RFQ_NOT_SETTLEABLE", status.sentence);
	}

	let settle: TxRequest;
	try {
		settle = asTx(buildRfqSettle(client, quotationId));
	} catch (error) {
		return buildFailure(error);
	}
	const simulated = await deps.dryRun({
		account: session.walletAddress as Address,
		to: settle.to,
		data: settle.data,
	});
	if (!simulated.ok) return fail("RFQ_SIMULATION_REVERTED", `Settling would revert on Base: ${simulated.reason}`);

	return {
		ok: true,
		settle,
		quotationId: row.quotationId,
		rfqRequestId: row.id,
		token: encodeRfqTicket(ticketFor("rfq_settle", session, row.id, row.factoryAddress, row.quotationId, null, deps)),
		bestPrice: quotation.bestPrice,
		preparedAt,
		note: COPY.settle,
	};
}

/* ─────────────────────────────── recording ─────────────────────────────── */

interface VerifiedTicket {
	readonly ticket: RfqTicketPayload;
	readonly row: RfqRequest;
	readonly txHash: `0x${string}`;
}

async function verifyForRecord(
	session: { userId: string; walletAddress: string } | null,
	input: { token: string; txHash: string },
	kind: RfqTicketKind,
	deps: RfqDeps,
): Promise<VerifiedTicket | RfqFailure> {
	if (session === null) return fail("NO_SESSION", COPY.signIn, true);
	const ticket = decodeRfqTicket(input.token);
	if (ticket === null || ticket.kind !== kind) {
		return fail("BAD_TICKET", "This request could not be verified. Prepare it again.");
	}
	if (ticket.userId !== session.userId || ticket.wallet !== session.walletAddress.toLowerCase()) {
		return fail("WALLET_MISMATCH", "This request was prepared for a different wallet.");
	}
	const txHash = input.txHash.trim().toLowerCase();
	if (!TX_HASH.test(txHash)) return fail("BAD_TX_HASH", "That is not a Base transaction hash.");
	const row = await loadOwnRow(session, ticket.rfqRequestId, deps);
	if (row === null) return fail("RFQ_NOT_FOUND", COPY.notYours);
	if (!sameAddress(row.factoryAddress, ticket.factory)) {
		return fail("RFQ_FACTORY_MISMATCH", "This request was prepared against a different OptionFactory.");
	}
	return { ticket, row, txHash: txHash as `0x${string}` };
}

/**
 * Writes `failed` ONLY on a row that is still an unbound `pending_create` one.
 *
 * Returns the row it wrote, or null when someone else had already resolved it —
 * the caller then reports what the row really says rather than the failure it
 * was about to record (C-2).
 */
async function markFailed(deps: RfqDeps, id: string, wallet: string, reason: string): Promise<RfqRequest | null> {
	return await deps.store.markFailed({ id, wallet, reason, at: deps.now() });
}

/** The row as it stands now, for the paths where a conditional write found nothing to do. */
async function currentRow(deps: RfqDeps, wallet: string, id: string): Promise<RfqRequest> {
	const current = await loadOwnRow({ walletAddress: wallet }, id, deps);
	if (current === null) throw new Error(`rfq_requests ${id} vanished while confirming`);
	return current;
}

/**
 * Binds a mined create to its row.
 *
 * TWO things are required of the transaction, and neither comes from the
 * browser: it succeeded, and it emitted `QuotationRequested` FROM the
 * OptionFactory this ticket names WITH this wallet as the indexed requester.
 * The quotation id is read out of that log's own topic.
 *
 * The transaction's own `to` is deliberately NOT a condition (C-1): a smart
 * account or a multisig wraps the call, so `to` is an entry point while the
 * factory still emits the event. It only chooses the wording of the refusal
 * when no such log exists.
 */
export async function recordRfqCreateFor(
	session: { userId: string; walletAddress: string } | null,
	input: { token: string; txHash: string },
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqRecordResult> {
	const verified = await verifyForRecord(session, input, "rfq_create", deps);
	if ("ok" in verified) return verified;
	const { row, ticket, txHash } = verified;
	// Idempotent: a retry of a create already bound returns the stored row.
	if (row.quotationId !== null && row.status !== "pending_create") {
		return { ok: true, rfqRequestId: row.id, quotationId: row.quotationId, status: row.status };
	}

	let receipt: Awaited<ReturnType<RfqChainReader["waitForTransactionReceipt"]>>;
	let transaction: Awaited<ReturnType<RfqChainReader["getTransaction"]>>;
	try {
		receipt = await deps.reader.waitForTransactionReceipt({ hash: txHash });
		transaction = await deps.reader.getTransaction({ hash: txHash });
	} catch {
		// The row stays `pending_create`: nothing is wrong with the transaction,
		// only with our ability to read it, so a retry must still find the row.
		return fail("CHAIN_UNAVAILABLE", `Base could not be read to confirm this request. Nothing was recorded; try again. Transaction ${txHash}.`);
	}
	if (receipt.status !== "success") {
		// A DURABLE record of the failure, returned as `ok` with `status: "failed"`.
		// The browser must be able to let go of its held transaction: a refusal
		// would leave the card holding a reverted hash and retrying forever.
		//
		// The write is conditional on the row still being an unbound
		// `pending_create` one (C-2). If another recording bound it in the window
		// between the read above and this write, that row now names a real,
		// escrowed quotation and must NOT be overwritten with "nothing was
		// escrowed"; what the row actually says is returned instead.
		const failed = await markFailed(deps, row.id, ticket.wallet, "transaction_reverted");
		if (failed === null) {
			const current = await currentRow(deps, ticket.wallet, row.id);
			return {
				ok: true,
				rfqRequestId: current.id,
				quotationId: current.quotationId,
				status: current.status,
				// TODO-OWNER: wording.
				note: `That transaction reverted, but this request has since been recorded from another transaction. Transaction ${txHash}.`,
			};
		}
		return {
			ok: true,
			rfqRequestId: row.id,
			quotationId: null,
			status: "failed",
			// TODO-OWNER: wording.
			note: `That transaction reverted, so no request was created and nothing was escrowed. Transaction ${txHash}.`,
		};
	}
	// THE LOG IS READ FIRST, and it — not the transaction's `to` — is what binds.
	//
	// A `QuotationRequested` emitted BY this factory naming THIS wallet as the
	// indexed requester is proof the create happened, whatever address sits at the
	// top of the transaction. A smart account sends this call through an entry
	// point (`lib/wagmi.ts` offers Coinbase Smart Wallet with `preference: "all"`,
	// and ERC-4337 puts the EntryPoint in `to`), a multisig through its own
	// `execute`. Refusing on `to` first wrote those real, escrowed requests off as
	// `failed`, told the user nothing had been escrowed, and left no cancel path
	// to the deposit — the money statement was false and unrecoverable.
	const requesterTopic = `0x${ticket.wallet.slice(2).padStart(64, "0")}`;
	const mine = receipt.logs.filter(
		(log) =>
			sameAddress(log.address, row.factoryAddress) &&
			log.topics[0]?.toLowerCase() === QUOTATION_REQUESTED_TOPIC.toLowerCase() &&
			log.topics[2]?.toLowerCase() === requesterTopic,
	);
	const decoded = decodeQuotationRequested(mine, row.factoryAddress);
	if (decoded === null) {
		// NO PROOF EITHER WAY, so the row is refused and LEFT `pending_create`.
		// A successful receipt that this build cannot read is not evidence that
		// nothing was escrowed, and a retry with the right hash must still find
		// the row. `to` only sharpens the sentence here; it decides nothing.
		// TODO-OWNER: wording.
		return fail(
			"RECEIPT_MISMATCH",
			sameAddress(transaction.to, row.factoryAddress)
				? `That transaction carries no QuotationRequested event from the OptionFactory for this wallet, so nothing was recorded and the request is still waiting for its transaction. Transaction ${txHash}.`
				: `That transaction does not call the OptionFactory and carries none of its request events for this wallet, so nothing was recorded and the request is still waiting for its transaction. Transaction ${txHash}.`,
		);
	}

	const quotationId = decoded.quotationId.toString();
	// Conditional on the row still being unbound (`./store.ts`), so two concurrent
	// recordings of the same hash cannot both write it.
	const bind = await deps.store.bindQuotation({
		id: row.id,
		wallet: ticket.wallet,
		quotationId,
		createTx: txHash,
		at: deps.now(),
	});
	if (bind.kind === "already_bound") {
		const current = await currentRow(deps, ticket.wallet, row.id);
		return { ok: true, rfqRequestId: current.id, quotationId: current.quotationId, status: current.status };
	}
	if (bind.kind === "quotation_taken") {
		// One quotation belongs to exactly one row
		// (`rfq_requests_factory_quotation_key`), so this receipt is a create
		// ALREADY recorded against a different request of this wallet — a
		// mispaired ticket and hash, not a failure of this request. Nothing is
		// written and the row is left `pending_create`, still waiting for its own
		// transaction (C-3). TODO-OWNER: wording.
		return fail(
			"RECEIPT_MISMATCH",
			`That transaction created request ${quotationId}, which is already recorded on another of your requests, so nothing was recorded here. Transaction ${txHash}.`,
		);
	}
	return { ok: true, rfqRequestId: bind.row.id, quotationId, status: bind.row.status };
}

/** The quotation id a `cancelQuotation`/`settleQuotation` transaction actually names. */
function calledQuotationId(input: Hex, expected: "cancelQuotation" | "settleQuotation"): bigint | null {
	let decoded: { functionName: string; args?: readonly unknown[] };
	try {
		decoded = decodeFunctionData({ abi: factoryAbi, data: input });
	} catch {
		return null;
	}
	if (decoded.functionName !== expected) return null;
	const [id] = (decoded.args ?? []) as [unknown];
	return typeof id === "bigint" ? id : null;
}

async function recordIdCall(
	session: { userId: string; walletAddress: string } | null,
	input: { token: string; txHash: string },
	kind: "rfq_cancel" | "rfq_settle",
	deps: RfqDeps,
): Promise<RfqRecordResult> {
	const verified = await verifyForRecord(session, input, kind, deps);
	if ("ok" in verified) return verified;
	const { row, ticket, txHash } = verified;
	const terminal = kind === "rfq_cancel" ? "cancelled" : "settled";
	if (row.status === terminal) {
		return { ok: true, rfqRequestId: row.id, quotationId: row.quotationId, status: row.status, optionAddress: row.optionAddress };
	}
	if (row.quotationId === null || ticket.quotationId !== row.quotationId) {
		return fail("RFQ_NOT_ON_CHAIN", COPY.notOnChain);
	}

	let receipt: Awaited<ReturnType<RfqChainReader["waitForTransactionReceipt"]>>;
	let transaction: Awaited<ReturnType<RfqChainReader["getTransaction"]>>;
	try {
		receipt = await deps.reader.waitForTransactionReceipt({ hash: txHash });
		transaction = await deps.reader.getTransaction({ hash: txHash });
	} catch {
		return fail("CHAIN_UNAVAILABLE", `Base could not be read to confirm this transaction. Nothing was recorded; try again. Transaction ${txHash}.`);
	}
	if (receipt.status !== "success") {
		// The REQUEST is untouched by a reverted cancel or settle: it is still on
		// chain and still active, so the row stays as it is. Returned as `ok` for
		// the same reason a reverted create is: the browser has to be able to stop
		// holding the transaction, and the status it reads back is the truth.
		return {
			ok: true,
			rfqRequestId: row.id,
			quotationId: row.quotationId,
			status: row.status,
			optionAddress: row.optionAddress,
			// TODO-OWNER: wording.
			note: `That transaction reverted, so the request is unchanged. Transaction ${txHash}.`,
		};
	}
	// THE LOG IS READ FIRST HERE TOO, for the same reason it is on the create
	// path (C-1): a smart account or a multisig wraps the call, so the receipt's
	// `to` is an entry point and `transaction.input` is a UserOperation rather
	// than `cancelQuotation`/`settleQuotation`. The factory still emits
	// `QuotationCancelled(uint256 indexed quotationId)` /
	// `QuotationSettled(uint256 indexed quotationId, …)` for THIS row's id, and
	// that log is proof the state change happened whatever address sits at the
	// top of the transaction.
	const idTopic = `0x${BigInt(row.quotationId).toString(16).padStart(64, "0")}`;
	const terminalTopic = kind === "rfq_cancel" ? quotationCancelledTopic : quotationSettledTopic;
	const proof = receipt.logs.find(
		(log) =>
			sameAddress(log.address, row.factoryAddress) &&
			log.topics[0]?.toLowerCase() === terminalTopic.toLowerCase() &&
			log.topics[1]?.toLowerCase() === idTopic,
	);

	// FALLBACK, only when the factory named no such event for this request: the
	// call itself. A plain EOA cancel or settle is recorded by this path exactly
	// as before, so nothing that worked stops working — NOT VERIFIED that a real
	// on-chain cancel emits `QuotationCancelled` (the ABI carries it; no cancel of
	// ours has been mined), which is why this stays rather than being replaced.
	// Neither branch marks anything failed: a cancel or settle that cannot be
	// proven leaves the request exactly as it is, still `active` and still
	// cancellable.
	if (proof === undefined) {
		if (!sameAddress(transaction.to, row.factoryAddress)) {
			return fail(
				"RECEIPT_MISMATCH",
				// TODO-OWNER: wording.
				`That transaction does not call the OptionFactory and carries none of its events for request ${row.quotationId}, so it cannot be the ${kind === "rfq_cancel" ? "cancellation" : "settlement"} that was prepared. Nothing was recorded, and the request is unchanged. Transaction ${txHash}.`,
			);
		}
		const called = calledQuotationId(transaction.input, kind === "rfq_cancel" ? "cancelQuotation" : "settleQuotation");
		if (called === null || called.toString() !== row.quotationId) {
			return fail(
				"RECEIPT_MISMATCH",
				`That transaction does not ${kind === "rfq_cancel" ? "cancel" : "settle"} request ${row.quotationId}, so nothing was recorded and the request is unchanged. Transaction ${txHash}.`,
			);
		}
	}

	// The option address settlement produced, read out of the settled event
	// itself. MEASURED from the ABI: `QuotationSettled`'s only UNINDEXED argument
	// is `optionAddress`, so it is the whole of `data`. A log that cannot be read,
	// or a zero address, leaves the column null rather than guessing.
	let optionAddress: string | null = null;
	if (kind === "rfq_settle" && proof !== undefined) {
		const word = proof.data.replace(/^0x/, "");
		if (word.length === 64) {
			const candidate = `0x${word.slice(24)}`;
			if (HEX_ADDRESS.test(candidate) && !sameAddress(candidate, ZERO_ADDRESS)) optionAddress = candidate;
		}
	}

	const updated = await deps.store.markTerminal({
		id: row.id,
		wallet: ticket.wallet,
		status: terminal,
		...(kind === "rfq_cancel" ? { cancelTx: txHash } : { settleTx: txHash, optionAddress }),
		at: deps.now(),
	});
	if (updated === null) {
		const current = await currentRow(deps, ticket.wallet, row.id);
		return { ok: true, rfqRequestId: current.id, quotationId: current.quotationId, status: current.status, optionAddress: current.optionAddress };
	}
	return { ok: true, rfqRequestId: updated.id, quotationId: updated.quotationId, status: updated.status, optionAddress: updated.optionAddress };
}

export async function recordRfqCancelFor(
	session: { userId: string; walletAddress: string } | null,
	input: { token: string; txHash: string },
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqRecordResult> {
	return recordIdCall(session, input, "rfq_cancel", deps);
}

export async function recordRfqSettleFor(
	session: { userId: string; walletAddress: string } | null,
	input: { token: string; txHash: string },
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqRecordResult> {
	return recordIdCall(session, input, "rfq_settle", deps);
}

/* ───────────────────────────────── reads ───────────────────────────────── */

export interface RfqRowView {
	readonly rfqRequestId: string;
	readonly quotationId: string | null;
	readonly underlying: string | null;
	readonly strikesUsd: string[] | null;
	readonly numContracts: string | null;
	readonly reservePricePerContract: string | null;
	readonly depositUsdc: string;
	readonly collateralSymbol: string;
	readonly expiryAt: string | null;
	readonly createdAt: string;
	readonly createTx: string | null;
	readonly optionAddress: string | null;
	readonly status: ReturnType<typeof rfqStatusFor>;
	/** The indexer's current best offer, in USDC base units, when it could be read. */
	readonly currentBestPriceBaseUnits: string | null;
}

const indexerView = (rfq: StateRfq): RfqIndexerView => ({
	status: rfq.status,
	offerEndTimestamp: rfq.offerEndTimestamp,
	currentBestPrice: rfq.currentBestPrice,
	winner: rfq.winner,
	optionAddress: rfq.optionAddress,
});

/**
 * One row, dressed with whatever the chain and the indexer could add.
 *
 * Both remote reads are best effort and their failure is visible in the status
 * sentence, never silently swallowed into a wrong answer: `rfqStatusFor` fails
 * closed on a missing reveal window and never answers "settle" without a chain
 * read.
 */
export async function rfqRowView(
	row: RfqRequest,
	client: RfqSdkClient,
	now: Date,
	revealWindowSeconds: number | null,
): Promise<RfqRowView> {
	const params = parseRfqRowParams(row.params);
	let indexer: RfqIndexerView | null = null;
	let chain: RfqChainView | null = null;
	let chainBestPrice: string | null = null;
	if (row.quotationId !== null) {
		const [indexed, quotation] = await Promise.all([
			client.api.getRfq(row.quotationId).then(indexerView).catch(() => null),
			readQuotation(client, BigInt(row.quotationId)),
		]);
		indexer = indexed;
		chain = quotation?.chain ?? null;
		chainBestPrice = quotation?.bestPrice ?? null;
	}
	return {
		rfqRequestId: row.id,
		quotationId: row.quotationId,
		underlying: params?.underlying ?? null,
		strikesUsd: params?.strikesUsd ?? null,
		numContracts: params?.numContracts ?? null,
		reservePricePerContract: params?.reservePricePerContract ?? null,
		depositUsdc: decimalFromBaseUnits(row.deposit, params?.collateralDecimals ?? 6),
		collateralSymbol: row.collateralSymbol,
		expiryAt: params === null ? null : new Date(params.expiryTimestamp * 1000).toISOString(),
		createdAt: row.createdAt.toISOString(),
		createTx: row.createTx,
		optionAddress: row.optionAddress,
		status: rfqStatusFor({
			row: {
				status: row.status,
				quotationId: row.quotationId,
				offerEndTimestamp: params?.offerEndTimestamp ?? null,
				expiryTimestamp: params?.expiryTimestamp ?? null,
				failureReason: row.failureReason,
			},
			indexer,
			chain,
			revealWindowSeconds,
			now,
		}),
		/**
		 * The indexer's figure first — it is the one the RFQ page shows — and the
		 * factory's `currentBestPriceOrReserve` when the indexer could not be read.
		 * NOT the same quantity when no offer has won: the chain returns the
		 * RESERVE in that case, which is why `status.hasWinner` is beside it.
		 */
		currentBestPriceBaseUnits: indexer?.currentBestPrice ?? chainBestPrice,
	};
}

export { readRevealWindow };

/**
 * The card's status view of ONE request: `rfqStatusFor`'s plain-words answer
 * plus the three identifiers the card renders beside it.
 *
 * Its own shape rather than `RfqRowView`'s, because this is what the card polls
 * while it waits and it must stay small: `components/agent/rfq-contract.ts`
 * (W3) declares the same fields.
 */
export interface RfqStatusReadout {
	/** Orchestrator (integration): the unions `status.ts` defines, not `string`, so the card's `RfqStatusView` accepts this readout without a cast. */
	readonly status: RfqStatusName;
	readonly nextAction: RfqNextAction;
	readonly sentence: string;
	readonly quotationId: string | null;
	readonly optionAddress: string | null;
	/** The winning (or reserve) price the factory holds, in USDC base units. */
	readonly bestPrice: string | null;
	readonly offerEndAt: string | null;
	readonly settleReadyAt: string | null;
	readonly hasWinner: boolean;
}

export type RfqStatusResult =
	| RfqFailure
	| { readonly ok: true; readonly rfqRequestId: string; readonly status: RfqStatusReadout };

/**
 * Where one of the signed-in wallet's requests stands right now.
 *
 * Scoped by wallet in the store, so "no such request" and "not yours" are one
 * answer. Both remote reads are best effort and `rfqStatusFor` fails closed on
 * what they could not supply.
 */
export async function rfqStatusForRequest(
	session: { userId: string; walletAddress: string } | null,
	input: { rfqRequestId: string },
	deps: RfqDeps = defaultRfqDeps(),
): Promise<RfqStatusResult> {
	if (session === null) return fail("NO_SESSION", COPY.signIn, true);
	const row = await loadOwnRow(session, input.rfqRequestId, deps);
	if (row === null) return fail("RFQ_NOT_FOUND", COPY.notYours);
	const client = deps.clientFor(session.walletAddress.toLowerCase());
	const now = deps.now();
	const view = await rfqRowView(row, client, now, await readRevealWindow(client));
	return {
		ok: true,
		rfqRequestId: row.id,
		status: {
			status: view.status.status,
			nextAction: view.status.nextAction,
			sentence: view.status.sentence,
			quotationId: view.quotationId,
			optionAddress: view.optionAddress,
			bestPrice: view.currentBestPriceBaseUnits,
			offerEndAt: view.status.offerEndAt,
			settleReadyAt: view.status.settleReadyAt,
			hasWinner: view.status.hasWinner,
		},
	};
}

/* ─────────────────────────── cookie-session entry points ─────────────────────────── */

export async function prepareRfqCreate(input: PrepareRfqCreateInput): Promise<RfqPrepareResult> {
	return prepareRfqCreateFor(await getSession(), input);
}
export async function prepareRfqCancel(input: { rfqRequestId: string }): Promise<RfqCancelResult> {
	return prepareRfqCancelFor(await getSession(), input);
}
export async function prepareRfqSettle(input: { rfqRequestId: string }): Promise<RfqSettleResult> {
	return prepareRfqSettleFor(await getSession(), input);
}
export async function recordRfqCreate(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqCreateFor(await getSession(), input);
}
export async function recordRfqCancel(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqCancelFor(await getSession(), input);
}
export async function recordRfqSettle(input: { token: string; txHash: string }): Promise<RfqRecordResult> {
	return recordRfqSettleFor(await getSession(), input);
}
export async function rfqStatus(input: { rfqRequestId: string }): Promise<RfqStatusResult> {
	return rfqStatusForRequest(await getSession(), input);
}
