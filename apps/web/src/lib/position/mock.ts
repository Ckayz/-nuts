/**
 * `/p/[id]` against the typed fixtures.
 *
 * The fixture positions record no order snapshot and no raw fill amounts — they
 * never did — so before this round every mock position page rendered "—" in the
 * hero, in all three tiles and in most of the detail rows, and the page was
 * never exercised with real values.
 *
 * Round-1 fold item 23: the fixture positions get ONE example instrument and one
 * example set of raw fill amounts, so mock mode shows the page as a user will
 * see it. They are EXAMPLE DATA, marked as such below, and they are shaped
 * exactly like the real thing: the instrument is read by the SAME
 * `positionInstrument` the database path uses, out of an order snapshot in the
 * stored `OrderSnapshotV1` shape, and the P&L is derived by the same risk model
 * from the same raw base units. Nothing here is a special mock code path, so a
 * bug in the real reader shows up here too.
 */
import * as data from "@/mock/data";
import type * as Domain from "@/types";
import { positionInstrument, type OrderSnapshotLike } from "./instrument";
import type { PositionPageDetail, PositionQuantities } from "./types";

/*
 * EXAMPLE DATA. Addresses are the SDK's own Base-mainnet entries
 * (`getChainConfigById(8453)`): the PHYSICAL_PUT implementation, the aBasUSDC
 * collateral token and the BTC price feed. The instrument is the mockup's own
 * example — a BTC 78,000 put expiring 11 Sep 2026 08:00 UTC.
 */
const EXAMPLE_PUT_IMPLEMENTATION = "0xf480f636301d50ed570d026254dc5728b746a90f";
const EXAMPLE_COLLATERAL = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";
const EXAMPLE_BTC_FEED = "0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f";
/** 2026-09-11T08:00:00Z, the expiry the mockup writes. */
const EXAMPLE_EXPIRY_SECONDS = "1789113600";

const EXAMPLE_SNAPSHOT: OrderSnapshotLike = {
	order: { expiry: EXAMPLE_EXPIRY_SECONDS },
	rawApiData: {
		collateral: EXAMPLE_COLLATERAL,
		priceFeed: EXAMPLE_BTC_FEED,
		implementation: EXAMPLE_PUT_IMPLEMENTATION,
		// 78,000 USD at the feed's 8 decimals.
		strikes: ["7800000000000"],
		isCall: false,
		// The MAKER's long flag. `isLong: false` means the maker sells, so the
		// taker BUYS and pays a premium (CLAUDE.md, corrected from chain bytes).
		isLong: false,
		orderExpiryTimestamp: 1789113600,
		extraOptionData: "0x",
		maxCollateralUsable: "1000000",
	},
};

/**
 * EXAMPLE raw fill amounts, in the same base units a real fill records: 0.01
 * contracts at 6 contract decimals, 0.05 aBasUSDC of premium, no fee, and the
 * collateral the maker posted. They reproduce the tiles the mockup prints.
 */
const EXAMPLE_QUANTITIES: PositionQuantities = {
	contracts: "10000",
	contractDecimals: 6,
	premium: "50000",
	premiumDecimals: 6,
	fees: "0",
	feeDecimals: 6,
	collateral: "780000000",
	collateralDecimals: 6,
};

function ownerOf(position: Domain.Position): Domain.Creator {
	const found = data.allCreators.find((creator) => creator.id === position.userId);
	return found ?? data.currentUser;
}

export function mockPositionDetail(id: string): PositionPageDetail | undefined {
	const position = data.positionById(id);
	if (position === undefined) return undefined;
	// Only a BTC fixture gets the BTC example instrument: attaching it to an ETH
	// or SOL row would print an instrument that contradicts the row's own asset.
	const btc = position.underlyingAsset === "BTC";
	return {
		position,
		owner: ownerOf(position),
		instrument: btc ? positionInstrument(EXAMPLE_SNAPSHOT) : null,
		quantities: btc ? EXAMPLE_QUANTITIES : null,
		thesis:
			position.thesisSlug === null || position.thesisHeadline === null
				? null
				: { slug: position.thesisSlug, headline: position.thesisHeadline },
	};
}
