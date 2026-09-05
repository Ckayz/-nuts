import "server-only";

/**
 * Turns one quote into the ticket the browser renders, keeping the raw base
 * units beside every formatted figure so a reader can reproduce each number.
 */
import { formatBaseUnits, formatUsd8 } from "@/lib/market/units";
import { sideNoteFor, ticketFrom, type LiveStructure } from "@/lib/market/live";
import { directionForTaker, takerForDirection, type DirectionalStructure } from "@/lib/market/direction";
import type { QuoteResult } from "@/lib/market/quote";
import type { QuoteRaw, TakerSide, TicketQuoteView, TicketSide } from "./types";

/**
 * The LEGACY mapping the mockup fixed: "Bull · buy it", "Bear · sell it".
 *
 * I-1 (owner 2026-09-06, decision 1): this is NOT the direction rule any more.
 * It survives for exactly one caller — a `prepareTrade` / `quoteTicket` request
 * that names no `taker` — because that request is the AI agent's
 * (`lib/agent/execute.ts:205` passes a hardcoded `side: "bull"` meaning "prepare
 * a taker BUY", after refusing every order it cannot buy). Changing what that
 * literal means would have turned the agent's buys into collateral-posting sells
 * on every put, so the ticket now sends its taker side explicitly and the agent's
 * behaviour is bit-for-bit unchanged.
 *
 * TODO / follow-up for the agent lane: `lib/agent/execute.ts` should send
 * `taker: "buy"` and take its display word from `directionForTaker`, after which
 * these two functions can go.
 */
export function takerFor(side: TicketSide): TakerSide {
	return side === "bull" ? "buy" : "sell";
}

export function sideFor(taker: TakerSide): TicketSide {
	return taker === "buy" ? "bull" : "bear";
}

/**
 * I-1. THE mapping every ticket surface uses: the taker side whose resulting
 * position has market direction `side` on THIS instrument.
 *
 * Falls back to the legacy mapping only for a structure that carries no
 * direction at all (RANGER, fly, condor, unnamed implementation). Such a
 * structure's buttons are labelled "Buy" / "Sell", so the legacy
 * bull->buy / bear->sell mapping is exactly what the two raw buttons mean and
 * nothing is guessed. It stays TRADEABLE: refusing it here would have removed
 * live instruments from the book, which is a product decision nobody made.
 */
export function takerForSide(structure: DirectionalStructure, side: TicketSide): TakerSide {
	return takerForDirection(structure, side) ?? takerFor(side);
}

/**
 * I-1. The inverse: the direction word a taker side earns on this instrument,
 * falling back to the legacy reading for a directionless structure so that
 * `takerForSide(s, directionOfSide(s, t)) === t` holds for every structure.
 */
export function directionOfSide(structure: DirectionalStructure, taker: TakerSide): TicketSide {
	return directionForTaker(structure, taker) ?? sideFor(taker);
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
	const taker = takerForSide(input.structure, input.side);
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
