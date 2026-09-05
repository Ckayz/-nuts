import "server-only";

/**
 * Signature verification boundary.
 *
 * Uses viem's **public-client** `verifyMessage`, not the standalone
 * `viem/utils` one: the public client hashes with `hashMessage` and then routes
 * through `verifyHash`, which recovers an EOA signature, calls ERC-1271
 * `isValidSignature` on a deployed contract account, and deploys the ERC-6492
 * validator via `eth_call` for a Coinbase Smart Wallet that has not been
 * deployed yet. Verified in the installed bytes:
 * `viem@2.56.3/_esm/actions/public/verifyMessage.js` -> `verifyHash.js`.
 *
 * That path needs an RPC, which is why the Base URL is required here.
 */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { env } from "@nuts/env/server";

export interface VerifySignatureInput {
	address: `0x${string}`;
	message: string;
	signature: `0x${string}`;
}

/** Injectable so tests can exercise the smart-wallet path without an RPC. */
export type SignatureVerifier = (input: VerifySignatureInput) => Promise<boolean>;

function createBaseClient() {
	return createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL) });
}

let client: ReturnType<typeof createBaseClient> | undefined;

function publicClient(): ReturnType<typeof createBaseClient> {
	if (client === undefined) client = createBaseClient();
	return client;
}

/**
 * Returns false rather than throwing when the RPC is unreachable or the
 * signature is malformed: a failed verification must never be reported as a
 * successful sign-in, and it must not surface an RPC error as an app crash.
 */
export const verifyWalletSignature: SignatureVerifier = async (input) => {
	try {
		return await publicClient().verifyMessage({
			address: input.address,
			message: input.message,
			signature: input.signature,
		});
	} catch {
		return false;
	}
};
