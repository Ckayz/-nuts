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
import { amount, creator, expiryLabel, marketSlug, quantity, strikesLabel, tx } from "@/lib/display";
import { decimalFromBaseUnits } from "@/lib/data/decimal";
import { STRIKE_DECIMALS, type PositionInstrument } from "./instrument";
import type { PositionPageDetail } from "./types";
import { USD_DECIMALS, type DerivationInputs, type DerivedRisk, derivedRisk, resolvePnl } from "./pnl";

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

/**
 * TODO-OWNER: `ThesisStatus` display mapping is an open owner item (CLAUDE.md).
 * These reuse the three chip tones the mockup already defines and take their
 * words from the PRD, not from invention: 8.5.3 "settlement pending", 13
 * "confirmed but not indexed: show syncing", 13 "failed transaction: do not
 * publish or count the position".
 */
const STATUS_DISPLAY: Record<Domain.PositionStatus, { label: string; tone: View.ThesisStatus }> = {
	pending: { label: "Pending", tone: "settled" },
	confirmed: { label: "Open · syncing", tone: "live" },
	indexed: { label: "Open", tone: "live" },
	expired: { label: "Settlement pending", tone: "ending" },
	settled: { label: "Settled", tone: "settled" },
	failed: { label: "Failed", tone: "ending" },
};

/** SDK implementation name as product wording, e.g. `PUT_SPREAD` -> `put spread`. */
function productLabel(implementationName: string | null): string | null {
	return implementationName === null ? null : implementationName.toLowerCase().replace(/_/g, " ");
}

function addressFragment(value: string): string {
	if (value === "") return "—";
	return value.length > 11 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function dateLabel(iso: string): string {
	const date = new Date(iso);
	const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
	return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** A plain decimal, or null. Every recorded column passes through this before it is printed. */
function decimalOrNull(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/** Decimal string -> scaled BigInt pair, for exact ratio arithmetic. */
function scaled(value: string): { units: bigint; scale: bigint } {
	const negative = value.startsWith("-");
	const [integer = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
	const units = BigInt(integer + fraction);
	return { units: negative ? -units : units, scale: 10n ** BigInt(fraction.length) };
}

/**
 * `numerator / denominator` as a signed percentage with one decimal place,
 * rounded half-up in integer arithmetic. Null when the denominator is zero or
 * either side is not a plain decimal — a percentage of nothing is not zero.
 */
export function percentLabel(numerator: string, denominator: string): string | null {
	const top = scaled(numerator);
	const bottom = scaled(denominator);
	if (bottom.units === 0n) return null;
	// (top/topScale) / (bottom/bottomScale) * 100, carried to one decimal:
	//   1000 * top.units * bottom.scale / (bottom.units * top.scale)
	const numeratorUnits = 1000n * top.units * bottom.scale;
	const denominatorUnits = bottom.units * top.scale;
	if (denominatorUnits === 0n) return null;
	const negative = numeratorUnits < 0n !== denominatorUnits < 0n;
	const absoluteTop = numeratorUnits < 0n ? -numeratorUnits : numeratorUnits;
	const absoluteBottom = denominatorUnits < 0n ? -denominatorUnits : denominatorUnits;
	// Round half-up on the magnitude, then reapply the sign.
	const tenths = (absoluteTop * 2n + absoluteBottom) / (absoluteBottom * 2n);
	const whole = tenths / 10n;
	const decimal = tenths % 10n;
	const sign = tenths === 0n ? "" : negative ? "−" : "+";
	return `${sign}${whole}.${decimal}%`;
}

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

function instrumentLabel(instrument: PositionInstrument | null, asset: string): string {
	if (instrument === null) return asset === "" ? "Position" : asset;
	const strikes = strikesLabel(
		instrument.strikesUsd8.map((strike) => decimalFromBaseUnits(strike, STRIKE_DECIMALS)),
		instrument.isCall,
	);
	const ticker = instrument.asset ?? (asset === "" ? null : asset);
	const product = productLabel(instrument.implementationName);
	return [ticker, product, strikes, expiryLabel(instrument.expiryAt)]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

export function positionPage(input: PositionViewInput): View.PositionPage {
	const { detail, collateralUsdPrice8, spotUsd8, asOf } = input;
	const { position, instrument, quantities } = detail;
	const economics = position.economics;

	const derivation = derivationFor(detail, collateralUsdPrice8);
	const derived: DerivedRisk | null =
		derivation.inputs === null ? null : derivedRisk(derivation.inputs);

	const pnl = resolvePnl({
		status: position.status,
		finalPnlUsd: economics.finalPnlUsd,
		estimatedPnlUsd: economics.estimatedPnlUsd,
		settlementPriceUsd: economics.settlementPriceUsd,
		derivation: derivation.inputs,
		spotUsd8,
		// When a derivation WAS possible but produced nothing, the raw amounts
		// failed the risk model's own parameter checks. Say that, rather than an
		// "unavailable" that reads like a missing feature.
		unavailableReason:
			derivation.inputs === null
				? derivation.reason
				: "No P&L: the recorded fill amounts do not satisfy the risk model's own checks, so any figure would be a guess.",
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

	const status = STATUS_DISPLAY[position.status];
	const settled = position.status === "settled";
	const asset = instrument?.asset ?? (position.underlyingAsset === "" ? null : position.underlyingAsset);

	const card: View.PnlCard = {
		id: position.id,
		owner: creator(detail.owner),
		statusLabel: status.label,
		statusTone: status.tone,
		dateLabel: dateLabel(position.createdAt),
		instrumentLabel: instrumentLabel(instrument, position.underlyingAsset),
		asset,
		side: position.side === "back" ? "bull" : "bear",
		sideLabel: position.side === "back" ? "Bull" : "Bear",
		pnl: amount(pnl.pnlUsd),
		pnlLabel: settled ? "Result" : "Live P&L",
		// TODO-OWNER: the denominator. Max loss is the money genuinely at stake, and
		// for a bought option it equals the premium paid, so the two coincide on the
		// common case. The tile it refers to is named in the label so the reader is
		// never left guessing which number it is a percentage of.
		pnlPctLabel:
			pnl.pnlUsd === null || maxLossUsd === null
				? null
				: (() => {
						const percent = percentLabel(pnl.pnlUsd, maxLossUsd);
						return percent === null ? null : `${percent} of max loss`;
					})(),
		pnlBasisLabel: pnl.detail,
		basis: pnl.basis,
		stats: [
			{ label: entryLabel, value: amount(entryUsd).usd2 },
			{ label: "Max loss", value: amount(maxLossUsd).usd2 },
			{ label: "Max payout", value: amount(maxPayoutUsd).usd2 },
		],
		tx: tx(position.verification.transactionHash, position.mockTransactionFragment),
		// PRD 7.3: the badge is shown only after a verified Base mainnet receipt.
		verified: position.verification.confirmedOnchain,
	};

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
