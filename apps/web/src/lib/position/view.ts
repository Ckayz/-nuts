/**
 * One position -> the P&L card and the rest of `/p/[id]`.
 *
 * Pure. Every money value it prints is either a column the fill recorded or a
 * number `lib/position/pnl.ts` computed from raw base units; nothing is
 * interpolated and nothing falls back to a constant. A value that cannot be
 * justified renders "—" and the card says why in one sentence.
 *
 * TODO-OWNER: the mockup has no standalone position page, so none of the wording
 * here is approved copy — the status words, the tile labels, the percent's
 * denominator and the basis sentence are all descriptive placeholders. The
 * layout follows the owner's reference (fomo's post-trade share card, 2026-09-05):
 * owner + status + date, instrument, one big signed figure with the percent in
 * brackets, three tiles. fomo's price line is deliberately absent: Thetanuts
 * publishes a spot price and no history, and the owner removed the charts.
 */
import type * as Domain from "@/types";
import type * as View from "@/lib/display-types";
import { amount, dateLabel, expiryLabel, marketSlug, percentLabel, pnlCard, quantity, strikeSide, strikesLabel, tx } from "@/lib/display";
import { decimalFromBaseUnits } from "@/lib/data/decimal";
import { STRIKE_DECIMALS, type PositionInstrument } from "./instrument";
import type { PositionPageDetail } from "./types";
import {
	USD_DECIMALS,
	type DerivationInputs,
	type DerivedRisk,
	derivedRisk,
	derivePnlAtSpot,
	lifecycleStatus,
	resolvePnl,
} from "./pnl";

export interface PositionViewInput {
	readonly detail: PositionPageDetail;
	/** Current spot for this underlying, 8-decimal integer string; null when the book is unreadable. */
	readonly spotUsd8: string | null;
	/**
	 * USD price of ONE unit of this position's collateral token, 8-decimal integer
	 * string, or null when no source can justify one. `lib/thetanuts/orders.ts`
	 * prices only the two USD-pegged tokens and refuses everything else; this file
	 * refuses the same way rather than valuing a token at zero by omission.
	 */
	readonly collateralUsdPrice8: string | null;
	/** Snapshot instant the "trade the same structure" expiry check is measured from. */
	readonly asOf: Date;
}

/** SDK implementation name as product wording, e.g. `PUT_SPREAD` -> `put spread`. */
function productLabel(implementationName: string | null): string | null {
	return implementationName === null ? null : implementationName.toLowerCase().replace(/_/g, " ");
}

