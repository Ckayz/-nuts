import type { OrderWithSignature, ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import type { Address, Hex } from "viem";
import { ThetanutsLogicError } from "./errors";

export interface Tx { readonly to: Address; readonly data: Hex; readonly value: 0n }
export interface FillClient { readonly optionBook: Pick<ThetanutsClient["optionBook"], "previewFillOrder" | "encodeFillOrder">; readonly erc20: Pick<ThetanutsClient["erc20"], "getAllowance" | "encodeApprove"> }
export interface BuildFillTransactionsParams { readonly client: FillClient; readonly order: OrderWithSignature; readonly premium: bigint; readonly referrer?: string; readonly account: Address }
export interface FillTransactions { readonly approve?: Tx; readonly fill: Tx; readonly expected: { readonly numContracts: bigint; readonly premium: bigint; readonly collateralToken: Address; readonly spender: Address } }
const tx = (encoded: { readonly to: string; readonly data: string }): Tx => ({ to: encoded.to as Address, data: encoded.data as Hex, value: 0n });

// TODO-OWNER: Gas estimation and gas headroom belong to the sending app; this package invents neither.

/** Builds exact-approval and fill calldata. Chain validation remains the caller's responsibility via assertBaseChain. Capped-budget rounding and taker-sell debit are UNVERIFIED (research §3/open questions 2–3). */
export async function buildFillTransactions({ client, order, premium, referrer, account }: BuildFillTransactionsParams): Promise<FillTransactions> {
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const raw = order.rawApiData;
  if (!raw) throw new ThetanutsLogicError("INVALID_ORDER", "Order is missing rawApiData");
  if (order.order.expiry <= now || BigInt(raw.orderExpiryTimestamp) <= now) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  const preview = client.optionBook.previewFillOrder(order, premium, referrer);
  if (preview.numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Premium produces zero contracts");
  const fill = tx(client.optionBook.encodeFillOrder(order, premium, referrer));
  const collateralToken = preview.collateralToken as Address;
  const allowance = await client.erc20.getAllowance(collateralToken, account, fill.to);
  const approve = allowance < premium ? tx(client.erc20.encodeApprove(collateralToken, fill.to, premium)) : undefined;
  return { ...(approve ? { approve } : {}), fill, expected: { numContracts: preview.numContracts, premium, collateralToken, spender: fill.to } };
}
