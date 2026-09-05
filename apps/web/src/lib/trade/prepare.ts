import "server-only";

/**
 * Preparing a trade: session, fresh order, quote, allowance, simulation, then
 * calldata. Nothing about the trade comes from the browser except the structure
 * id, the side and the budget — the order, its price and its signature are
 * re-read here every time (PRD 14: "Refresh the selected order before building
 * calldata").
 *
 * Approval and fill are two separate calls. When the allowance does not cover
 * the debit this returns the approval alone; the browser sends it, waits for the
 * receipt, and calls again. Only then is the order refetched, the fill simulated
 * as the taker, and fill calldata issued — which is exactly the order PRD 14
 * requires ("Collateral approval must complete before order selection; calldata
 * must be built and broadcast within 30 seconds of the fetch that produced it").
 *
 * The app never signs and never holds a key. Everything here is read-only RPC.
 */
import type { Address } from "viem";
import { buildFillTransactions, buildSellFillTransactions, ThetanutsLogicError, type Market } from "@nuts/thetanuts";
import { env } from "@nuts/env/server";
import { db } from "@nuts/db";
import { encodeOrderSnapshot } from "@nuts/db/order-snapshot";
import { getSession } from "@/lib/auth/session";
import { createOrFetchUser } from "@/lib/auth/store";
import { findStructure, readClient, type LiveStructure } from "@/lib/market/live";
import { quoteStructure, type StructureQuote } from "@/lib/market/quote";
import { takerSideDisagreement, TAKER_SIDE_CONTRADICTION } from "@/lib/market/taker-side";
import { parseTokenAmount } from "@/lib/market/units";
import { isFeedUnavailable } from "@/lib/thetanuts/orders";
import { strikesLabel } from "@/lib/display";
import { findThesis } from "./store";
import { simulateFill } from "./chain";
import { encodeTradeTicket, type TradeTicketPayload } from "./ticket";
import { rawOf, takerFor } from "./view";
import type { PrepareResult, TicketSide, TxRequest } from "./types";

