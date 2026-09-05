import "server-only";

/**
 * The `/m/[asset]` read boundary in database mode: live book, live quote, live
 * session, plus the posts tagged to this market.
 *
 * The mock branch stays in the page itself, so `DATA_SOURCE=mock` still renders
 * the fixtures byte for byte and this module is never imported there.
 */
import { db } from "@nuts/db";
import { env } from "@nuts/env/server";
import { decodeOrderSnapshot } from "@nuts/db/order-snapshot";
import * as display from "@/lib/display";
import type { Market as MarketView, MarketSummary, Thesis as ThesisView } from "@/lib/display-types";
import { getSession } from "@/lib/auth/session";
import { isFeedUnavailable } from "@/lib/thetanuts/orders";
import type { FeedUnavailable } from "@/lib/thetanuts/types";
import { findThesis } from "@/lib/trade/store";
import { quoteView, takerFor } from "@/lib/trade/view";
import { EXPLORER_TX_BASE } from "@/lib/trade/chain";
import type { SideAvailability, TicketSide, TradePanelContext } from "@/lib/trade/types";
import {
	BUDGET_PRESETS,
	DEFAULT_BUDGET_INPUT,
	getMarketPage,
	readClient,
	sideNoteFor,
	ticketFrom,
	type LiveStructure,
} from "./live";
import { quoteStructure, type QuoteResult } from "./quote";
import { structureIdOf } from "./structures";
import { parseTokenAmount } from "./units";

export interface MarketPageData {
	readonly market: MarketView;
	readonly summaries: MarketSummary[];
	readonly tagged: ThesisView[];
	readonly trade: TradePanelContext;
}

export interface MarketPageParams {
	readonly thesisId?: string | null;
	readonly side?: string | null;
	readonly structureId?: string | null;
	readonly budgetInput?: string | null;
}

function asSide(value: string | null | undefined): TicketSide | null {
	return value === "bull" || value === "bear" ? value : null;
}

/**
 * The structure a post names, rebuilt from the order it stored.
 *
 * `deriveMarkets` cannot be used: the stored order's signature deadline is long
 * past and it would drop the row. The identity is computed from the snapshot's
 * own fields instead, which is exactly what `structureId` hashes.
 */
function structureOfThesis(snapshot: unknown): string | null {
	try {
		const order = decodeOrderSnapshot(snapshot as Parameters<typeof decodeOrderSnapshot>[0]);
		const raw = order.rawApiData;
		if (!raw) return null;
		return structureIdOf({
			priceFeed: raw.priceFeed,
			implementationAddress: raw.implementation,
			collateralAddress: raw.collateral,
			isCall: raw.isCall,
			strikes: raw.strikes.map((strike) => BigInt(strike)),
			expiry: order.order.expiry,
		});
	} catch {
		return null;
	}
}

function quoteOne(structure: LiveStructure, side: TicketSide, budgetInput: string): QuoteResult {
	const taker = takerFor(side);
	const order = structure[taker];
	if (order === null) {
		return {
			ok: false,
			code: "NO_ORDER_ON_SIDE",
			reason:
				taker === "sell"
					? "No maker is buying this structure right now, so the Bear side cannot be filled."
					: "No maker is selling this structure right now, so the Bull side cannot be filled.",
		};
	}
	if (structure.collateralDecimals === null) {
		return { ok: false, code: "COLLATERAL_UNKNOWN", reason: "This order's collateral token is unknown to the SDK." };
	}
	let budget: bigint;
	try {
		budget = parseTokenAmount(budgetInput, structure.collateralDecimals);
	} catch (error) {
		return { ok: false, code: "BAD_BUDGET", reason: error instanceof Error ? error.message : "Invalid amount." };
	}
	return quoteStructure({
		client: readClient(),
		market: order,
		side: taker,
		budget,
		referrer: env.THESIS_REFERRER,
	});
}

function availability(quote: QuoteResult, side: TicketSide): SideAvailability {
	return {
		taker: takerFor(side),
		available: quote.ok,
		reason: quote.ok ? null : quote.reason,
	};
}

export async function marketPageData(
	assetSlug: string,
	params: MarketPageParams = {},
): Promise<MarketPageData | FeedUnavailable | null> {
	const session = await getSession();
	const thesis = params.thesisId ? await findThesis(db, params.thesisId) : null;
	const fromThesis =
		thesis !== null && thesis.creatorOrderSnapshot !== null
			? structureOfThesis(thesis.creatorOrderSnapshot)
			: null;

	const page = await getMarketPage(assetSlug, {
		structureId: params.structureId ?? fromThesis ?? undefined,
	});
	if (page === null) return null;
	if (isFeedUnavailable(page)) return page;

	const { structure } = page;
	const budgetInput = params.budgetInput?.trim() || DEFAULT_BUDGET_INPUT;
	const bullQuote = quoteOne(structure, "bull", budgetInput);
	const bearQuote = quoteOne(structure, "bear", budgetInput);
	const requested = asSide(params.side);
	// With no side named, open on the one that can actually be filled.
	const side: TicketSide = requested ?? (bullQuote.ok || !bearQuote.ok ? "bull" : "bear");
	const quote = side === "bull" ? bullQuote : bearQuote;

	const view = quoteView({ structure, side, quote, budgetInput });
	const sideNote = sideNoteFor(structure, takerFor(side), quote);

	const { listFeed } = await import("@/lib/data/reads");
	const feed = await listFeed({ viewerUserId: session?.userId ?? null });
	const tagged = feed
		.map(display.thesis)
		.filter((post) => post.tag !== null && post.tag.asset === structure.asset);

	const trade: TradePanelContext = {
		asset: structure.asset,
		slug: page.market.slug,
		structureId: structure.id,
		structureLabel: page.market.selectedLabel,
		expiryLabel: page.market.selectedExpiryLabel,
		sides: { bull: availability(bullQuote, "bull"), bear: availability(bearQuote, "bear") },
		quote: view,
		presets: [...BUDGET_PRESETS],
		thesis:
			thesis !== null && thesis.status === "open" && thesis.underlyingAsset !== null
				? { id: thesis.id, headline: thesis.headline }
				: null,
		sessionWallet: session?.walletAddress ?? null,
		chainId: 8453,
		explorerTxBase: EXPLORER_TX_BASE,
	};

	return {
		market: { ...page.market, ticket: ticketFrom(structure, quote, sideNote) },
		summaries: page.summaries,
		tagged,
		trade,
	};
}
