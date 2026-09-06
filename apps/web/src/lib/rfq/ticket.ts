/**
 * The prepared-RFQ ticket: an HMAC-signed record of what the server prepared,
 * carried across the gap where the wallet holds the transaction.
 *
 * Same scheme and the same reasons as `lib/trade/ticket.ts` — read that file
 * first — with one difference that matters: the DOMAIN string below is its own.
 * The two tickets travel over the same surface and are signed with the same
 * key, so without domain separation an RFQ ticket would verify as a trade
 * ticket and the reverse. `ticket.test.ts` pins that neither decoder accepts the
 * other's token.
 *
 * WHAT IT DOES NOT DO. The signature proves the SERVER issued the payload. It
 * proves nothing about the transaction: `recordRfq*` re-reads the mined
 * transaction, requires its `to` to be the factory this ticket names, and
 * requires its own calldata to decode as the call this ticket describes. The
 * ticket says WHICH ROW a receipt belongs to; the chain says what happened.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "@/lib/auth/secret";

const DOMAIN = "thesis.fun/rfq-ticket/v1";

/** Which of the three RFQ writes this ticket authorises a recording for. */
export type RfqTicketKind = "rfq_create" | "rfq_cancel" | "rfq_settle";

export interface RfqTicketPayload {
	readonly v: 1;
	readonly kind: RfqTicketKind;
	readonly userId: string;
	/** Lowercase wallet the session is bound to. */
	readonly wallet: string;
	readonly chainId: 8453;
	/** `rfq_requests.id`. */
	readonly rfqRequestId: string;
	/** Lowercase OptionFactory address, from `chainConfig`, never a constant. */
	readonly factory: string;
	/**
	 * Decimal uint256. Null only on `rfq_create`, where the id does not exist
	 * until the transaction is mined.
	 */
	readonly quotationId: string | null;
	/** Collateral base units the create would escrow; null on cancel and settle. */
	readonly depositBaseUnits: string | null;
	/** Seconds since epoch. */
	readonly issuedAt: number;
}

function sign(body: string, secret: string): string {
	return createHmac("sha256", secret).update(`${DOMAIN}.${body}`).digest("base64url");
}

export function encodeRfqTicket(payload: RfqTicketPayload, secret: string = getSessionSecret()): string {
	const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `${body}.${sign(body, secret)}`;
}

/** Null for any tampered, malformed or wrong-version token. Nothing is thrown. */
export function decodeRfqTicket(token: string, secret: string = getSessionSecret()): RfqTicketPayload | null {
	const separator = token.indexOf(".");
	if (separator <= 0) return null;
	const body = token.slice(0, separator);
	const signature = token.slice(separator + 1);
	const expected = Buffer.from(sign(body, secret), "utf8");
	const received = Buffer.from(signature, "utf8");
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = parsed as { v?: unknown; chainId?: unknown; kind?: unknown };
	if (candidate.v !== 1 || candidate.chainId !== 8453) return null;
	if (candidate.kind !== "rfq_create" && candidate.kind !== "rfq_cancel" && candidate.kind !== "rfq_settle") {
		return null;
	}
	return parsed as RfqTicketPayload;
}
