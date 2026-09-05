/**
 * Types shared between the trade server actions and the ticket component.
 *
 * Deliberately free of `server-only` and of any bigint: everything that crosses
 * the server-action boundary is a string, so a number cannot silently change
 * shape on the way to the browser and every printed figure keeps its raw base
 * units next to it.
 */
import type { PnlCard, Ticket } from "@/lib/display-types";

export type TicketSide = "bull" | "bear";
export type TakerSide = "buy" | "sell";

/** Raw integer base units behind every figure the ticket prints. */
export interface QuoteRaw {
	readonly budget: string;
	readonly numContracts: string;
	readonly contractSizeDecimals: number;
	readonly pricePerContract: string;
	readonly premiumGross: string;
	readonly feeEstimate: string;
	readonly collateralPosted: string;
	/** Collateral base units leaving the wallet. */
	readonly debit: string;
	/** Collateral base units arriving. */
	readonly credit: string;
	readonly makerLiquidity: string;
	readonly collateralDecimals: number;
	readonly collateralSymbol: string;
	readonly collateralAddress: string;
	readonly maxLossUsd8: string | null;
	readonly maxPayoutUsd8: string | null;
	readonly breakEvenUsd8: string | null;
	readonly capped: boolean;
}

export interface TicketQuoteView {
	readonly structureId: string;
	readonly side: TicketSide;
	readonly taker: TakerSide;
	/** False when the ticket may not be signed; `reason` then says why. */
	readonly executable: boolean;
	readonly reason: string | null;
	readonly budgetInput: string;
	readonly ticket: Ticket;
	readonly sideNote: string;
	readonly raw: QuoteRaw | null;
	/** When this order's maker signature stops being valid, ISO 8601. */
	readonly signatureExpiresAt: string | null;
}

export interface SideAvailability {
	readonly taker: TakerSide;
	readonly available: boolean;
	readonly reason: string | null;
}

/** Everything the client ticket needs. No order data and no calldata: both are refetched server-side at signing time. */
export interface TradePanelContext {
	readonly asset: string;
	readonly slug: string;
	readonly structureId: string;
	readonly structureLabel: string;
	readonly expiryLabel: string;
	readonly sides: { readonly bull: SideAvailability; readonly bear: SideAvailability };
	readonly quote: TicketQuoteView;
	readonly presets: readonly string[];
	/** The post this trade attaches to, when the user arrived from one. */
	readonly thesis: { readonly id: string; readonly headline: string } | null;
	/** Lowercase address of the signed-in session, or null. */
	readonly sessionWallet: string | null;
	readonly chainId: 8453;
	readonly explorerTxBase: string;
}

export interface TxRequest {
	readonly to: `0x${string}`;
	readonly data: `0x${string}`;
	/** Always "0": no OptionBook call is payable. */
	readonly value: "0";
}

export interface PrepareFailure {
	readonly ok: false;
	readonly code: string;
	readonly reason: string;
	/** True when the only thing missing is a signed-in session. */
	readonly needsSignIn?: boolean;
}

/**
 * Approval and fill are two separate round trips on purpose (PRD 14: "Collateral
 * approval must complete before order selection; calldata must be built and
 * broadcast within 30 seconds of the fetch that produced it"). The server hands
 * back the approval alone, and only once the allowance covers the debit does it
 * refetch the order, simulate the fill and hand back fill calldata.
 */
export interface PrepareApprove {
	readonly ok: true;
	readonly stage: "approve";
	readonly approve: TxRequest;
	readonly note: string;
}

export interface PrepareFill {
	readonly ok: true;
	readonly stage: "fill";
	readonly fill: TxRequest;
	/** Opaque, server-signed. Hand back to `recordTrade` unchanged. */
	readonly token: string;
	/** Null for a standalone fill. */
	readonly thesisId: string | null;
	readonly expected: QuoteRaw;
	readonly signatureExpiresAt: string;
	readonly note: string;
}

export type PrepareResult = PrepareFailure | PrepareApprove | PrepareFill;

export interface RecordFailure {
	readonly ok: false;
	readonly code: string;
	readonly reason: string;
}

export interface RecordSuccess {
	readonly ok: true;
	readonly status: "confirmed" | "failed";
	readonly positionId: string;
	/** Null for a standalone fill. */
	readonly thesisId: string | null;
	readonly txHash: string;
	/**
	 * What the post-fill share dialog renders. Present once confirmed.
	 *
	 * Shaped after fomo's post-trade card (owner reference 2026-09-05): owner,
	 * status chip, instrument, one big signed P&L, three stat tiles. Every value
	 * is already formatted server-side from raw base units.
	 */
	readonly card: FillCard | null;
	/** Present once confirmed: the economics recomputed from the receipt. */
	readonly settled: {
		readonly numContracts: string;
		readonly premium: string;
		readonly fees: string;
		readonly collateral: string;
		readonly collateralDecimals: number;
		readonly collateralSymbol: string;
		readonly optionAddress: string;
	} | null;
}

/**
 * What the post-fill dialog renders: the SAME card as `/p/[id]` and the feed
 * (round-1 fold item 16), widened only with the two paths the dialog needs.
 *
 * Before this round `FillCard` was its own shape — a truncated wallet and three
 * label/value tiles — so the dialog drew a hand-copied lookalike of the share
 * card with no avatar, no date and its own status vocabulary. It is now
 * `View.PnlCard`, built by the one builder in `lib/position/view.ts`, so a fill
 * reads the same in the dialog as it does on its own page a second later.
 */
export type FillCard = PnlCard & {
	/** Path of this position's own page. */
	readonly positionPath: string;
	/** Composer, pre-filled with a link to the position. */
	readonly composePath: string;
};

export type RecordResult = RecordFailure | RecordSuccess;
