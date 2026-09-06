/**
 * Where one RFQ stands, in plain words, and what — if anything — the user can
 * do about it right now.
 *
 * ONE definition, read by the agent tools and by the card, so the model and the
 * screen can never describe the same request differently.
 *
 * THE LIFECYCLE, from the docs ("RFQ Lifecycle", `docs-llms-full.txt`:4010) and
 * the factory's own views:
 *
 *   created ──► offers open until `offerEndTimestamp`
 *           ──► market makers REVEAL, for `getRevealWindow()` seconds
 *           ──► `settleQuotation(id)` is PERMISSIONLESS
 *   `cancelQuotation(id)` is requester-only and only before settlement.
 *
 * Pure: no chain, no database, no clock of its own. Everything it needs is
 * passed in, including `now`, so a table of timestamps can pin every branch.
 *
 * FAIL CLOSED ON WHAT COULD NOT BE READ. A missing reveal window is not treated
 * as zero: the answer stays "wait" and says the window could not be read, so an
 * unreadable chain can never produce a "settle it now" instruction.
 *
 * TODO-OWNER: every sentence below. The mockup draws no RFQ surface and the PRD
 * words none of this.
 */

/** The states a request can be in. `pending_create` is ours, not the factory's:
 *  the row exists because calldata was prepared, and no quotation id exists yet. */
export type RfqStatusName =
	| "pending_create"
	| "waiting_for_offers"
	| "reveal_window"
	| "ready_to_settle"
	| "settled"
	| "cancelled"
	| "expired_unfilled"
	| "failed"
	/** The indexer answered with a state this build does not model. Nothing is claimed about the escrow. */
	| "unknown";

export type RfqNextAction = "wait" | "settle" | "cancel" | "none";

export interface RfqStatusView {
	readonly status: RfqStatusName;
	readonly nextAction: RfqNextAction;
	/** One factual sentence, safe to repeat to the user verbatim. */
	readonly sentence: string;
	/** ISO, or null when this row has no offer deadline recorded. */
	readonly offerEndAt: string | null;
	/** ISO instant after which `settleQuotation` is permissionless, or null when unknown. */
	readonly settleReadyAt: string | null;
	/** True only when a winning offeror is on chain right now. */
	readonly hasWinner: boolean;
}

/** The columns this function reads. A `rfq_requests` row satisfies it. */
export interface RfqStatusRow {
	readonly status: string;
	readonly quotationId: string | null;
	/** Unix seconds the calldata carried. Null when the row predates it being stored. */
	readonly offerEndTimestamp: number | null;
	readonly expiryTimestamp: number | null;
	readonly failureReason?: string | null;
}

/** The indexer's view (`client.api.getRfq`), or null when it could not be read. */
export interface RfqIndexerView {
	readonly status: string;
	readonly offerEndTimestamp: number;
	readonly currentBestPrice: string;
	readonly winner?: string | undefined;
	readonly optionAddress?: string | undefined;
}

