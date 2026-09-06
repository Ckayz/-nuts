import { MemoryStorageProvider, ThetanutsClient, type KeyStorageProvider } from "@thetanuts-finance/thetanuts-client";
import { JsonRpcProvider } from "ethers";
import { ThetanutsLogicError } from "./errors";

export const BASE_CHAIN_ID = 8453 as const;

export interface CreateReadClientParams { readonly rpcUrl: string; readonly referrer?: string }

export function createReadClient({ rpcUrl, referrer }: CreateReadClientParams): ThetanutsClient {
  return new ThetanutsClient({ chainId: BASE_CHAIN_ID, provider: new JsonRpcProvider(rpcUrl), referrer, keyStorageProvider: new MemoryStorageProvider() });
}

export interface CreateRfqClientParams extends CreateReadClientParams {
  /**
   * Where the requester's ECDH private key lives. RFQ offers are encrypted to
   * the requester's public key, so a key that dies with the process (the
   * `MemoryStorageProvider` `createReadClient` uses) means offers on an RFQ
   * created today can never be decrypted. Pass a durable, per-wallet provider.
   */
  readonly keyStorageProvider: KeyStorageProvider;
}

/**
 * A client for the RFQ path. Same constructor as `createReadClient` — the only
 * difference is the injected key storage, which is what makes the requester's
 * keypair outlive the process. Reads and calldata encoders behave identically.
 */
export function createRfqClient({ rpcUrl, referrer, keyStorageProvider }: CreateRfqClientParams): ThetanutsClient {
  return new ThetanutsClient({ chainId: BASE_CHAIN_ID, provider: new JsonRpcProvider(rpcUrl), referrer, keyStorageProvider });
}

export function assertBaseChain(chainId: number): asserts chainId is typeof BASE_CHAIN_ID {
  if (chainId !== BASE_CHAIN_ID) throw new ThetanutsLogicError("WRONG_CHAIN", `Expected Base chain ${BASE_CHAIN_ID}, received ${chainId}`, { chainId });
}
