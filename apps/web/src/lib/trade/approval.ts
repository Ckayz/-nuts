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

/**
 * C#8 (lane C confirming pass, finding 8). PRD 14, verbatim: "calldata must be
 * built and broadcast within 30 seconds of the fetch that produced it."
 *
 * The number is the PRD's, cited above — not this file's. It is a MAXIMUM AGE,
 * which is a different clock from the maker signature's remaining validity: the
 * reviewer advanced 31 seconds with the signature still valid and the stale
 * calldata was broadcast (`STALE_FILL {elapsedSeconds:31, prepares:0, sends:1}`).
 */
export const MAX_FILL_AGE_MS = 30_000;

/**
 * Is this calldata older than the PRD's window?
 *
 * Fails CLOSED: an absent or unparseable timestamp is stale, because "we cannot
 * tell how old this is" is not a reason to broadcast it. A timestamp in the
 * FUTURE is stale too — a clock that disagrees is not evidence of freshness.
 */
export function fillIsStale(preparedAt: string | undefined, now: number): boolean {
	if (preparedAt === undefined) return true;
	const at = Date.parse(preparedAt);
	if (Number.isNaN(at)) return true;
	if (at > now) return true;
	return now - at > MAX_FILL_AGE_MS;
}

/**
 * M5 (Opus user-flow tester, confirming round). How long either wallet path
 * waits for an APPROVAL to be mined before it stops waiting and says so.
 *
 * Measured on the shipped build: neither `components/market/take-a-side.tsx` nor
 * `components/agent/trade-execution.tsx` passed a `timeout`, and the tester's
 * wallet — one that returns a hash which never lands — left the ticket's button
 * reading "Approving…", disabled, with no message and no way out but a reload,
 * at t = 30 / 60 / 120 / 185 / 200 / 215 s (`final-j4-stuck-approving.png`).
 *
 * NOT VERIFIED, stated plainly: viem's own default is `timeout = 180_000` and it
 * rejects with `WaitForTransactionReceiptTimeoutError`
 * (`viem/_esm/actions/public/waitForTransactionReceipt.js:53,73`, read at
 * viem@2.56.3), so the wait was not literally unbounded at the bytes. I could
 * not reproduce the tester's 215 s in a browser and do not know which part of
 * that path swallowed the rejection. What IS reproduced here, in the component
 * harness, is the state the user is left in while it waits: a disabled button
 * with no sentence.
 *
 * TODO-OWNER: the number. 90 seconds is HALF viem's own default and is this
 * file's choice, not the owner's and not the PRD's — nothing in `docs/PRD.md`
 * sets a confirmation-wait budget. It is a display bound only: the wallet keeps
 * the transaction, the allowance still lands if it lands, and pressing the
 * button again re-prepares against the on-chain allowance.
 */
export const APPROVAL_RECEIPT_TIMEOUT_MS = 90_000;
