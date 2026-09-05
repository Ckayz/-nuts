/**
 * C#5 (lane C confirming pass, finding 5). What an approval transaction will
 * actually do, read from the bytes that will be sent.
 *
 * The approval stage used to hand back calldata and a sentence, and nothing
 * else. Nothing measured the allowance, so `withinAgentLimits` passed every
 * approval-stage result unconditionally and the card printed the agent's own
 * preview beside it. The reviewer's probe printed a liquidity-capped $5 trade
 * and sent an exact 20-USDC approval:
 *   APPROVE_BEFORE_GATE {"sends":[{"to":"0x8335…2913","amount":"20000000"}],"prepares":1}
 *
 * PRD 10.2, verbatim: "Allowances must be exact for the approved transaction."
 * The only way to know an allowance is exact is to read it out of the calldata
 * — a number returned alongside the bytes is a claim about them, not the bytes.
 *
 * Pure, dependency-free and shared by the server (which refuses to issue an
 * approval whose bytes disagree with the quote) and the browser (which refuses
 * to SEND an approval whose bytes disagree with the amount it printed).
 */

/** `approve(address,uint256)`. */
export const APPROVE_SELECTOR = "0x095ea7b3";

export interface DecodedApproval {
	/** Lowercase 0x address the allowance is granted to. */
	readonly spender: string;
	/** Base units, as a decimal string — the same shape every `QuoteRaw` field uses. */
	readonly amount: string;
}

/**
 * Decodes ERC-20 `approve(address,uint256)` calldata, or null.
 *
 * Fails closed on anything else: another selector, a short or long body, a
 * spender with dirty high-order bytes (a 32-byte word whose first 12 bytes are
 * not zero is not an address, and treating it as one would silently drop them).
 */
export function decodeApproval(data: string): DecodedApproval | null {
	if (!/^0x[0-9a-fA-F]*$/.test(data)) return null;
	const body = data.slice(2).toLowerCase();
	if (body.length !== 8 + 64 + 64) return null;
	if (`0x${body.slice(0, 8)}` !== APPROVE_SELECTOR) return null;
	const spenderWord = body.slice(8, 8 + 64);
	if (spenderWord.slice(0, 24) !== "0".repeat(24)) return null;
	const amountWord = body.slice(8 + 64);
	return { spender: `0x${spenderWord.slice(24)}`, amount: BigInt(`0x${amountWord}`).toString() };
}

export type ApprovalCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Is this approval EXACTLY the one this fill needs?
 *
 * `amount` must equal the debit to the base unit — no ceiling, no rounding, no
 * "at least". `spender` must be the contract the fill itself calls, so an
 * allowance can never be granted to something other than the OptionBook the
 * user is about to fill through.
 *
 * TODO-OWNER: no tolerance is allowed here. If the owner ever wants a headroom
 * allowance, that is a product decision and a number, and it belongs to them.
 */
export function approvalMatches(input: {
	readonly data: string;
	readonly expectedSpender: string;
	readonly expectedAmount: string;
}): ApprovalCheck {
	const decoded = decodeApproval(input.data);
	if (decoded === null) {
		return { ok: false, reason: "The approval calldata is not a plain ERC-20 approve, so what it would allow cannot be read." };
	}
	if (decoded.spender !== input.expectedSpender.toLowerCase()) {
		return {
			ok: false,
			reason: `The approval would grant an allowance to ${decoded.spender}, which is not the contract this fill calls.`,
		};
	}
	if (decoded.amount !== input.expectedAmount) {
		return {
			ok: false,
			reason: `The approval would allow ${decoded.amount} base units; this fill needs exactly ${input.expectedAmount}.`,
		};
	}
	return { ok: true };
}
