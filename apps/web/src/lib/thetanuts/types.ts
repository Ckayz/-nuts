import type { Market } from "@nuts/thetanuts";

/** An order entry plus the derived fields the agent reasons about. */
export interface TradeableOrder {
	entry: { order: NonNullable<Market["order"]["rawApiData"]> & { expiry: number }; signature: string };
	sdkOrder: Market["order"];
	side: "buy" | "sell";
	implementation: Market["implementation"];
	collateralToken: Market["collateralToken"];
	/** Label rebuilt from package market fields and SDK implementation metadata. */
	label: string;
	/** Underlying symbol, e.g. "ETH". Null when it cannot be resolved. */
	asset: string | null;
	/**
	 * "vanilla" for single-strike calls and puts; "multi_leg" for spreads,
	 * butterflies and condors. SDK 0.3.0 has no binary discriminator.
	 */
	kind: "vanilla" | "multi_leg" | null;
	/** SDK implementation name; null when unknown. */
	productType: string | null;
	isCall: boolean;
	/** Strike prices as decimal strings, e.g. "2420". */
	strikesUsd: string[];
	/** Option expiry, ISO 8601. */
	expiryAt: string;
	/** When this order's signature stops being valid, ISO 8601. Roughly 59s out. */
	orderExpiresAt: string;
	/** Legacy name: signed premium per contract in collateral token, not USD. */
	pricePerContractUsd: string;
	/** Legacy name: collateral token amount, not USD; null if decimals are unknown. */
	makerBudgetUsd: string | null;
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
