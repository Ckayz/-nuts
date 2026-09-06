import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { buildRfqCreate, ThetanutsLogicError } from "@nuts/thetanuts";
import { decimalFromBaseUnits } from "@/lib/data/decimal";
import { withinRfqDepositLimit, MAX_RFQ_DEPOSIT_USD } from "@/lib/rfq/limits";
import {
	prepareRfqCancelFor,
	prepareRfqCreateFor,
	prepareRfqSettleFor,
	readRevealWindow,
	rfqClientFor,
	rfqRowView,
	unixSecondsFrom,
	type RfqExpected,
	type RfqSdkClient,
} from "@/lib/rfq/prepare";
import { drizzleRfqStore } from "@/lib/rfq/store";

/**
 * The agent's RFQ tools (PRD 10.5's `buildCustomRfqPreview`, `getRfqStatus`,
 * `requestRfqCreation`, `requestRfqCancellation`, plus the two this build adds:
 * `listMyRfqs` and `requestRfqSettlement`).
 *
 * WHAT AN RFQ IS, in one line, because it decides every rule below: a Request
 * For Quotation asks the market makers to quote an option the order book does
 * not carry. The requester escrows the most they are willing to pay, market
 * makers answer inside a deadline, and the request settles into a real option —
 * or is cancelled, and the escrow comes back.
 *
 * Scope, owner-decided 2026-09-06: BUY puts and put spreads, USDC collateral,
 * ETH and BTC. Offer decryption and early acceptance are NOT in this build.
 *
 * Four rules, the three `lib/agent/tools.ts` states plus the one
 * `lib/agent/positions.ts` adds:
 *
 * 1. **Decimal strings, never floats** (PRD 10.3). Every number that crosses
 *    into model context here is a string.
 * 2. **Bounded output.** `listMyRfqs` is capped and says how many rows exist.
 * 3. **Say when a value is unknown**, with the sentence that says why.
 * 4. **THE WALLET IS NEVER A MODEL ARGUMENT.** It is bound in the closure below
 *    from the server-side session. No `inputSchema` here carries an address, and
 *    `rfq-tools.test.ts` asserts that from the schemas themselves.
 *
 * The three write tools PREPARE and return unsigned calldata. They never sign
 * and never broadcast; `route.ts` declares `toolApproval` for all three, so the
 * runtime suspends them until the user has answered.
 */

/**
 * Every sentence these tools put into the model's context.
 *
 * TODO-OWNER: all of it. The mockup draws no RFQ surface and the PRD words none
 * of this, so none of this copy has provenance.
 */
const COPY = {
	signedOut:
		"The user is not signed in, so this app cannot prepare or list custom requests. Ask them to connect their wallet — that is what signs them in — and offer to try again afterwards.",
	walletMismatch:
		"The connected wallet is not the one that signed in. Ask the user to sign in again with the wallet they want to request from; nothing was prepared.",
	suggestion:
		"a suggestion, not a quote — the user confirms it or names their own maximum price per contract",
	escrow:
		"The deposit is the most this request can cost: it is escrowed when the request is created, returned in full if it is cancelled, and any unspent part is returned when it settles.",
	feeNote:
		"Thetanuts charges the protocol fee on a settled request, min(0.06% of notional, 12.5% of premium) per the docs. It is taken at settlement out of what the market maker receives, and no figure for it is available before then, so do not state one.",
	notFound: "No request with that id belongs to the signed-in wallet. List the user's requests instead of guessing at an id.",
	noPricing:
		"No market-maker pricing was returned for that underlying, so no reserve price can be suggested. Ask the user to name the most they are willing to pay per contract.",
	previewOnly:
		"This is a preview only. Nothing has been escrowed and no transaction exists until the user approves requestRfqCreation and signs it in their wallet.",
} as const;

/** How many requests one answer may carry. TODO-OWNER: 10 is not the owner's number. */
const MAX_ROWS = 10;

/**
 * The public key a PREVIEW is built against.
 *
 * A preview must not mint a key: minting writes a row, and a user who only asked
 * "what would this cost" has not asked for one. MEASURED that this is safe to
 * substitute: `expected` carries the deposit, the strikes, the contract count
 * and the two timestamps, and none of them is derived from the key — the key
 * travels in its own `requesterPublicKey` string field
 * (`packages/thetanuts/src/rfq.ts`), which `buildRfqCreate` only checks the
 * SHAPE of. `rfq-tools.test.ts` pins that two different keys produce the same
 * `expected`.
 *
 * The calldata a preview builds is DISCARDED — no tool below returns it — so
 * this value can never reach a wallet.
 */