function fail(code: string, reason: string, needsSignIn = false): PrepareResult {
	return needsSignIn ? { ok: false, code, reason, needsSignIn } : { ok: false, code, reason };
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function asTx(input: { to: string; data: string }): TxRequest {
	if (!HEX_ADDRESS.test(input.to) || !/^0x[0-9a-fA-F]*$/.test(input.data)) {
		throw new Error("Encoder returned malformed calldata");
	}
	return { to: input.to as `0x${string}`, data: input.data as `0x${string}`, value: "0" };
}

export interface PrepareTradeInput {
	readonly structureId: string;
	readonly side: TicketSide;
	readonly budgetInput: string;
	/**
	 * The post being traded on, when the visitor arrived from one. Absent means a
	 * standalone fill, which belongs to no post at all (owner 2026-09-05: "trade
	 * is just trade. post(thesis) is it's own thing. doesn't have to be tied.").
	 */
	readonly thesisId?: string | null;
}

/**
 * Server-side seam. The session is resolved by the caller so a test can drive
 * the whole path without a request context; the exported action always passes
 * the real cookie session and never accepts one from the client.
 */
export async function prepareTradeFor(
	session: { userId: string; walletAddress: string } | null,
	input: PrepareTradeInput,
): Promise<PrepareResult> {
	if (session === null) {
		return fail("NO_SESSION", "Sign in with your wallet before signing a trade.", true);
	}
	const taker = takerFor(input.side);

	let budget: bigint;
	const found = await findStructure(input.structureId, { force: true });
	if (found === null) return fail("STRUCTURE_GONE", "That structure is no longer on the book. Pick another one.");
	if (isFeedUnavailable(found)) return fail(found.error.toUpperCase(), found.detail);
	const { structure } = found;

	const order: Market | null = structure[taker];
	if (order === null) {
		return fail(
			"NO_ORDER_ON_SIDE",
			taker === "sell"
				? "No maker is buying this structure right now, so the Bear side cannot be filled."
				: "No maker is selling this structure right now, so the Bull side cannot be filled.",
		);
	}
	if (structure.collateralDecimals === null || structure.collateralSymbol === null) {
		return fail("COLLATERAL_UNKNOWN", "This order's collateral token is not in the SDK's token map.");
	}
	try {
		budget = parseTokenAmount(input.budgetInput, structure.collateralDecimals);
	} catch (error) {
		return fail("BAD_BUDGET", error instanceof Error ? error.message : "Enter a valid amount.");
	}

	// Checked again here, not only inside the quote: no calldata is ever built
	// while the shared package and the chain disagree about the taker side.
	const disagreement = takerSideDisagreement(order.order);
	if (disagreement !== null) return fail(TAKER_SIDE_CONTRADICTION, disagreement);

	const quote = quoteStructure({
		client: readClient(),
		market: order,
		side: taker,
		budget,
		referrer: env.THESIS_REFERRER,
	});
	if (!quote.ok) return fail(quote.code, quote.reason);

	const account = session.walletAddress as Address;
	let built: { approve?: { to: string; data: string }; fill: { to: string; data: string } };
	try {
		built =
			taker === "buy"
				? await buildFillTransactions({
						client: readClient(),
						order: order.order,
						budget,
						referrer: env.THESIS_REFERRER,
						account,
					})
				: await buildSellFillTransactions({
						client: readClient(),
						order: order.order,
						collateralBudget: budget,
						referrer: env.THESIS_REFERRER,
						account,
					});
	} catch (error) {
		if (error instanceof ThetanutsLogicError) return fail(error.code, error.message);
		return fail("BUILD_FAILED", error instanceof Error ? error.message : "Could not build this trade.");
	}

	if (built.approve !== undefined) {
		return {
			ok: true,
			stage: "approve",
			approve: asTx(built.approve),
			note: `Approve ${quote.collateralSymbol} for exactly this fill. Nothing is spent until you sign the fill itself.`,
		};
	}

	// Cross-check the encoder against the quote the user is looking at. The two
	// recompute the same premium independently; a disagreement means the order
	// moved between the quote and the encode, and nothing is sent on a mismatch.
	const encoderMismatch = encoderDisagrees(built, quote, taker);
	if (encoderMismatch !== null) return fail("ENCODE_MISMATCH", encoderMismatch);

	const fill = asTx(built.fill);
	const simulated = await simulateFill({ account, to: fill.to, data: fill.data });
	if (!simulated.ok) {
		return fail("SIMULATION_REVERTED", `This fill would revert on Base: ${simulated.reason}`);
	}

	// A first-time wallet that trades gets its `users` row here; sign-in already
	// creates one, and this is idempotent (`users_wallet_address_unique`).
	const user = await createOrFetchUser(db, session.walletAddress);
	const resolved = await resolveAttachment({ input, structure, taker });
	if ("error" in resolved) return fail(resolved.error.code, resolved.error.reason);

	const payload: TradeTicketPayload = {
		v: 1,
		userId: user.id,
		wallet: session.walletAddress,
		chainId: 8453,
		structureId: structure.id,
		instrumentLabel: `${structure.asset} ${structure.productType} ${strikesLabel(structure.strikesUsd, structure.isCall)}`,
		side: input.side,
		taker,
		thesisId: resolved.thesisId,
		role: resolved.role,
		positionSide: resolved.positionSide,
		optionBook: fill.to,
		budget: budget.toString(),
		collateralAddress: quote.collateralAddress,
		collateralSymbol: quote.collateralSymbol,
		collateralDecimals: quote.collateralDecimals,
		contractSizeDecimals: quote.contractSizeDecimals,
		expectedContracts: quote.numContracts.toString(),
		expectedPremium: quote.premiumGross.toString(),
		expectedFee: quote.feeEstimate.toString(),
		expectedCollateral: quote.collateralPosted.toString(),
		maxLossUsd8: quote.maxLossUsd8 === null ? null : quote.maxLossUsd8.toString(),
		maxPayoutUsd8: quote.maxPayoutUsd8 === null ? null : quote.maxPayoutUsd8.toString(),
		breakEvenUsd8: quote.breakEvenUsd8 === null ? null : quote.breakEvenUsd8.toString(),
		orderSnapshot: encodeOrderSnapshot(order.order),
		issuedAt: Math.floor(Date.now() / 1000),
	};

	const expected = rawOf(quote);
	if (expected === null) return fail("QUOTE_LOST", "The quote went stale while preparing. Try again.");

	return {
		ok: true,
		stage: "fill",
		fill,
		token: encodeTradeTicket(payload),
		thesisId: resolved.thesisId,
		expected,
		signatureExpiresAt: new Date(Number(quote.orderExpiry) * 1000).toISOString(),
		// TODO-OWNER: how long a signature must have left before the app refuses
		// to hand over calldata is an owner's number; nothing is imposed here
		// beyond the book's own expiry filter.
		note: "Sign in your wallet. The maker's signature expires shortly, so send it now.",
	};
}

function encoderDisagrees(
	built: { fill: { to: string; data: string } } & Record<string, unknown>,
	quote: StructureQuote,
	taker: "buy" | "sell",
): string | null {
	const expected = (built as { expected?: Record<string, bigint> }).expected;
	if (expected === undefined) return "The encoder returned no expected amounts.";
	if (expected.numContracts !== quote.numContracts) {
		return `The encoder sized ${expected.numContracts} contract units and the quote sized ${quote.numContracts}.`;
	}
	if (taker === "buy" && expected.premium !== quote.premiumGross) {
		return `The encoder priced ${expected.premium} and the quote priced ${quote.premiumGross}.`;
	}
	if (taker === "sell" && expected.collateralRequired !== quote.collateralPosted) {
		return `The encoder needs ${expected.collateralRequired} collateral and the quote computed ${quote.collateralPosted}.`;
	}
	return null;
}

interface Attachment {
	readonly thesisId: string | null;
	readonly role: "creator" | "participant" | "standalone";
	readonly positionSide: "back" | "counter";
}

/**
 * What this fill attaches to.
 *
 * Two shapes only, since migration 0007 made `positions.thesis_id` nullable:
 * a fill on someone's post (`participant`), or a fill that belongs to no post
 * (`standalone`). The ticket no longer creates a draft post.
 *
 * `side` follows the same mapping the rest of the app renders with
 * (`display.position`: back -> Bull, counter -> Bear), so a taker BUY is always
 * `back` and a taker SELL is always `counter`. Flagged for the owner: PRD 8.4
 * describes back/counter as agreeing or disagreeing with a post's creator, and
 * on a bear-direction post the two readings differ.
 */
async function resolveAttachment(context: {
	input: PrepareTradeInput;
	structure: LiveStructure;
	taker: "buy" | "sell";
}): Promise<Attachment | { error: { code: string; reason: string } }> {
	const { input, structure, taker } = context;
	const positionSide = taker === "buy" ? ("back" as const) : ("counter" as const);
	if (!input.thesisId) {
		return { thesisId: null, role: "standalone", positionSide };
	}
	const thesis = await findThesis(db, input.thesisId);
	if (thesis === null) return { error: { code: "THESIS_NOT_FOUND", reason: "That post no longer exists." } };
	if (thesis.status !== "open") {
		return { error: { code: "THESIS_NOT_OPEN", reason: "That post is not open for trading." } };
	}
	if (thesis.underlyingAsset === null) {
		return { error: { code: "THESIS_HAS_NO_STRUCTURE", reason: "That post names no structure to trade." } };
	}
	if (thesis.underlyingAsset !== structure.asset) {
		return {
			error: {
				code: "THESIS_OTHER_MARKET",
				reason: `That post is about ${thesis.underlyingAsset}, not ${structure.asset}.`,
			},
		};
	}
	return { thesisId: thesis.id, role: "participant", positionSide };
}

export async function prepareTrade(input: PrepareTradeInput): Promise<PrepareResult> {
	return prepareTradeFor(await getSession(), input);
}
