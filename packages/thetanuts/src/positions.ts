import type { Position, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";

export function getIndexedPositions(client: ThetanutsClient, address: string): Promise<Position[]> { return client.api.getUserPositionsFromIndexer(address); }
export async function getOptionState(client: ThetanutsClient, optionAddress: string) { const [info, twap] = await Promise.all([client.option.getFullOptionInfo(optionAddress), client.option.getTWAP(optionAddress)]); return { info, twap }; }
export function settledPayout(client: ThetanutsClient, optionAddress: string, settlementPrice: bigint) { return client.option.calculatePayout(optionAddress, settlementPrice); }
