import { z } from "zod";

/** Base mainnet. The only chain this product trades on (PRD 18). */
export const CHAIN_ID = 8453 as const;

/** USDC on Base, 6 decimals. The only collateral in v1 (PRD 10.2). */
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** Price and strike fixed-point scale used by the order feed. */
export const PRICE_SCALE = 100_000_000n; // 1e8
/** USDC fixed-point scale. */
export const USDC_SCALE = 1_000_000n; // 1e6

/**
 * One order exactly as the feed publishes it. Fields are preserved verbatim
 * because the maker's EIP-712 signature covers them (PRD 11): anything we
 * re-derive and send instead of these values will fail signature validation.
 */
export const rawOrderSchema = z.object({
	/**
	 * Present only on single-leg vanillas, e.g. "ETH-5SEP26-2420-P". Multi-leg
	 * structures and binaries omit it and carry `name`/`type` instead, so the
	 * underlying asset is resolved from `priceFeed` for those.
	 */
	ticker: z.string().optional(),
	/** Human label on structured products, e.g. "ETH 2460 Up 1D". */
	name: z.string().nullish(),
	/** Product family on structured products, e.g. "binaries". */
	type: z.string().nullish(),
	numContracts: z.string().nullish(),
	maker: z.string(),
	orderExpiryTimestamp: z.number(),
	collateral: z.string(),
	isCall: z.boolean(),
	priceFeed: z.string(),
	implementation: z.string(),
	isLong: z.boolean(),
	maxCollateralUsable: z.string(),
	strikes: z.array(z.number()),
	expiry: z.number(),
	price: z.string(),
	extraOptionData: z.string(),
});

export const orderEntrySchema = z.object({
	order: rawOrderSchema,
	signature: z.string(),
	chainId: z.number(),
	optionBookAddress: z.string(),
	nonce: z.string(),
	greeks: z
		.object({
			delta: z.number(),
			iv: z.number(),
			gamma: z.number(),
			theta: z.number(),
			vega: z.number(),
		})
		.partial()
		.optional(),
});

export const ordersPayloadSchema = z.object({
	data: z.object({
		timestamp: z.union([z.number(), z.string()]).optional(),
		// Rows are validated one at a time by the caller so a single unfamiliar
		// entry cannot blank the whole book.
		orders: z.array(z.unknown()),
		market_data: z.record(z.string(), z.number()).optional(),
	}),
	metadata: z
		.object({
			last_updated: z.number().optional(),
			current_time: z.number().optional(),
		})
		.optional(),
});

export type RawOrder = z.infer<typeof rawOrderSchema>;
export type OrderEntry = z.infer<typeof orderEntrySchema>;
export type OrdersPayload = z.infer<typeof ordersPayloadSchema>;

/** An order entry plus the derived fields the agent reasons about. */
export interface TradeableOrder {
	entry: OrderEntry;
	/** "ETH-5SEP26-2420-P" on vanillas, "ETH 2460 Up 1D" on structured products. */
	label: string;
	/** Underlying symbol, e.g. "ETH". Null when it cannot be resolved. */
	asset: string | null;
	/**
	 * "vanilla" for single-strike calls and puts, "binary" for the up/down
	 * products, "multi_leg" for spreads, butterflies and condors.
	 */
	kind: "vanilla" | "binary" | "multi_leg";
	/** Product family as published, e.g. "binaries". Null on vanillas. */
	productType: string | null;
	isCall: boolean;
	/** Strike prices as decimal strings, e.g. "2420". */
	strikesUsd: string[];
	/** Option expiry, ISO 8601. */
	expiryAt: string;
	/** When this order's signature stops being valid, ISO 8601. Roughly 59s out. */
	orderExpiresAt: string;
	/** Premium per contract as a decimal string, e.g. "1.63192941". */
	pricePerContractUsd: string;
	/** Maker's remaining collateral budget as a decimal string, e.g. "10000". */
	makerBudgetUsd: string;
}

export interface OrderSnapshot {
	orders: TradeableOrder[];
	/**
	 * When this snapshot was fetched. Every proposal records this: order signatures
	 * expire 59 seconds after issue, so calldata built from a stale snapshot must be
	 * rebuilt rather than sent (PRD 14).
	 */
	fetchedAt: Date;
	/** Spot prices keyed by asset symbol, as published alongside the book. */
	marketData: Record<string, number>;
	/**
	 * Entries the feed returned that failed validation and were dropped. Non-zero
	 * is a signal the upstream shape changed, not a reason to fail the request.
	 */
	droppedEntries: number;
}
