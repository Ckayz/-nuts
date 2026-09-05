/**
 * The prepared-trade ticket: an HMAC-signed record of what the server prepared.
 *
 * WHY IT IS SIGNED. `recordTrade` writes a `positions` row, and `positions`
 * cannot be written before the wallet returns a hash (`tx_hash` is NOT NULL), so
 * something has to carry the prepared trade across that gap. Anything the
 * browser can edit — an order snapshot, a thesis id, a side — would let a caller
 * file a real transaction against someone else's post, or against economics they
 * chose. Signing it makes the round trip tamper-evident without a schema change
 * (`packages/db` is another writer's fence this round).
 *
 * WHAT IT DOES NOT DO. The signature proves the SERVER issued the payload. It
 * proves nothing about the transaction. Every financial field is re-derived in
 * `record.ts` from the mined transaction's own calldata and its `OrderFilled`
 * log; the payload's `expected*` values are only cross-checks. A forged or
 * replayed ticket therefore cannot invent economics — at worst it repeats a
 * trade the same wallet already made, and the `positions_chain_id_tx_hash_unique`
 * index stops that too.
 *
 * KEY. `getSessionSecret()`, domain-separated by the constant below so a trade
 * ticket can never be accepted as a session cookie or the reverse.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { OrderSnapshotV1 } from "@nuts/db/order-snapshot";
import { getSessionSecret } from "@/lib/auth/secret";
import type { TakerSide, TicketSide } from "./types";

const DOMAIN = "thesis.fun/trade-ticket/v1";

export interface TradeTicketPayload {
	readonly v: 1;
	readonly userId: string;
	/** Lowercase wallet the session is bound to. */
	readonly wallet: string;
	readonly chainId: 8453;
	readonly structureId: string;
	/** The instrument as the ticket spelled it, e.g. "BTC physical put 74,000 P". */
	readonly instrumentLabel: string;
	readonly side: TicketSide;
	readonly taker: TakerSide;
	/** Null for a standalone fill, which belongs to no post (migration 0007). */
	readonly thesisId: string | null;
	readonly role: "creator" | "participant" | "standalone";
	readonly positionSide: "back" | "counter";
	/** The fill target the SDK's encoder resolved and validated. */
	readonly optionBook: string;
	readonly budget: string;
	readonly collateralAddress: string;
	readonly collateralSymbol: string;
	readonly collateralDecimals: number;
	readonly contractSizeDecimals: number;
	readonly expectedContracts: string;
	readonly expectedPremium: string;
	readonly expectedFee: string;
	readonly expectedCollateral: string;
	readonly maxLossUsd8: string | null;
	readonly maxPayoutUsd8: string | null;
	readonly breakEvenUsd8: string | null;
	readonly orderSnapshot: OrderSnapshotV1;
	/** Seconds since epoch. */
	readonly issuedAt: number;
}

function sign(body: string, secret: string): string {
	return createHmac("sha256", secret).update(`${DOMAIN}.${body}`).digest("base64url");
}

export function encodeTradeTicket(payload: TradeTicketPayload, secret: string = getSessionSecret()): string {
	const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `${body}.${sign(body, secret)}`;
}

/** Null for any tampered, malformed or wrong-version token. Nothing is thrown. */
export function decodeTradeTicket(token: string, secret: string = getSessionSecret()): TradeTicketPayload | null {
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
	const candidate = parsed as { v?: unknown; chainId?: unknown };
	if (candidate.v !== 1 || candidate.chainId !== 8453) return null;
	return parsed as TradeTicketPayload;
}