function addressFragment(value: string): string {
	if (value === "") return "—";
	return value.length > 11 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** A plain decimal, or null. Every recorded column passes through this before it is printed. */
function decimalOrNull(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/** Re-exported: the one implementation lives in `lib/display.ts` with the card
 *  builder that uses it, so the percent under every card rounds identically. */
export { percentLabel };

/**
 * Everything the risk model needs, or null with the reason it cannot be built.
 * Each `null` branch names the missing piece, because "unavailable" without a
 * reason is indistinguishable from a bug.
 */
export function derivationFor(
	detail: PositionPageDetail,
	collateralUsdPrice8: string | null,
): { inputs: DerivationInputs } | { inputs: null; reason: string } {
	const instrument = detail.instrument;
	if (instrument === null) {
		return {
			inputs: null,
			reason:
				"No P&L: this fill's stored order does not describe its instrument, so there is nothing to value.",
		};
	}
	if (instrument.riskKind === null) {
		const product = productLabel(instrument.implementationName) ?? "this structure";
		return {
			inputs: null,
			reason: `No P&L: ${product} has no payoff model in the deterministic risk code, so any figure would be a guess.`,
		};
	}
	if (collateralUsdPrice8 === null) {
		return {
			inputs: null,
			reason: `No P&L: ${instrument.collateralSymbol ?? "this collateral token"} has no USD price this code can justify, so the premium cannot be valued.`,
		};
	}
	const quantities = detail.quantities;
	if (quantities === null) {
		return {
			inputs: null,
			reason: "No P&L: this record carries no fill amounts, so no payoff can be recomputed.",
		};
	}
	return {
		inputs: {
			riskKind: instrument.riskKind,
			takerSide: instrument.takerSide,
			ascendingStrikesUsd8: instrument.ascendingStrikesUsd8,
			contracts: quantities.contracts,
			contractDecimals: quantities.contractDecimals,
			premiumBaseUnits: quantities.premium,
			premiumDecimals: quantities.premiumDecimals,
			feeBaseUnits: quantities.fees,
			feeDecimals: quantities.feeDecimals,
			collateralUsdPrice8,
		},
	};
}

/** Collateral-token base units valued in USD, exactly, or null without a price. */
function tokenUsd(
	baseUnits: string,
	decimals: number,
	collateralUsdPrice8: string | null,
): string | null {
	if (collateralUsdPrice8 === null) return null;
	if (!/^\d+$/.test(baseUnits) || !/^\d+$/.test(collateralUsdPrice8)) return null;
	if (!Number.isInteger(decimals) || decimals < 0) return null;
	// value = baseUnits / 10^decimals * price8 / 10^8, kept in integer arithmetic
	// and expressed at 8 decimals, the scale every other USD figure here uses.
	const units = (BigInt(baseUnits) * BigInt(collateralUsdPrice8)) / 10n ** BigInt(decimals);
	return decimalFromBaseUnits(units.toString(), USD_DECIMALS);
}

/**
 * The card's three instrument slots, as the mockup splits them
 * (docs/mockups/thesis-fun-mockup.html): a title ("BTC put spread"), the strikes
 * on their own sub-line ("78,000 / 74,000 P") and the expiry in the top-right
 * chip. A record that names none of it still gets an honest title.
 */
function instrumentParts(
	instrument: PositionInstrument | null,
	asset: string,
): { title: string; strikes: string | null; expiry: string | null; expiryFull: string | null } {
	if (instrument === null) {
		return { title: asset === "" ? "Position" : asset, strikes: null, expiry: null, expiryFull: null };
	}
	const product = productLabel(instrument.implementationName);
	const ticker = instrument.asset ?? (asset === "" ? null : asset);
	return {
		title: [ticker, product].filter((part): part is string => part !== null).join(" ") || "Position",
		strikes: strikesLabel(
			instrument.strikesUsd8.map((strike) => decimalFromBaseUnits(strike, STRIKE_DECIMALS)),
			strikeSide(product, instrument.isCall),
		),
		expiry: expiryLabel(instrument.expiryAt),
		expiryFull: expiryLabel(instrument.expiryAt, true),
	};
}

export function positionPage(input: PositionViewInput): View.PositionPage {
	const { detail, collateralUsdPrice8, spotUsd8, asOf } = input;
	const { position, instrument, quantities } = detail;
	const economics = position.economics;

	const derivation = derivationFor(detail, collateralUsdPrice8);
	const derived: DerivedRisk | null =
		derivation.inputs === null ? null : derivedRisk(derivation.inputs);

	/**
	 * D5. ONE expiry for this position, whichever surface asks.
	 *
	 * The page decodes the instrument from the order snapshot; a list row reads
	 * `position.expiryAt`, decoded from the SAME snapshot by the same reader in
	 * `map.ts`. Reading only the instrument here meant a card built without one
	 * (the feed's linked card before its batch reader lands a snapshot, a fixture
	 * row) fell back to the stored status while the row beside it did not — the
	 * exact disagreement D5 is about, inverted.
	 */
	const expiryAt = instrument?.expiryAt ?? position.expiryAt ?? null;

	const pnl = resolvePnl({
		status: position.status,
		// C#9: a `fill_quantity_unproven` row is a fill that IS on chain, not a
		// reverted transaction.
		failureReason: position.failureReason,
		finalPnlUsd: economics.finalPnlUsd,
		estimatedPnlUsd: economics.estimatedPnlUsd,
		settlementPriceUsd: economics.settlementPriceUsd,
		// The RULES module is SDK-free (see `lifecycle.ts`), so the risk model runs
		// HERE and only its answer crosses over.
		derivable: derivation.inputs !== null,
		derivedPnlUsd:
			derivation.inputs === null || spotUsd8 === null ? null : derivePnlAtSpot(derivation.inputs, spotUsd8),
		spotUsd8,
		// When a derivation WAS possible but produced nothing, the raw amounts
		// failed the risk model's own parameter checks. Say that, rather than an
		// "unavailable" that reads like a missing feature.
		unavailableReason:
			derivation.inputs === null
				? derivation.reason
				: "No P&L: the recorded fill amounts do not satisfy the risk model's own checks, so any figure would be a guess.",
		// C7: an expired option is finished, so no live estimate and no spot
		// derivation may be shown for it.
		expiryAt,
		asOf: asOf.toISOString(),
	});

	// Recorded first, derived second: a figure the fill wrote down beats one this
	// process computed, and the derived one is only ever a stand-in for a column
	// the indexer has not filled.
	const maxLossUsd = decimalOrNull(economics.maximumLossUsd) ?? derived?.maxLossUsd ?? null;
	const maxPayoutUsd = decimalOrNull(economics.maximumPayoutUsd) ?? derived?.maxPayoutUsd ?? null;
	const breakEvenUsd =
		decimalOrNull(economics.breakEvenPricesUsd[0] ?? null) ?? derived?.breakEvenUsd ?? null;

	// The money that went in. A taker who buys pays a premium; a taker who sells
	// locks collateral, and no USD column records that, so it is valued from the
	// collateral base units the fill stored.
	const sells = instrument?.takerSide === "sell";
	const entryUsd = sells
		? quantities === null
			? null
			: tokenUsd(quantities.collateral, quantities.collateralDecimals, collateralUsdPrice8)
		: (decimalOrNull(economics.entryPremiumUsd) ??
			(quantities === null
				? null
				: tokenUsd(quantities.premium, quantities.premiumDecimals, collateralUsdPrice8)));
	const entryLabel = sells ? "Collateral locked" : "Premium paid";

	const asset = instrument?.asset ?? (position.underlyingAsset === "" ? null : position.underlyingAsset);
	const parts = instrumentParts(instrument, position.underlyingAsset);

	const card = pnlCard({
		id: position.id,
		owner: detail.owner,
		// C7-r2: an option whose expiry has passed is "Settlement pending", not
		// "Open · syncing", in the compact card as well as on this page. The
		// stored status never reaches `indexed`->`expired` on its own because no
		// reconciliation exists yet.
		status: lifecycleStatus(position.status, expiryAt, asOf.toISOString()),
		// C#9: the chip reads the reason too, so a fill that is on chain is never
		// styled as a revert.
		failureReason: position.failureReason,
		createdAt: position.createdAt,
		instrumentLabel: parts.title,
		asset,
		strikesLabel: parts.strikes,
		expiryLabel: parts.expiry,
		expiryFullLabel: parts.expiryFull,
		side: position.side,
		pnl: { usd: pnl.pnlUsd, detail: pnl.detail, basis: pnl.basis },
		entryLabel,
		entryUsd,
		maxLossUsd,
		maxPayoutUsd,
		tx: tx(position.verification.transactionHash, position.mockTransactionFragment),
		// PRD 7.3: the badge is shown only after a verified Base mainnet receipt.
		verified: position.verification.confirmedOnchain,
	});

	const facts: { label: string; value: string }[] = [
		{ label: "Break-even", value: breakEvenUsd === null ? "—" : amount(breakEvenUsd).usd2 },
		{ label: "Contracts", value: quantity(position.contracts) ?? "—" },
		{ label: "Entry fees", value: amount(decimalOrNull(economics.entryFeesUsd)).usd2 },
		{
			label: "Expiry",
			value: instrument === null ? "—" : expiryLabel(instrument.expiryAt, true),
		},
		{ label: "Collateral", value: instrument?.collateralSymbol ?? "—" },
		{
			// The taker's own side of the fill, which is what decides whether the
			// loss is bounded by a premium or by posted collateral.
			label: "Direction",
			value:
				instrument === null
					? "—"
					: instrument.takerSide === "buy"
						? "Long the structure (bought)"
						: "Short the structure (sold)",
		},
		{ label: "Wallet", value: addressFragment(position.walletAddress) },
		{ label: "Chain", value: "Base · 8453" },
	];
	if (economics.settlementPriceUsd !== null) {
		facts.push({
			label: "Settlement price",
			value: amount(decimalOrNull(economics.settlementPriceUsd)).usd2,
		});
	}

	return {
		card,
		ownerHandle: detail.owner.handle,
		thesis: detail.thesis,
		marketSlug: asset === null ? null : marketSlug(asset),
		// Only while the option is still live: the market page lists what the book
		// has open now, and a link to an expired structure would select nothing.
		structureId:
			instrument !== null && Date.parse(instrument.expiryAt) > asOf.getTime()
				? instrument.structureId
				: null,
		facts,
	};
}

/**
 * Just the card, for anything that renders it outside `/p/[id]` — the post-fill
 * dialog (`components/market/fill-dialog.tsx`) and the trade-card unfurl. One
 * builder, so a card in a dialog and the card on its own page cannot disagree
 * about the same fill.
 */
export function pnlCardFor(input: PositionViewInput): View.PnlCard {
	return positionPage(input).card;
}

/**
 * The card for a position a post's text LINKS to (owner 2026-09-05: "trade is
 * just trade" — the linked position need not be the author's).
 *
 * The feed reads no order snapshot and no raw fill amounts, so there is no
 * instrument to price and no risk model to run: `instrument` and `quantities`
 * are null, which routes `resolvePnl` down its recorded-value branches (PRD 14:
 * a settled row shows its recorded result or nothing; an open one shows the
 * recorded estimate or nothing). Every field the feed cannot know renders "—".
 */
export function linkedPositionCard(
	value: Domain.LinkedPosition,
	asOf: Date = new Date(),
	collateralUsdPrice8: string | null = null,
): View.PnlCard {
	// C8. The instrument and the raw amounts are decoded by the batch reader
	// through the SAME mapper `/p/[id]` uses, so the card and the position page
	// cannot disagree about the side, the asset or the entry amount. They were
	// hardcoded null here, which routed a SELLER's fill down the buyer branch:
	// "Premium paid" printed next to the premium the seller RECEIVED, and the
	// asset came from the post's tag rather than the order.
	return pnlCardFor({
		detail: {
			position: value.position,
			owner: value.owner,
			instrument: value.instrument ?? null,
			quantities: value.quantities ?? null,
			thesis: null,
		},
		// Still null: the feed reads no live spot, so nothing is derived here.
		spotUsd8: null,
		collateralUsdPrice8,
		asOf,
	});
}

/**
 * The card for the creator's OWN fill under a post.
 *
 * A post carries its backing as economics plus the structure it names, not as a
 * `Domain.Position` row, so this shapes those columns into one and hands it to
 * the same builder — the post's card and that position's own page then cannot
 * state different numbers about the same fill. What the post DOES know and a
 * bare linked position does not is the structure, so the strikes and the expiry
 * are filled in here.
 *
 * Null when the post is not backed. `Domain.Thesis.status` is a POST lifecycle,
 * not a fill's, and a backing carries no status column of its own, so the post's
 * is the only lifecycle there is: a settled post's fill reads "Settled", an open
 * post's reads "Open". Whether the receipt was verified is a SEPARATE fact and
 * stays where PRD 7.3 puts it — `verified`, which drives the share card's
 * "Base · not confirmed yet" footer. Mapping an unconfirmed receipt to "Pending"
 * here would hide the recorded P&L of every fixture and every un-reindexed fill.
 */
export function backingCard(value: Domain.Thesis, asOf: Date = new Date()): View.PnlCard | null {
	const back = value.backing;
	if (back === null) return null;
	const settled = value.thesis.status === "settled";
	const status: Domain.PositionStatus = settled ? "settled" : "indexed";
	const asset = value.market?.underlyingAsset ?? null;
	const structure = value.structure;
	const expiryAt = value.market?.expiryAt ?? null;
	const economics = back.economics;
	return pnlCard({
		id: back.creatorPositionId,
		owner: value.creator,
		status,
		createdAt: value.thesis.createdAt,
		instrumentLabel:
			[asset, structure?.productType ?? null].filter((part): part is string => part !== null).join(" ") ||
			"Position",
		asset,
		strikesLabel:
			structure === null
				? null
				: strikesLabel(structure.strikesUsd, strikeSide(structure.productType, structure.isCall)),
		expiryLabel: expiryAt === null ? null : expiryLabel(expiryAt),
		expiryFullLabel: expiryAt === null ? null : expiryLabel(expiryAt, true),
		// The creator backs their own thesis, so their fill is the "back" side.
		side: "back",
		pnl: (() => {
			const resolved = resolvePnl({
				status,
				finalPnlUsd: economics.finalPnlUsd,
				estimatedPnlUsd: economics.estimatedPnlUsd,
				settlementPriceUsd: economics.settlementPriceUsd,
				derivable: false,
				derivedPnlUsd: null,
				spotUsd8: null,
				unavailableReason:
					"No P&L: this post records no fill amounts for the creator's position, so nothing can be valued.",
				// C7: the post's own market expiry, when it names one.
				expiryAt,
				asOf: asOf.toISOString(),
			});
			return { usd: resolved.pnlUsd, detail: resolved.detail, basis: resolved.basis };
		})(),
		/**
		 * C8-r2 (lane C confirming pass, residual) — STOPPED, deliberately
		 * unchanged, reported instead of guessed.
		 *
		 * The reviewer asks for "the same taker-side mapper as C8" here. The only
		 * candidate input is `theses.is_long`, and its meaning is not written down
		 * anywhere: `packages/db/src/ai-context.ts` passes it straight through the
		 * FROZEN PRD 10.3 contract without defining it, PRD line 470 uses `isLong`
		 * in the MAKER-order sense, and NOTHING in production writes the column —
		 * `publishPost` leaves the whole structure block null and the market
		 * ticket never creates a post, so this branch is reachable only by mock
		 * fixtures and by rows written before migration 0007. Deriving a taker
		 * side from an undefined column is exactly the mistake that inverted the
		 * taker side once already (CLAUDE.md, core round 9), and the invariant
		 * `trade-card.test.ts` pins — that this card and the same fill's linked
		 * card agree — would break either way.
		 *
		 * TODO-OWNER: what `theses.is_long` means, and whether this label should
		 * name the column ("Entry premium") instead of asserting a side.
		 */
		entryLabel: "Premium paid",
		entryUsd: decimalOrNull(economics.entryPremiumUsd),
		maxLossUsd: decimalOrNull(economics.maximumLossUsd),
		maxPayoutUsd: decimalOrNull(economics.maximumPayoutUsd),
		tx: tx(back.verification.transactionHash, back.mock.transactionFragment),
		verified: back.verification.confirmedOnchain,
	});
}

/**
 * Attach the cards a rendered post shows: the creator's backing fill and every
 * position the text links.
 *
 * ONE card per object: when the post's text links the position that ALSO backs
 * it, the two cards are the same fill and only one is rendered (round-1 fold
 * item 8) — the backing card, because it is the one that carries the structure.
 */
export function withCards(view: View.Thesis, domain: Domain.Thesis, asOf: Date = new Date()): View.Thesis {
	const backing = backingCard(domain, asOf);
	const linked = (domain.linkedPositions ?? [])
		.filter((entry) => entry.position.id !== domain.backing?.creatorPositionId)
		.map((entry) => linkedPositionCard(entry, asOf));
	return { ...view, backingCard: backing, tradeCards: linked };
}
