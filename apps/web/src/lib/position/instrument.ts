/**
 * What a position is a position IN, read from the position's own immutable
 * order snapshot.
 *
 * `Domain.Position` carries money and lifecycle but no instrument: no strikes,
 * no call/put, no taker side. Every one of those is in `positions.order_snapshot`
 * — the exact maker order the fill executed against, stored NOT NULL at fill
 * time — and PRD 7.4 makes that snapshot, not a `theses` row, the authority for
 * what was traded. Reading it here also means a standalone position (migration
 * 0007: `positions.thesis_id` nullable) is described exactly like a position on
 * a post, from the same bytes.
 *
 * Nothing here touches the network. `getChainConfigById`, `getOptionImplementationInfo`
 * and `buildPriceFeedSymbolMap` are pure table lookups in the SDK bundle
 * (verified at `dist/index.js:285-299`: both index `CHAIN_CONFIGS_BY_ID` and
 * return `null`/`{}` for an unknown chain).
 *
 * Every field this file cannot justify comes back `null`, and a structure whose
 * payoff `@nuts/thetanuts`'s risk model does not cover gets `riskKind: null` so
 * the page prints "unavailable" instead of a guessed number.
 */
import {
	buildPriceFeedSymbolMap,
	getChainConfigById,
	getOptionImplementationInfo,
} from "@thetanuts-finance/thetanuts-client";
import type { RiskKind } from "@nuts/thetanuts";
import { measuredTakerSide } from "@/lib/market/taker-side";
import { createHash } from "node:crypto";

/** Base mainnet; the only chain this product trades on (CLAUDE.md, PRD 11). */
export const CHAIN_ID = 8453 as const;

/** Strikes arrive from the OptionBook feed with 8 decimals (SDK `OdetteRawOrderData.strikes`
 *  is documented "Strike prices (8 decimals)"), which is also `risk.ts`'s `PRICE_SCALE`. */
export const STRIKE_DECIMALS = 8;

/** The fields of `positions.order_snapshot` this module reads. Shaped as the
 *  stored `OrderSnapshotV1` so a row can be passed straight in. */
export interface OrderSnapshotLike {
	readonly order: { readonly expiry: string };
	readonly rawApiData?: Record<string, unknown> | undefined;
}

export interface PositionInstrument {
	/** Underlying ticker from the order's price feed; null when the feed is unmapped. */
	readonly asset: string | null;
	readonly isCall: boolean;
	/**
	 * The TAKER's side of this fill. `rawApiData.isLong` is the MAKER's long flag,
	 * so the taker takes the other side: `isLong === false` -> the maker sells ->
	 * the taker BUYS and pays premium; `isLong === true` -> the taker SELLS and
	 * posts collateral. Measured from chain bytes (`packages/thetanuts/src/side.ts`,
	 * `lib/market/taker-side.ts`); the SDK's own comment states the inverse and is
	 * wrong. Until 2026-09-05 this file kept its own copy of the mapping and had
	 * it backwards, so every position page named the wrong side. "buy" is long
	 * the structure; "sell" is short it and posts collateral.
	 */
	readonly takerSide: "buy" | "sell";
	/** Strikes as 8-decimal base-unit integer strings, in the book's own order —
	 *  the page must never reorder what the maker published. */
	readonly strikesUsd8: readonly string[];
	/** The same strikes ASCENDING, which is the only order `risk.ts` accepts for a
	 *  spread (`checked()` throws on `strikes[0] >= strikes[1]`). */
	readonly ascendingStrikesUsd8: readonly string[];
	/** Option expiry, ISO 8601. */
	readonly expiryAt: string;
	/** SDK implementation name, e.g. "PUT_SPREAD"; null when the address is unknown. */
	readonly implementationName: string | null;
	/**
	 * Structure identity shared with the market page, so "trade the same structure"
	 * lands on the same row. The canonical string is copied verbatim from
	 * `structureIdOf` in `apps/web/src/lib/market/structures.ts` (the trade round's
	 * file, read at its worktree `.claude/worktrees/trade-r1`, commit `0b9b2f5`).
	 * MERGE NOTE: when that file lands, delete this and import it.
	 */
	readonly structureId: string;
	readonly collateralAddress: string;
	readonly collateralSymbol: string | null;
	readonly collateralDecimals: number | null;
	/** The payoff shape `@nuts/thetanuts/risk.ts` models, or null when it models none. */
	readonly riskKind: RiskKind | null;
}

function stringField(raw: Record<string, unknown>, key: string): string | null {
	const value = raw[key];
	return typeof value === "string" ? value : null;
}

/** Nothing is coerced: a non-boolean is absent, not `false`. */
function booleanField(raw: Record<string, unknown>, key: string): boolean | null {
	const value = raw[key];
	return typeof value === "boolean" ? value : null;
}

/** Feed values may arrive as JSON numbers or strings; only whole non-negative values pass. */
function integerString(value: unknown): string | null {
	if (typeof value === "string") return /^\d+$/.test(value) ? value : null;
	if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
	return null;
}

