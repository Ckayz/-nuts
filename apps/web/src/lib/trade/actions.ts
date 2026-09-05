"use server";

/**
 * Server actions for the ticket. Every export must stay an async function: Next
 * treats this whole module as a client-callable surface (see
 * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`), so types
 * live in `./types` and the implementations in `./prepare` and `./record`.
 *
 * Each action is an untrusted entry point and is treated as one: the client
 * sends a structure id, a side and a budget, and everything else — the order,
 * its price, the wallet, the post — is re-read from the session and the book.
 */
import { env } from "@nuts/env/server";
import { findStructure, readClient } from "@/lib/market/live";
import { quoteStructure } from "@/lib/market/quote";
import { parseTokenAmount } from "@/lib/market/units";
import { isFeedUnavailable } from "@/lib/thetanuts/orders";
import { prepareTrade as prepare, type PrepareTradeInput } from "./prepare";
import { recordTrade as record, type RecordTradeInput } from "./record";
import { quoteView, takerFor } from "./view";
import type { PrepareResult, RecordResult, TicketQuoteView, TicketSide } from "./types";

export interface QuoteTicketInput {
	readonly structureId: string;
	readonly side: TicketSide;
	readonly budgetInput: string;
}

/** Re-quotes one side of one structure. Read-only; no session required. */
export async function quoteTicket(input: QuoteTicketInput): Promise<TicketQuoteView | null> {
	const found = await findStructure(input.structureId);
	if (found === null) return null;
	if (isFeedUnavailable(found)) {
		return refusal(input, "FEED_UNAVAILABLE", found.detail);
	}
	const { structure } = found;
	const taker = takerFor(input.side);
	const order = structure[taker];
	if (order === null) {
		return refusal(
			input,
			"NO_ORDER_ON_SIDE",
			taker === "sell"
				? "No maker is buying this structure right now."
				: "No maker is selling this structure right now.",
		);
	}
	if (structure.collateralDecimals === null) {
		return refusal(input, "COLLATERAL_UNKNOWN", "This order's collateral token is not in the SDK's token map.");
	}
	let budget: bigint;
	try {
		budget = parseTokenAmount(input.budgetInput, structure.collateralDecimals);
	} catch (error) {
		return refusal(input, "BAD_BUDGET", error instanceof Error ? error.message : "Enter a valid amount.");
	}
	const quote = quoteStructure({
		client: readClient(),
		market: order,
		side: taker,
		budget,
		referrer: env.THESIS_REFERRER,
	});
	return quoteView({ structure, side: input.side, quote, budgetInput: input.budgetInput });
}

/** A refusal still needs a structure to render its label; this one is looked up again. */
async function refusal(input: QuoteTicketInput, code: string, reason: string): Promise<TicketQuoteView | null> {
	const found = await findStructure(input.structureId);
	if (found === null || isFeedUnavailable(found)) return null;
	return quoteView({
		structure: found.structure,
		side: input.side,
		quote: { ok: false, code, reason },
		budgetInput: input.budgetInput,
	});
}

export async function prepareTrade(input: PrepareTradeInput): Promise<PrepareResult> {
	return prepare(input);
}

export async function recordTrade(input: RecordTradeInput): Promise<RecordResult> {
	return record(input);
}
