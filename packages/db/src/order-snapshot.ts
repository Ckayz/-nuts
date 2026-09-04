import type { OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { z } from "zod";

const integerString = z.string().regex(/^-?\d+$/);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]));
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const orderSnapshotV1Schema = z.object({
  version: z.literal(1),
  order: z.object({
    maker: z.string(), taker: z.string(), option: z.string(), isBuyer: z.boolean(), numContracts: integerString,
    price: integerString, expiry: integerString, nonce: integerString, optionType: z.number().optional(),
    strikes: z.array(integerString).optional(), strikePrice: integerString.optional(), collateralToken: z.string().optional(),
    underlyingToken: z.string().optional(), deadline: integerString.optional(),
  }).passthrough(),
  signature: z.string(), availableAmount: integerString, makerAddress: z.string(),
  rawApiData: z.record(z.string(), jsonValueSchema).optional(),
}).strict();
export type OrderSnapshotV1 = z.infer<typeof orderSnapshotV1Schema>;

export function encodeOrderSnapshot(order: OrderWithSignature): OrderSnapshotV1 {
  const encoded = JSON.parse(JSON.stringify({ version: 1, ...order }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value));
  return orderSnapshotV1Schema.parse(encoded);
}

export function decodeOrderSnapshot(snapshot: OrderSnapshotV1): OrderWithSignature {
  const value = orderSnapshotV1Schema.parse(snapshot);
  return { signature: value.signature, availableAmount: BigInt(value.availableAmount), makerAddress: value.makerAddress, rawApiData: value.rawApiData as OrderWithSignature["rawApiData"], order: { maker: value.order.maker, taker: value.order.taker, option: value.order.option, isBuyer: value.order.isBuyer, numContracts: BigInt(value.order.numContracts), price: BigInt(value.order.price), expiry: BigInt(value.order.expiry), nonce: BigInt(value.order.nonce), optionType: value.order.optionType, strikes: value.order.strikes?.map(BigInt), strikePrice: value.order.strikePrice === undefined ? undefined : BigInt(value.order.strikePrice), collateralToken: value.order.collateralToken, underlyingToken: value.order.underlyingToken, deadline: value.order.deadline === undefined ? undefined : BigInt(value.order.deadline) } };
}