/**
 * The four payoff shapes `@nuts/thetanuts/risk.ts` implements, keyed on the SDK's
 * implementation NAME. Same mapping as the trade round's `riskKindFor`
 * (`apps/web/src/lib/market/structures.ts` at `trade-r1` `0b9b2f5`), with one
 * extra fence: the SDK's own `numStrikes` for the implementation must equal the
 * number of strikes the order actually carries, so a mislabelled row is refused
 * rather than priced.
 *
 * `INVERSE_CALL`, `PHYSICAL_CALL`, `PHYSICAL_PUT`, the flies, condors, rangers
 * and loan handlers are all absent on purpose: `risk.ts` has no payoff model for
 * them (its own doc comment says so), and an unmodelled structure must read
 * "unavailable", never a number.
 */
export function riskKindFor(
	implementationName: string | null,
	strikeCount: number,
	sdkNumStrikes: number | null,
): RiskKind | null {
	if (sdkNumStrikes !== null && sdkNumStrikes !== strikeCount) return null;
	switch (implementationName) {
		case "PUT":
			return strikeCount === 1 ? "put" : null;
		case "LINEAR_CALL":
			return strikeCount === 1 ? "call" : null;
		case "PUT_SPREAD":
			return strikeCount === 2 ? "put-spread" : null;
		case "CALL_SPREAD":
			return strikeCount === 2 ? "call-spread" : null;
		default:
			return null;
	}
}

/** Copied verbatim from the trade round's `structureIdOf`; see `PositionInstrument.structureId`. */
export function structureIdOf(identity: {
	priceFeed: string;
	implementationAddress: string;
	collateralAddress: string;
	isCall: boolean;
	strikes: readonly bigint[];
	expiry: bigint;
}): string {
	const canonical = [
		identity.priceFeed.toLowerCase(),
		identity.implementationAddress.toLowerCase(),
		identity.collateralAddress.toLowerCase(),
		identity.isCall ? "call" : "put",
		identity.strikes.map((strike) => strike.toString()).join("-"),
		identity.expiry.toString(),
	].join("|");
	return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Null when the snapshot carries no `rawApiData` (the field is optional in
 * `OrderSnapshotV1`) or any load-bearing field is missing or the wrong type.
 * A partially-understood order is not described at all.
 */
export function positionInstrument(snapshot: OrderSnapshotLike): PositionInstrument | null {
	const raw = snapshot.rawApiData;
	if (raw === undefined || raw === null) return null;

	const priceFeed = stringField(raw, "priceFeed");
	const implementation = stringField(raw, "implementation");
	const collateral = stringField(raw, "collateral");
	const isCall = booleanField(raw, "isCall");
	const isLong = booleanField(raw, "isLong");
	const strikesRaw = raw["strikes"];
	if (
		priceFeed === null ||
		implementation === null ||
		collateral === null ||
		isCall === null ||
		isLong === null ||
		!Array.isArray(strikesRaw) ||
		strikesRaw.length === 0
	) {
		return null;
	}
	const strikes = strikesRaw.map(integerString);
	if (strikes.some((strike) => strike === null)) return null;
	// Two orderings, on purpose. The book's own order identifies the structure —
	// `structureIdOf` hashes exactly what the feed published, and the trade round
	// computes the same id from the same unsorted array, so sorting here would
	// produce a "trade the same structure" link that matches nothing. Ascending is
	// only for the risk helpers, which refuse an unordered spread.
	const feedOrder = (strikes as string[]).map((strike) => BigInt(strike));
	const ascending = [...feedOrder].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

	const expiry = integerString(snapshot.order.expiry);
	if (expiry === null) return null;

	const info = getOptionImplementationInfo(CHAIN_ID, implementation);
	const token = Object.values(getChainConfigById(CHAIN_ID).tokens).find(
		(entry) => entry.address.toLowerCase() === collateral.toLowerCase(),
	);

	return {
		asset: buildPriceFeedSymbolMap(CHAIN_ID)[priceFeed.toLowerCase()] ?? null,
		isCall,
		// The one measured rule; never a local copy of it (see the field's doc).
		takerSide: measuredTakerSide(isLong),
		strikesUsd8: feedOrder.map((strike) => strike.toString()),
		ascendingStrikesUsd8: ascending.map((strike) => strike.toString()),
		expiryAt: new Date(Number(expiry) * 1000).toISOString(),
		implementationName: info?.name ?? null,
		structureId: structureIdOf({
			priceFeed,
			implementationAddress: implementation,
			collateralAddress: collateral,
			isCall,
			strikes: feedOrder,
			expiry: BigInt(expiry),
		}),
		collateralAddress: collateral,
		collateralSymbol: token?.symbol ?? null,
		collateralDecimals: token?.decimals ?? null,
		riskKind: riskKindFor(info?.name ?? null, ascending.length, info?.numStrikes ?? null),
	};
}

/**
 * D-R3-1 / C-1 (pass 3). The market-direction rule MOVED to
 * `./lifecycle.ts` and is re-exported here so every existing import keeps
 * working.
 *
 * It had to move because `lib/display.ts` — which client components import —
 * needs it, and THIS file imports `@thetanuts-finance/thetanuts-client`, whose
 * bundle reaches for `fs/promises` (`lib/display-bundle.test.ts` is the guard).
 * A list row therefore could not read the same rule the position page reads, so
 * it kept mapping `side === "back"` to "Bull" and the same position rendered
 * Bull in a list and Bear on its own page.
 */
export { marketDirection, positionDirection } from "./lifecycle";