const PREVIEW_PUBLIC_KEY = `0x02${"11".repeat(32)}`;
/** Same idea for the requester when nobody is signed in: previews price a shape, not an account. */
const PREVIEW_REQUESTER = "0x0000000000000000000000000000000000000000" as const;

const underlyingSchema = z.enum(["ETH", "BTC"]).describe("The underlying asset. RFQ covers ETH and BTC only.");
const strikesSchema = z
	.array(z.string().regex(/^\d+(\.\d+)?$/))
	.min(1)
	.max(2)
	.describe("One strike for a plain put, or two for a put spread. Decimal US dollars, as the user said them.");
const contractsSchema = z
	.string()
	.regex(/^\d+(\.\d+)?$/)
	.describe("How many contracts, as a decimal string. At most 6 decimal places.");
const reserveSchema = z
	.string()
	.regex(/^\d+(\.\d+)?$/)
	.describe(
		"The MOST the user will pay per contract, in USDC. This times the contract count is escrowed, and it is the user's maximum loss.",
	);
const expirySchema = z
	.string()
	.describe("The option's expiry, as an ISO instant or unix seconds. Must be after the offer deadline.");
const deadlineSchema = z
	.number()
	.int()
	.positive()
	.describe("Whole minutes market makers have to answer. The user names it; 60 is the value the Thetanuts docs use.");
const rfqIdSchema = z.string().describe("The rfqRequestId from listMyRfqs or from an earlier requestRfqCreation.");

export interface RfqToolsParams {
	/**
	 * The signed-in session, read server-side from the cookie — never from the
	 * request body and never from the model. Everything these tools prepare is
	 * bound to this wallet.
	 */
	readonly session: { userId: string; walletAddress: string } | null;
	/**
	 * The wallet the browser has connected, from the request. Compared with the
	 * session's, exactly as `createExecutionTools` compares it: a request whose
	 * escrow would leave a DIFFERENT address than the one that owns the request
	 * is refused rather than prepared.
	 */
	readonly account: `0x${string}` | null;
}

/** Two decimal strings naming the same number: "2450" and "2450.00" are one strike. */
function sameDecimal(left: string, right: string): boolean {
	const canonical = (value: string): string => {
		const [whole = "0", fraction = ""] = value.trim().split(".");
		const trimmed = fraction.replace(/0+$/, "");
		return `${whole.replace(/^0+(?=\d)/, "")}${trimmed ? `.${trimmed}` : ""}`;
	};
	return canonical(left) === canonical(right);
}

