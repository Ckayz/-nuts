/**
 * Structure identity and classification, derived from the OptionBook book only.
 *
 * A *structure* is an instrument: one (price feed, implementation, collateral,
 * call/put, strikes, expiry) tuple. An *order* is one maker's signed offer on
 * that instrument, and it is replaced roughly every minute when the maker
 * re-signs (PRD 14). So nothing user-facing may be keyed on an order: a page
 * that named orders would break every time a maker re-signed. The id below is
 * therefore over the instrument, and it deliberately excludes the price, the
 * signature, the maker, the nonce and the remaining size, all of which move.
 *
 * `isLong` is excluded as well: raw `isLong` is the MAKER's side
 * (`packages/thetanuts/src/side.ts`), so the taker-BUY order and the taker-SELL
 * order for the same instrument are the two SIDES of one structure. That is what
 * lets Bull and Bear address the same row.
 */
import { createHash } from "node:crypto";
import type { Market } from "@nuts/thetanuts";
import type { RiskKind } from "@nuts/thetanuts";

export interface StructureIdentity {
	readonly priceFeed: string;
	readonly implementationAddress: string;
	readonly collateralAddress: string;
	readonly isCall: boolean;
	readonly strikes: readonly bigint[];
	/** Option expiry, unix seconds. */
	readonly expiry: bigint;
}

/**
 * Stable id for one instrument. Hex, 16 characters.
 *
 * Collisions are not a safety boundary: before any calldata is built the chosen
 * order is re-read from the book and every one of these fields is compared
 * again, and after the fill they are compared once more against the mined
 * transaction's own calldata.
 */
export function structureIdOf(identity: StructureIdentity): string {
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

/** The same id, from a derived market row. */
export function structureId(market: Market): string {
	return structureIdOf({
		priceFeed: market.priceFeed,
		implementationAddress: market.implementation.address,
		collateralAddress: market.collateralToken.address,
		isCall: market.side === "call",
		strikes: market.strikes,
		expiry: market.expiry,
	});
}

/**
 * The risk model in `@nuts/thetanuts` covers four payoff shapes. Everything else
 * — physical/inverse calls, rangers, flies, condors — has no payoff model there,
 * so max loss, max payout and break-even are reported as unavailable rather than
 * guessed. `packages/thetanuts/src/risk.ts` states the same limit.
 */
export function riskKindFor(implementationName: string | null, strikeCount: number): RiskKind | null {
	switch (implementationName) {
		case "PHYSICAL_PUT":
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

/**
 * Strikes ascending, for the risk helpers only.
 *
 * `payoffAtExpiry` and friends require `strikes[0] < strikes[1]` and a spread's
 * economics depend on the pair as a set, so sorting is safe there. Display keeps
 * the book's own order: the page must never reorder what the maker published.
 */
export function ascendingStrikes(strikes: readonly bigint[]): bigint[] {
	return [...strikes].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** SDK implementation name as product wording, e.g. `PUT_SPREAD` -> `put spread`. */
export function productLabel(implementationName: string | null, fallbackAddress: string): string {
	if (implementationName === null) return fallbackAddress;
	return implementationName.toLowerCase().replace(/_/g, " ");
}

/**
 * The compact order name the mockup's ticket shows ("78000/74000-PS").
 * Derived from the book: strikes joined, then the product's initials.
 */
export function orderLabel(strikesUsd: readonly string[], implementationName: string | null, isCall: boolean): string {
	const suffix =
		implementationName === null
			? isCall
				? "C"
				: "P"
			: implementationName
					.split("_")
					.map((word) => word[0] ?? "")
					.join("");
	return `${strikesUsd.join("/")}-${suffix}`;
}