/** The factory's own view (`optionFactory.getQuotation`), or null when unread. */
export interface RfqChainView {
	readonly isActive: boolean;
	readonly currentWinner: string;
	readonly optionContract: string;
	readonly offerEndTimestamp: number;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const isZero = (address: string | undefined): boolean =>
	address === undefined || address.toLowerCase() === ZERO_ADDRESS;

const iso = (unixSeconds: number | null): string | null =>
	unixSeconds === null || !Number.isFinite(unixSeconds) ? null : new Date(unixSeconds * 1000).toISOString();

const COPY = {
	pending: "This request has been prepared but no transaction has been confirmed for it yet, so it is not on chain.",
	failed: "This request never made it on chain, so nothing was escrowed and there is nothing to cancel.",
	cancelled: "This request was cancelled and its escrowed deposit was returned.",
	settled: "This request settled. The option it produced is on chain.",
	waiting: "Market makers can still send offers on this request. The deposit stays escrowed until it settles or is cancelled, and it can be cancelled until then.",
	reveal: "The offer period has closed and market makers are revealing their offers. Nothing can be settled until the reveal window has passed.",
	revealUnknown: "The offer period has closed. How long the reveal window still has to run could not be read from Base, so it is too early to say this can be settled.",
	ready: "The reveal window has passed and a winning offer is on chain, so this request can now be settled. Settling is permissionless: anyone can send it, and market makers often settle their own winning requests.",
	unfilled: "The reveal window has passed and no offer is on chain, so there is nothing to settle. Cancelling returns the escrowed deposit.",
	unknown:
		"The Thetanuts indexer reports a state this build does not recognise, and Base could not be read, so nothing can be said about this request or its deposit yet. Read it on chain, or try again.",
} as const;

/**
 * The status of one request.
 *
 * PRECEDENCE, stated rather than implied: the CHAIN wins over the indexer, and
 * the indexer wins over our own row. Our row is the only thing that knows about
 * a request whose transaction was never confirmed; everything after that is a
 * fact about the factory, and the indexer lags it.
 */
export function rfqStatusFor(input: {
	readonly row: RfqStatusRow;
	readonly indexer: RfqIndexerView | null;
	readonly chain: RfqChainView | null;
	/** `optionFactory.getRevealWindow()` in seconds, or null when it could not be read. */
	readonly revealWindowSeconds: number | null;
	readonly now: Date;
}): RfqStatusView {
	const { row, indexer, chain, revealWindowSeconds, now } = input;
	const offerEndUnix = chain?.offerEndTimestamp ?? indexer?.offerEndTimestamp ?? row.offerEndTimestamp ?? null;
	const offerEndAt = iso(offerEndUnix);
	const settleReadyUnix =
		offerEndUnix === null || revealWindowSeconds === null ? null : offerEndUnix + revealWindowSeconds;
	const hasWinner = chain !== null ? !isZero(chain.currentWinner) : !isZero(indexer?.winner);
	const base = { offerEndAt, settleReadyAt: iso(settleReadyUnix), hasWinner } as const;

	if (row.status === "failed") return { status: "failed", nextAction: "none", sentence: COPY.failed, ...base };
	if (row.status === "pending_create" && row.quotationId === null) {
		return { status: "pending_create", nextAction: "none", sentence: COPY.pending, ...base };
	}

	// Terminal on chain. `optionContract` non-zero is the only proof of a
	// settlement; an inactive quotation without one was cancelled.
	if (chain !== null && !chain.isActive) {
		return isZero(chain.optionContract)
			? { status: "cancelled", nextAction: "none", sentence: COPY.cancelled, ...base }
			: { status: "settled", nextAction: "none", sentence: COPY.settled, ...base };
	}
	// The indexer's own vocabulary, and NOTHING is inferred from a value outside
	// it. The SDK types this field as a plain `string` and only names
	// `active | settled | cancelled` in a doc comment (`dist/index.d.ts:1018`),
	// so a fourth value is a state this build has never seen. It used to read as
	// "cancelled and its escrowed deposit was returned" — a money claim, made by
	// default, on the one axis where being wrong costs the most (C-4).
	if (chain === null && indexer !== null && indexer.status !== "active") {
		if (indexer.status === "settled") {
			return { status: "settled", nextAction: "none", sentence: COPY.settled, ...base };
		}
		if (indexer.status === "cancelled") {
			return { status: "cancelled", nextAction: "none", sentence: COPY.cancelled, ...base };
		}
		return { status: "unknown", nextAction: "none", sentence: COPY.unknown, ...base };
	}
	// Neither chain nor indexer could be read: our own row is all there is.
	if (chain === null && indexer === null) {
		if (row.status === "settled") return { status: "settled", nextAction: "none", sentence: COPY.settled, ...base };
		if (row.status === "cancelled") return { status: "cancelled", nextAction: "none", sentence: COPY.cancelled, ...base };
	}

	const nowUnix = Math.floor(now.getTime() / 1000);
	if (offerEndUnix === null) {
		// No deadline anywhere. Nothing can be said about the window, so nothing is.
		return { status: "reveal_window", nextAction: "wait", sentence: COPY.revealUnknown, ...base };
	}
	if (nowUnix < offerEndUnix) {
		return { status: "waiting_for_offers", nextAction: "cancel", sentence: COPY.waiting, ...base };
	}
	if (settleReadyUnix === null) {
		return { status: "reveal_window", nextAction: "wait", sentence: COPY.revealUnknown, ...base };
	}
	if (nowUnix <= settleReadyUnix) {
		return { status: "reveal_window", nextAction: "wait", sentence: COPY.reveal, ...base };
	}
	return hasWinner
		? { status: "ready_to_settle", nextAction: "settle", sentence: COPY.ready, ...base }
		: { status: "expired_unfilled", nextAction: "cancel", sentence: COPY.unfilled, ...base };
}