/** A float from the SDK as a plain decimal string, so no float crosses into model context. */
function decimalOf(value: number, places: number): string | null {
	if (!Number.isFinite(value)) return null;
	return value.toFixed(places).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * The per-contract premium in USDC that a market-maker price implies.
 *
 * MEASURED at the SDK bytes (`dist/index.js:16892`):
 *   `premiumPerContract(mmPrice, spot, product) =
 *      isBaseCollateral(product) ? mmPrice : mmPrice * spot`
 * and `BASE_COLLATERAL_PRODUCTS` (`:16810`) is `INVERSE_CALL`,
 * `INVERSE_CALL_SPREAD`, `PHYSICAL_CALL` — so a PUT takes the `mmPrice * spot`
 * branch. Cross-checked against the live surface: `ETH-7SEP26-2900-P` quoted
 * `feeAdjustedAsk` 0.1619 with `underlyingPrice` 2503.39, giving 405.30 USD
 * against an intrinsic value of 396.61 USD — the same order of magnitude, which
 * `ask x strike` (469.51) is not.
 *
 * Rounded UP to the USDC unit: a reserve price is a CEILING on what the buyer
 * pays, so rounding it down would price the request under the ask it came from.
 */
function reserveFromMmPrice(mmPrice: number, spot: number): string | null {
	if (!Number.isFinite(mmPrice) || !Number.isFinite(spot) || mmPrice <= 0 || spot <= 0) return null;
	const units = Math.ceil(mmPrice * spot * 1_000_000);
	if (!Number.isSafeInteger(units) || units <= 0) return null;
	return decimalFromBaseUnits(String(units), 6);
}

export function createRfqTools({ session, account }: RfqToolsParams) {
	const wallet = session === null ? null : session.walletAddress.toLowerCase();
	const clientForReads = (): RfqSdkClient => rfqClientFor(wallet ?? PREVIEW_REQUESTER);

	/** The three write tools' shared refusal for a session that cannot sign. */
	function signedInAccount(kind: string): { ok: true } | { prepared: false; kind: string; reason: string } {
		if (session === null) return { prepared: false as const, kind, reason: COPY.signedOut };
		if (account !== null && account.toLowerCase() !== session.walletAddress.toLowerCase()) {
			return { prepared: false as const, kind, reason: COPY.walletMismatch };
		}
		return { ok: true as const };
	}

	const buildCustomRfqPreview = tool({
		description:
			"Price a CUSTOM option the order book does not carry, as a Request For Quotation on Thetanuts: what it would " +
			"escrow, when offers close and when it expires. Use this when searchOptionBookOrders — searched with the exact " +
			"strikes the user named — genuinely has nothing at the strike or expiry they want. Buys only, puts and put " +
			"spreads only, USDC, ETH or BTC. It prepares nothing and escrows nothing.",
		inputSchema: z.object({
			underlying: underlyingSchema,
			strikesUsd: strikesSchema,
			expiryAt: expirySchema,
			numContracts: contractsSchema,
			reservePricePerContract: reserveSchema,
			offerDeadlineMinutes: deadlineSchema.optional(),
		}),
		execute: async ({ underlying, strikesUsd, expiryAt, numContracts, reservePricePerContract, offerDeadlineMinutes }) => {
			const expiry = unixSecondsFrom(expiryAt);
			if (expiry === null) {
				return { ok: false as const, refusal: "The expiry must be an ISO instant or unix seconds." };
			}
			if (offerDeadlineMinutes === undefined) {
				return {
					ok: false as const,
					// TODO-OWNER: there is no default offer deadline in this build. The
					// docs' examples use 60; that is theirs, not the owner's.
					refusal:
						"Ask the user how many minutes market makers should have to answer. Nothing here picks a default; the Thetanuts docs use 60 in their examples.",
				};
			}
			let build: ReturnType<typeof buildRfqCreate>;
			try {
				build = buildRfqCreate({
					client: clientForReads(),
					// A preview needs no allowance: it is asking what the request would
					// be, not building the approval that funds it.
					allowance: 0n,
					params: {
						requester: (wallet ?? PREVIEW_REQUESTER) as `0x${string}`,
						underlying,
						strikesUsd,
						expiry,
						numContracts,
						reservePricePerContract,
						offerDeadlineMinutes,
						requesterPublicKey: PREVIEW_PUBLIC_KEY,
					},
				});
			} catch (error) {
				return {
					ok: false as const,
					refusal:
						error instanceof ThetanutsLogicError
							? `${error.message} (${error.code})`
							: error instanceof Error
								? error.message
								: "That request could not be priced.",
				};
			}

			const depositBaseUnits = build.expected.depositBaseUnits.toString();
			const gate = withinRfqDepositLimit({
				depositBaseUnits,
				collateralSymbol: build.expected.collateral.symbol,
				collateralDecimals: build.expected.collateral.decimals,
			});
			const deposit = decimalFromBaseUnits(depositBaseUnits, build.expected.collateral.decimals);
			const expected: RfqExpected = {
				depositBaseUnits,
				deposit,
				strikesUsd: [...build.expected.strikesUsd8]
					.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
					.map((strike) => decimalFromBaseUnits(strike.toString(), 8)),
				numContracts: decimalFromBaseUnits(
					build.expected.numContracts.toString(),
					build.expected.collateral.decimals,
				),
				expiryAt: new Date(Number(build.expected.expiryTimestamp) * 1000).toISOString(),
				offerEndAt: new Date(Number(build.expected.offerEndTimestamp) * 1000).toISOString(),
				factory: build.factory,
				maxLossUsd: gate.ok ? gate.depositUsd : deposit,
				collateralSymbol: "USDC",
			};
			return {
				ok: gate.ok,
				expected,
				maxLossUsd: expected.maxLossUsd,
				feeNote: COPY.feeNote,
				escrowNote: COPY.escrow,
				previewNote: COPY.previewOnly,
				...(gate.ok ? {} : { refusal: gate.reason }),
			};
		},
	});

	const suggestRfqReservePrice = tool({
		description:
			"Ask the Thetanuts market-maker surface what a plain PUT is currently quoted at, so the user has a starting " +
			"point for the maximum price per contract they are willing to pay on a custom request. What comes back is a " +
			"SUGGESTION, not a quote and not a commitment: say so, and let the user confirm it or name their own number. " +
			"Vanilla puts only — it cannot price a spread.",
		inputSchema: z.object({
			underlying: underlyingSchema,
			strikeUsd: z
				.string()
				.regex(/^\d+(\.\d+)?$/)
				.describe("The strike, in decimal US dollars."),
			expiryAt: expirySchema,
		}),
		execute: async ({ underlying, strikeUsd, expiryAt }) => {
			const expiry = unixSecondsFrom(expiryAt);
			if (expiry === null) {
				return { found: false as const, reason: "The expiry must be an ISO instant or unix seconds." };
			}
			const asOf = new Date().toISOString();
			let pricing: Record<string, Awaited<ReturnType<RfqSdkClient["mmPricing"]["getAllPricing"]>>[string]>;
			try {
				pricing = await clientForReads().mmPricing.getAllPricing(underlying);
			} catch (error) {
				return {
					found: false as const,
					asOf,
					reason: `The market-maker pricing surface could not be read: ${error instanceof Error ? error.message : "unknown error"}.`,
				};
			}
			const puts = Object.values(pricing).filter((row) => row.isCall === false);
			if (puts.length === 0) return { found: false as const, asOf, reason: COPY.noPricing };

			const sameStrike = puts.filter((row) => sameDecimal(String(row.strike), strikeUsd));
			const exact = sameStrike.find((row) => row.expiry === expiry);
			// The Thetanuts surface expires at 08:00 UTC while people say dates, so a
			// request that lands on the same UTC day as a listed expiry is matched and
			// LABELLED as such rather than silently rounded.
			// TODO-OWNER: whether a same-day match should be offered at all.
			const utcDay = (seconds: number) => Math.floor(seconds / 86_400);
			const sameDay = exact ?? sameStrike.find((row) => utcDay(row.expiry) === utcDay(expiry));
			const match = exact ?? sameDay ?? null;

			if (match === null) {
				// The nearest listed puts, so the model can offer real alternatives
				// instead of inventing one. Sorted by distance from what was asked.
				const nearest = [...puts]
					.sort(
						(left, right) =>
							Math.abs(left.expiry - expiry) - Math.abs(right.expiry - expiry) ||
							Math.abs(left.strike - Number(strikeUsd)) - Math.abs(right.strike - Number(strikeUsd)),
					)
					.slice(0, 5)
					.map((row) => ({
						ticker: row.ticker,
						strikeUsd: decimalOf(row.strike, 8),
						expiryAt: new Date(row.expiry * 1000).toISOString(),
					}));
				return {
					found: false as const,
					asOf,
					reason:
						"No market-maker quote is listed for that exact strike and expiry. Offer the nearest listed ones, or ask the user for the most they will pay per contract.",
					nearest,
				};
			}

			return {
				found: true as const,
				asOf,
				ticker: match.ticker,
				expiryMatch: exact ? ("exact" as const) : ("same_utc_day" as const),
				expiryAt: new Date(match.expiry * 1000).toISOString(),
				strikeUsd: decimalOf(match.strike, 8),
				/** As the surface publishes it: a price per contract in units of the UNDERLYING. */
				feeAdjustedAsk: decimalOf(match.feeAdjustedAsk, 12),
				markPrice: decimalOf(match.markPrice, 12),
				underlyingPrice: decimalOf(match.underlyingPrice, 8),
				passesToleranceCheck: match.passesToleranceCheck,
				/**
				 * The same figure in USDC per contract, by the SDK's own rule
				 * (`premiumPerContract`, measured at the bytes — see
				 * `reserveFromMmPrice`). This is the number to hand to
				 * buildCustomRfqPreview as reservePricePerContract if the user accepts
				 * it.
				 */
				suggestedReservePricePerContractUsdc: reserveFromMmPrice(match.feeAdjustedAsk, match.underlyingPrice),
				/** TODO-OWNER: no slack is added. A reserve equal to the ask may not fill. */
				slackApplied: "0",
				note: COPY.suggestion,
			};
		},
	});

	const listMyRfqs = tool({
		description:
			"The signed-in user's own custom option requests (RFQs): where each one stands, what it escrowed, and what — " +
			"if anything — they can do about it now. Use this for any question about 'my requests', 'my RFQs', 'did my " +
			"request fill', or before cancelling or settling one. Never answer such a question from the conversation.",
		inputSchema: z.object({
			limit: z.number().int().min(1).max(MAX_ROWS).default(MAX_ROWS).describe("How many of the newest requests to return."),
		}),
		execute: async ({ limit }) => {
			if (wallet === null) return { signedIn: false as const, note: COPY.signedOut };
			const rows = await drizzleRfqStore().listForWallet(wallet, limit);
			const client = clientForReads();
			const now = new Date();
			const revealWindowSeconds = await readRevealWindow(client);
			const requests = await Promise.all(rows.map((row) => rfqRowView(row, client, now, revealWindowSeconds)));
			return {
				signedIn: true as const,
				asOf: now.toISOString(),
				count: requests.length,
				limit,
				requests,
				escrowNote: COPY.escrow,
			};
		},
	});

	const getRfqStatus = tool({
		description:
			"Where ONE custom option request stands right now, read from Base and from the Thetanuts indexer. Use it " +
			"before telling the user anything about a request they made, and repeat the returned sentence. A request is " +
			"never filled until its status is settled.",
		inputSchema: z.object({ rfqRequestId: rfqIdSchema }),
		execute: async ({ rfqRequestId }) => {
			if (wallet === null) return { found: false as const, signedIn: false as const, note: COPY.signedOut };
			// Scoped by wallet in the store itself: "no such request" and "not
			// yours" are one answer, and the difference is not the user's business.
			const row = await drizzleRfqStore().findOwn(rfqRequestId, wallet);
			if (row === null) return { found: false as const, reason: COPY.notFound };
			const client = clientForReads();
			const now = new Date();
			const view = await rfqRowView(row, client, now, await readRevealWindow(client));
			return { found: true as const, asOf: now.toISOString(), request: view, escrowNote: COPY.escrow };
		},
	});

	const requestRfqCreation = tool({
		description:
			"Prepare a real Base mainnet Request For Quotation for the user's wallet to sign: it escrows the deposit and " +
			"asks market makers to answer inside the deadline. Returns unsigned transactions; it never sends them. Call " +
			"this only after the user has seen a buildCustomRfqPreview and asked to proceed. A request is NOT a filled " +
			"trade — it may settle, or it may expire unfilled and be cancelled for a full refund.",
		inputSchema: z.object({
			underlying: underlyingSchema,
			strikesUsd: strikesSchema,
			expiryAt: expirySchema,
			numContracts: contractsSchema,
			reservePricePerContract: reserveSchema,
			offerDeadlineMinutes: deadlineSchema,
		}),
		execute: async (input) => {
			const guard = signedInAccount("rfq_create");
			if (!("ok" in guard)) return guard;
			const prepared = await prepareRfqCreateFor(session, {
				underlying: input.underlying,
				strikesUsd: input.strikesUsd,
				expiry: input.expiryAt,
				numContracts: input.numContracts,
				reservePricePerContract: input.reservePricePerContract,
				offerDeadlineMinutes: input.offerDeadlineMinutes,
			});
			if (!prepared.ok) {
				return {
					prepared: false as const,
					kind: "rfq_create" as const,
					reason: `The request could not be prepared (${prepared.code}): ${prepared.reason}`,
				};
			}
			return {
				prepared: true as const,
				kind: "rfq_create" as const,
				account: session?.walletAddress ?? null,
				chainId: 8453 as const,
				stage: prepared.stage,
				expected: prepared.expected,
				transactions:
					prepared.stage === "approve" ? { approve: prepared.approve } : { create: prepared.create },
				...(prepared.stage === "approve"
					? { allowance: prepared.allowance }
					: {
							token: prepared.token,
							rfqRequestId: prepared.rfqRequestId,
							preparedAt: prepared.preparedAt,
						}),
				escrowNote: COPY.escrow,
				feeNote: COPY.feeNote,
				instruction:
					prepared.stage === "approve"
						? `Tell the user their wallet will first ask them to approve exactly ${prepared.expected.deposit} USDC to the Thetanuts OptionFactory, and that nothing is escrowed until they sign the request itself. Do not claim the request exists yet.`
						: `Show the user the deposit (${prepared.expected.deposit} USDC, which is the most this can cost and is their maximum loss), the strikes, the expiry and when offers close, then tell them their wallet will ask them to confirm. Do not claim the request is made until their wallet reports a confirmed transaction, and never call it a filled trade — it is filled only once its status is settled.`,
			};
		},
	});

	const requestRfqCancellation = tool({
		description:
			"Prepare the cancellation of one of the user's own custom requests, for their wallet to sign. Cancelling " +
			"returns the escrowed deposit in full. Only the requester can cancel, and only before the request settles. " +
			"Returns unsigned calldata; it never sends it.",
		inputSchema: z.object({ rfqRequestId: rfqIdSchema }),
		execute: async ({ rfqRequestId }) => {
			const guard = signedInAccount("rfq_cancel");
			if (!("ok" in guard)) return guard;
			const prepared = await prepareRfqCancelFor(session, { rfqRequestId });
			if (!prepared.ok) {
				return {
					prepared: false as const,
					kind: "rfq_cancel" as const,
					reason: `The cancellation could not be prepared (${prepared.code}): ${prepared.reason}`,
				};
			}
			return {
				prepared: true as const,
				kind: "rfq_cancel" as const,
				account: session?.walletAddress ?? null,
				chainId: 8453 as const,
				stage: "cancel" as const,
				rfqRequestId: prepared.rfqRequestId,
				quotationId: prepared.quotationId,
				transactions: { cancel: prepared.cancel },
				token: prepared.token,
				preparedAt: prepared.preparedAt,
				instruction:
					"Tell the user their wallet will ask them to confirm, and that cancelling returns the escrowed deposit. Do not claim it is cancelled until their wallet reports a confirmed transaction.",
			};
		},
	});

	const requestRfqSettlement = tool({
		description:
			"Prepare the settlement of one of the user's own custom requests, for their wallet to sign. Settling mints " +
			"the option against the winning offer and is only possible once the offer period and the reveal window have " +
			"both passed and a winning offer is on chain. Returns unsigned calldata; it never sends it.",
		inputSchema: z.object({ rfqRequestId: rfqIdSchema }),
		execute: async ({ rfqRequestId }) => {
			const guard = signedInAccount("rfq_settle");
			if (!("ok" in guard)) return guard;
			const prepared = await prepareRfqSettleFor(session, { rfqRequestId });
			if (!prepared.ok) {
				return {
					prepared: false as const,
					kind: "rfq_settle" as const,
					reason: `The settlement could not be prepared (${prepared.code}): ${prepared.reason}`,
				};
			}
			return {
				prepared: true as const,
				kind: "rfq_settle" as const,
				account: session?.walletAddress ?? null,
				chainId: 8453 as const,
				stage: "settle" as const,
				rfqRequestId: prepared.rfqRequestId,
				quotationId: prepared.quotationId,
				transactions: { settle: prepared.settle },
				token: prepared.token,
				preparedAt: prepared.preparedAt,
				/** USDC base units of the winning offer the factory currently holds. */
				bestPriceBaseUnits: prepared.bestPrice,
				instruction:
					"Tell the user their wallet will ask them to confirm, and that settling is permissionless — a market maker may settle it first, which is normal and costs them nothing. Do not claim the option exists until their wallet reports a confirmed transaction.",
			};
		},
	});

	return {
		buildCustomRfqPreview,
		suggestRfqReservePrice,
		listMyRfqs,
		getRfqStatus,
		requestRfqCreation,
		requestRfqCancellation,
		requestRfqSettlement,
	};
}

/** Tool names here that must never run without an explicit user approval. */
export const RFQ_APPROVAL_REQUIRED_TOOLS = [
	"requestRfqCreation",
	"requestRfqCancellation",
	"requestRfqSettlement",
] as const;

export { MAX_RFQ_DEPOSIT_USD };
