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
import { directionOfSide, quoteView, takerForSide } from "./view";
import type { PrepareResult, RecordResult, TakerSide, TicketQuoteView, TicketSide } from "./types";

export interface QuoteTicketInput {
	readonly structureId: string;
	/**
	 * The MARKET DIRECTION the visitor picked. Which taker side that selects is
	 * resolved here against the instrument, never assumed from the word (I-1).
	 */
	readonly side: TicketSide;
	/**
	 * I-1, optional and authoritative when present: the taker side the ticket
	 * already resolved from `TradePanelContext.sides`. The ticket always sends
	 * it, so the button and the quote can never disagree while the browser holds
	 * a structure the server has since re-read. Absent means the caller is the
	 * agent path, which is mapped by the legacy `takerFor` — see `./view.ts`.
	 */
	readonly taker?: TakerSide;
	readonly budgetInput: string;
}

/** Which side of the book a request names, and the direction word that side earns. */
function resolve(structure: Parameters<typeof takerForSide>[0], input: QuoteTicketInput): {
	taker: TakerSide;
	side: TicketSide;
} {
	const taker = input.taker ?? takerForSide(structure, input.side);
	return { taker, side: directionOfSide(structure, taker) };
}

/** Re-quotes one side of one structure. Read-only; no session required. */
export async function quoteTicket(input: QuoteTicketInput): Promise<TicketQuoteView | null> {
	const found = await findStructure(input.structureId);
	if (found === null) return null;
	if (isFeedUnavailable(found)) {
		return refusal(input, "FEED_UNAVAILABLE", found.detail);
	}
	const { structure } = found;
	const { taker, side } = resolve(structure, input);
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
	return quoteView({ structure, side, quote, budgetInput: input.budgetInput });
}

/** A refusal still needs a structure to render its label; this one is looked up again. */
async function refusal(input: QuoteTicketInput, code: string, reason: string): Promise<TicketQuoteView | null> {
	const found = await findStructure(input.structureId);
	if (found === null || isFeedUnavailable(found)) return null;
	return quoteView({
		structure: found.structure,
		side: resolve(found.structure, input).side,
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
