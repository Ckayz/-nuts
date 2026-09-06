import "server-only";

/**
 * The RFQ spend ceiling, applied to the ESCROW.
 *
 * PRD 10.2, verbatim: "`maximumLossUsd <= 10` and `requiredCollateralUsd <= 10`
 * for agent-prepared trades." and "Base mainnet and USDC collateral only for
 * v1." PRD 14, verbatim: "Enforce agent spend and loss limits outside the model
 * process. A limit expressed only as a system instruction or an in-process
 * check is not a spend control."
 *
 * WHY THE ESCROW IS THE RIGHT QUANTITY. A BUY RFQ escrows
 * `reservePricePerContract × numContracts` at creation — measured, and the
 * amount the calldata carries as its top-level `reservePrice` argument (see
 * `packages/thetanuts/src/rfq.ts`). That escrow is the MOST the requester can
 * pay: an offer above the reserve cannot win, and anything unspent is refunded
 * at settlement or on cancel. So the escrow IS the buyer's maximum loss, and it
 * is the number this ceiling has to bound.
 *
 * The number itself is `MAX_LOSS_USD` from `lib/agent/limits.ts`, deliberately
 * imported rather than restated: one ceiling for the agent, whichever venue it
 * prepares on. TODO-OWNER: the 10 is the PRD's, and the owner's.
 *
 * Free of the SDK, the database and the network so it can be measured on its
 * own; `collateralUsdPrice` is the app's single collateral/USD source and is a
 * pure lookup table (`lib/thetanuts/orders.ts`).
 */
import { decimalFromBaseUnits } from "@/lib/data/decimal";
import { AGENT_COLLATERAL, MAX_LOSS_USD } from "@/lib/agent/limits";
import { COLLATERAL_USD_UNAVAILABLE, collateralUsdPrice, usdRisk } from "@/lib/thetanuts/orders";

export { MAX_LOSS_USD as MAX_RFQ_DEPOSIT_USD };

/**
 * How long a prepared-but-unconfirmed request stays visible.
 *
 * A `pending_create` row exists from the moment calldata is prepared, which the
 * card does more than once per press (re-prepare, the pre-approval fence, the
 * staleness re-check) and which a wallet rejection leaves behind. Those rows
 * name no quotation and moved no money, so after this long with nothing touching
 * them they are stale scaffolding rather than requests, and listing them first
 * can push a genuinely live, escrowed request out of a capped list (C-5).
 *
 * Nothing is deleted: a stale row is only hidden from listings, and it stays
 * readable by id and still bindable if its transaction turns up later.
 *
 * TODO-OWNER: 30 minutes is a placeholder. Nothing in the PRD or the mockup
 * words an RFQ, let alone how long a prepared one should linger.
 */
export const RFQ_PENDING_TTL_MINUTES = 30;

export type RfqGate =
	| { readonly ok: true; readonly depositUsd: string }
	| { readonly ok: false; readonly code: string; readonly reason: string };

export interface RfqDepositGateInput {
	/** The escrow the calldata carries, in collateral base units, as a decimal string. */
	readonly depositBaseUnits: string;
	readonly collateralSymbol: string;
	readonly collateralDecimals: number;
}

/**
 * Does this RFQ's escrow stay inside the agent's ceiling?
 *
 * A collateral token with no citable USD price is REFUSED, not waved through:
 * PRD 14 asks for a spend control, and "the limit could not be evaluated" is not
 * a pass. The USD figure is exact base-10 arithmetic (`usdRisk`), never a float.
 */
export function withinRfqDepositLimit(input: RfqDepositGateInput): RfqGate {
	if (!/^\d+$/.test(input.depositBaseUnits)) {
		return {
			ok: false,
			code: "RFQ_DEPOSIT_UNREADABLE",
			// TODO-OWNER: wording.
			reason: "The escrow this RFQ would lock could not be read, so the agent limit cannot be checked. Nothing was prepared.",
		};
	}
	if (input.collateralSymbol !== AGENT_COLLATERAL) {
		return {
			ok: false,
			code: "RFQ_COLLATERAL_NOT_ALLOWED",
			reason: `This RFQ escrows ${input.collateralSymbol}; the agent prepares ${AGENT_COLLATERAL} requests only (PRD 10.2). Nothing was prepared.`,
		};
	}
	const price = collateralUsdPrice(input.collateralSymbol);
	if (price === null) {
		return { ok: false, code: "RFQ_COLLATERAL_UNPRICED", reason: `${COLLATERAL_USD_UNAVAILABLE}. Nothing was prepared.` };
	}
	const deposit = decimalFromBaseUnits(input.depositBaseUnits, input.collateralDecimals);
	const valued = usdRisk(deposit, price, MAX_LOSS_USD);
	if (valued === null) {
		return { ok: false, code: "RFQ_COLLATERAL_UNPRICED", reason: `${COLLATERAL_USD_UNAVAILABLE}. Nothing was prepared.` };
	}
	if (!valued.withinLimit) {
		return {
			ok: false,
			code: "RFQ_OVER_LIMIT",
			reason: `This RFQ would escrow ${valued.amount} USD, over the ${MAX_LOSS_USD} USD agent limit (PRD 10.2). Nothing was prepared. Ask for fewer contracts or a lower reserve price.`,
		};
	}
	return { ok: true, depositUsd: valued.amount };
}
