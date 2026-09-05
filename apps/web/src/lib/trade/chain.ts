import "server-only";

/**
 * The read-only viem client the trade path uses for receipts, transactions and
 * fill simulation. Read-only by construction: no account, no key, no signer —
 * the user's wallet signs and broadcasts every transaction (PRD 18).
 */
import { createPublicClient, http, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { env } from "@nuts/env/server";

export const CHAIN_ID = 8453 as const;
export const EXPLORER_TX_BASE = "https://basescan.org/tx/";

// The return type is inferred, never annotated as viem's `PublicClient`: wagmi
// ships its own copy of viem, and the two structurally identical `PublicClient`
// types are not assignable to each other.
function createClient() {
	return createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL) });
}

let client: ReturnType<typeof createClient> | null = null;

export function publicClient(): ReturnType<typeof createClient> {
	if (client === null) client = createClient();
	return client;
}

/**
 * Simulates the fill as the taker, before any calldata reaches the browser
 * (PRD 14: "Simulate every write ... so a chain-level failure surfaces as a
 * server error rather than a wallet revert").
 *
 * The SDK's own `callStaticFillOrder` cannot be used here: it calls
 * `client.requireSigner()` (SDK dist/index.js:2435) and this process holds no
 * key. A plain `eth_call` from the taker's address exercises the same contract
 * path without one.
 *
 * Only meaningful once the collateral allowance covers the debit, which is why
 * the caller runs the approval as its own step first.
 */
export async function simulateFill(input: {
	account: Address;
	to: Address;
	data: Hex;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
	try {
		await publicClient().call({ account: input.account, to: input.to, data: input.data });
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// viem's message is multi-line and starts with the revert summary.
		return { ok: false, reason: message.split("\n")[0] ?? "The fill would revert on chain." };
	}
}

/** ERC-20 `Transfer(address,address,uint256)`. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

/**
 * Collateral base units that actually left `wallet` in this receipt.
 *
 * This is the taker's real debit, read from the token's own `Transfer` logs
 * rather than from any formula. A taker BUY produces two outgoing transfers
 * (premium minus fee to the maker, fee to the OptionBook) that sum to the
 * premium; a taker SELL produces one, the posted collateral — both measured on
 * the decoded production fills in `.research/thetanuts/finding-fill-debits.md`.
 */
export function measureDebit(input: {
	logs: readonly { address: string; topics: readonly string[]; data: string }[];
	token: string;
	wallet: string;
}): bigint {
	const token = input.token.toLowerCase();
	const from = input.wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
	let total = 0n;
	for (const log of input.logs) {
		if (log.address.toLowerCase() !== token) continue;
		if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
		if (log.topics.length !== 3) continue;
		if (log.topics[1]?.toLowerCase().replace(/^0x/, "") !== from) continue;
		total += BigInt(log.data);
	}
	return total;
}
