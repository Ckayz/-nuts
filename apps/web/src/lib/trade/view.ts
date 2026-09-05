import "server-only";

/**
 * Turns one quote into the ticket the browser renders, keeping the raw base
 * units beside every formatted figure so a reader can reproduce each number.
 */
import { formatBaseUnits, formatUsd8 } from "@/lib/market/units";
import { sideNoteFor, ticketFrom, type LiveStructure } from "@/lib/market/live";
import type { QuoteResult } from "@/lib/market/quote";
import type { QuoteRaw, TakerSide, TicketQuoteView, TicketSide } from "./types";

/** The mockup fixes the mapping: "Bull · buy it", "Bear · sell it". */
export function takerFor(side: TicketSide): TakerSide {
	return side === "bull" ? "buy" : "sell";
}

export function sideFor(taker: TakerSide): TicketSide {
	return taker === "buy" ? "bull" : "bear";
}

export function rawOf(quote: QuoteResult): QuoteRaw | null {
	if (!quote.ok) return null;
	return {
		budget: quote.budget.toString(),
		numContracts: quote.numContracts.toString(),
		contractSizeDecimals: quote.contractSizeDecimals,
		pricePerContract: quote.pricePerContract.toString(),
		premiumGross: quote.premiumGross.toString(),
		feeEstimate: quote.feeEstimate.toString(),
		collateralPosted: quote.collateralPosted.toString(),
		debit: quote.debit.toString(),
		credit: quote.credit.toString(),
		makerLiquidity: quote.makerLiquidity.toString(),
		collateralDecimals: quote.collateralDecimals,
		collateralSymbol: quote.collateralSymbol,
		collateralAddress: quote.collateralAddress,
		maxLossUsd8: quote.maxLossUsd8 === null ? null : quote.maxLossUsd8.toString(),
		maxPayoutUsd8: quote.maxPayoutUsd8 === null ? null : quote.maxPayoutUsd8.toString(),
		breakEvenUsd8: quote.breakEvenUsd8 === null ? null : quote.breakEvenUsd8.toString(),
		capped: quote.capped,
	};
}

export function quoteView(input: {
	structure: LiveStructure;
	side: TicketSide;
	quote: QuoteResult;
	budgetInput: string;
}): TicketQuoteView {
	const taker = takerFor(input.side);
	const sideNote = sideNoteFor(input.structure, taker, input.quote);
	return {
		structureId: input.structure.id,
		side: input.side,
		taker,
		executable: input.quote.ok,
		reason: input.quote.ok ? null : input.quote.reason,
		budgetInput: input.budgetInput,
		ticket: ticketFrom(input.structure, input.quote, sideNote),
		sideNote,
		raw: rawOf(input.quote),
		signatureExpiresAt: input.quote.ok
			? new Date(Number(input.quote.orderExpiry) * 1000).toISOString()
			: null,
	};
}

export { formatBaseUnits, formatUsd8 };
