import { OPTION_BOOK_ABI, type OrderWithSignature, type ThetanutsClient } from "@thetanuts-finance/thetanuts-client";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { ThetanutsLogicError } from "./errors";
import { takerSide } from "./side";

export interface Tx { readonly to: Address; readonly data: Hex; readonly value: 0n }
export interface FillClient { readonly optionBook: Pick<ThetanutsClient["optionBook"], "previewFillOrder" | "encodeFillOrder">; readonly erc20: Pick<ThetanutsClient["erc20"], "getAllowance" | "encodeApprove"> }
export interface BuildFillTransactionsParams { readonly client: FillClient; readonly order: OrderWithSignature; readonly budget: bigint; readonly referrer?: string; readonly account: Address; /** @deprecated Ignored: premium-funded buy APIs never allow taker sells. */ readonly allowUnverifiedTakerSell?: boolean; readonly now?: number }
export interface FillTransactions { readonly approve?: Tx; readonly fill: Tx; readonly expected: { readonly budget: bigint; readonly numContracts: bigint; readonly premium: bigint; readonly collateralToken: Address; readonly spender: Address } }
const tx = (encoded: { readonly to: string; readonly data: string }): Tx => ({ to: encoded.to as Address, data: encoded.data as Hex, value: 0n });

// TODO-OWNER: Gas estimation and gas headroom belong to the sending app; this package invents neither.

/** Builds exact-approval and fill calldata. Chain validation remains the caller's responsibility via assertBaseChain. Capped-budget rounding is UNVERIFIED (research §3/open question 3), so no rounding allowance is added. This premium-funded API rejects taker sells unconditionally. */
export async function buildFillTransactions({ client, order, budget, referrer, account, now }: BuildFillTransactionsParams): Promise<FillTransactions> {
  const timestamp = BigInt(now ?? Math.floor(Date.now() / 1_000));
  const raw = order.rawApiData;
  if (!raw) throw new ThetanutsLogicError("INVALID_ORDER", "Order is missing rawApiData");
  if (takerSide(order) === "sell") throw new ThetanutsLogicError("TAKER_SELL_UNVERIFIED", "Use quoteSellFill for taker sells; that API is blocked pending SDK sizing reconciliation (README)");
  if (order.order.expiry <= timestamp || BigInt(raw.orderExpiryTimestamp) <= timestamp) throw new ThetanutsLogicError("ORDER_EXPIRED", "Option or signed order has expired");
  const preview = client.optionBook.previewFillOrder(order, budget, referrer);
  if (preview.numContracts <= 0n) throw new ThetanutsLogicError("ZERO_CONTRACTS", "Premium produces zero contracts");
  const premium = preview.numContracts * preview.pricePerContract / 100_000_000n;
  if (premium === 0n) throw new ThetanutsLogicError("ZERO_PREMIUM", "Nonzero contract count produces zero premium");
  const fill = tx(client.optionBook.encodeFillOrder(order, budget, referrer));
  const decoded = decodeFunctionData({ abi: OPTION_BOOK_ABI, data: fill.data });
  const encodedOrder = decoded.args?.[0];
  if (decoded.functionName !== "fillOrder" || typeof encodedOrder !== "object" || encodedOrder === null || !("numContracts" in encodedOrder) || typeof encodedOrder.numContracts !== "bigint") {
    throw new ThetanutsLogicError("INVALID_ORDER", "Could not decode fill calldata");
  }
  const encodedContracts = encodedOrder.numContracts;
  if (encodedContracts !== preview.numContracts) {
    throw new ThetanutsLogicError("INVALID_ORDER", "Encoded fill contract count differs from preview", { expected: preview.numContracts, encoded: encodedContracts });
  }
  const collateralToken = preview.collateralToken as Address;
  const allowance = await client.erc20.getAllowance(collateralToken, account, fill.to);
  const approve = allowance < premium ? tx(client.erc20.encodeApprove(collateralToken, fill.to, premium)) : undefined;
  return { ...(approve ? { approve } : {}), fill, expected: { budget, numContracts: preview.numContracts, premium, collateralToken, spender: fill.to } };
}
