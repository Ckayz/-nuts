import "server-only";

/**
 * Replaying decoded Base production fills.
 *
 * TEST FIXTURE MODULE. Nothing in the app imports it; it exists so the trade
 * tests can rebuild a real signed order and a real receipt from mainnet and
 * check this code against transfers that actually happened, rather than against
 * numbers this repository wrote down.
 *
 * The hashes and the expected amounts come from
 * `.research/thetanuts/finding-fill-debits.md`, which decoded them from chain on
 * 2026-09-05. Every field below is re-read over read-only RPC at test time; the
 * constants are the assertions, not the inputs.
 */
import { decodeFunctionData, type Log } from "viem";
import { OPTION_BOOK_ABI, type OrderWithSignature } from "@thetanuts-finance/thetanuts-client";
import { expectOrderFilled, type ParsedOrderFilled } from "@nuts/thetanuts";
import { encodeOrderSnapshot, type OrderSnapshotV1 } from "@nuts/db/order-snapshot";
import { publicClient } from "./chain";

export const OPTION_BOOK = "0x1bDff855d6811728acaDC00989e79143a2bdfDed" as const;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface ProductionFillExpectation {
	readonly hash: `0x${string}`;
	readonly takerSide: "buy" | "sell";
	readonly collateralSymbol: string;
	readonly collateralDecimals: number;
	readonly contractSizeDecimals: number;
	readonly numContracts: bigint;
	readonly premium: bigint;
	readonly fee: bigint;
	/** Collateral base units that left the taker's wallet. */
	readonly takerDebit: bigint;
	/** Collateral the taker posted; zero on the buy side. */
	readonly takerCollateral: bigint;
}

export const PRODUCTION_FILLS: readonly ProductionFillExpectation[] = [
	{
		hash: "0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c",
		takerSide: "buy",
		collateralSymbol: "USDC",
		collateralDecimals: 6,
		contractSizeDecimals: 6,
		numContracts: 389926n,
		premium: 999998n,
		fee: 124999n,
		takerDebit: 999998n,
		takerCollateral: 0n,
	},
	{
		hash: "0xdf3323fefb54cd040a0e86cca3733e4c469a77e33c85a0351e9e987dcfda76f3",
		takerSide: "sell",
		collateralSymbol: "aBasUSDC",
		collateralDecimals: 6,
		contractSizeDecimals: 6,
		numContracts: 10000n,
		premium: 21268n,
		fee: 2658n,
		takerDebit: 22000000n,
		takerCollateral: 22000000n,
	},
];

export interface LoadedFill {
	readonly hash: `0x${string}`;
	readonly order: OrderWithSignature;
	readonly snapshot: OrderSnapshotV1;
	readonly event: ParsedOrderFilled;
	readonly logs: readonly Log<bigint, number, false>[];
	/** The wallet on the taker side of this fill, lowercase. */
	readonly taker: string;
	readonly takerSide: "buy" | "sell";
	readonly blockTimeSeconds: number;
}

/** Rebuilds the signed order and the fill event of one mainnet transaction. */
export async function loadProductionFill(hash: `0x${string}`): Promise<LoadedFill> {
	const client = publicClient();
	const [transaction, receipt] = await Promise.all([
		client.getTransaction({ hash }),
		client.getTransactionReceipt({ hash }),
	]);
	const block = await client.getBlock({ blockNumber: receipt.blockNumber });
	const decoded = decodeFunctionData({ abi: OPTION_BOOK_ABI, data: transaction.input });
	if (decoded.functionName !== "fillOrder") throw new Error(`${hash} is not a fillOrder call`);
	const [contractOrder, signature] = decoded.args;
	const event = expectOrderFilled(receipt.logs, { optionBook: OPTION_BOOK });
	// `sellerWasMaker` says which side the maker took, so the taker is the other.
	const takerSide = event.sellerWasMaker ? "buy" : "sell";
	const taker = (takerSide === "buy" ? event.buyer : event.seller).toLowerCase();

	const order: OrderWithSignature = {
		signature,
		availableAmount: contractOrder.maxCollateralUsable,
		makerAddress: contractOrder.maker,
		order: {
			maker: contractOrder.maker,
			taker: ZERO,
			option: event.optionAddress,
			// SDK `normalizeOdetteOrder`: isBuyer = !isLong.
			isBuyer: !contractOrder.isLong,
			numContracts: contractOrder.numContracts,
			price: contractOrder.price,
			expiry: contractOrder.expiry,
			nonce: event.nonce,
		},
		rawApiData: {
			collateral: contractOrder.collateral,
			priceFeed: contractOrder.priceFeed,
			implementation: contractOrder.implementation,
			strikes: contractOrder.strikes.map((strike) => strike.toString()),
			isCall: contractOrder.isCall,
			isLong: contractOrder.isLong,
			orderExpiryTimestamp: Number(contractOrder.orderExpiryTimestamp),
			extraOptionData: contractOrder.extraOptionData,
			maxCollateralUsable: contractOrder.maxCollateralUsable.toString(),
		},
	};

	return {
		hash,
		order,
		snapshot: encodeOrderSnapshot(order),
		event,
		logs: receipt.logs,
		taker,
		takerSide,
		blockTimeSeconds: Number(block.timestamp),
	};
}
