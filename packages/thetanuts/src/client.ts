import { MemoryStorageProvider, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { JsonRpcProvider } from "ethers";
import { ThetanutsLogicError } from "./errors";

export const BASE_CHAIN_ID = 8453 as const;

export interface CreateReadClientParams { readonly rpcUrl: string; readonly referrer?: string }

export function createReadClient({ rpcUrl, referrer }: CreateReadClientParams): ThetanutsClient {
  return new ThetanutsClient({ chainId: BASE_CHAIN_ID, provider: new JsonRpcProvider(rpcUrl), referrer, keyStorageProvider: new MemoryStorageProvider() });
}

export function assertBaseChain(chainId: number): asserts chainId is typeof BASE_CHAIN_ID {
  if (chainId !== BASE_CHAIN_ID) throw new ThetanutsLogicError("WRONG_CHAIN", `Expected Base chain ${BASE_CHAIN_ID}, received ${chainId}`, { chainId });
}
