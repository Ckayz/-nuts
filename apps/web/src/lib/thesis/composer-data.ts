/**
 * Everything `/new` needs, resolved on the server: the tag pills, the two URL
 * parameters after validation, and any trade card the `?link=` parameter
 * resolves to.
 *
 * Owner reference 2026-09-05 (fomo's post-trade share sheet): after placing a
 * trade the user copies its link and writes a post about it. `?link=/p/<uuid>`
 * is that hand-off, so the card is already in the preview when the composer
 * opens.
 *
 * Both parameters are validated with the same rules the rest of the app uses,
 * never trusted: `?link=` must pass `extractTradeLinks`, so anything else — a
 * foreign host, a `javascript:` URL, junk — is dropped and the composer simply
 * opens empty. `?asset=` must be a ticker shape and is uppercased.
 */
import { creatorInitials } from "../data/identity";
import { siteOrigins } from "../site-origin";
import { marketSummariesData } from "../market/summaries";
import type { PnlCard } from "../display-types";
import { usingDatabase } from "../data/source";
import { extractTradeLinks, tradeLinkHref } from "./links";

/** One tag pill: the ticker for the monogram and the market's name beside it,
 *  which is how the mockup writes them ("BTC Bitcoin"). */
export interface AssetTag {
	asset: string;
	name: string;
}

export interface ComposerData {
	assets: AssetTag[];
	marketsUnavailable: boolean;
	siteOrigin: string[];
	presetAsset: string | null;
	presetRationale: string;
	previewCards: PnlCard[];
	signedIn: boolean;
	viewerSeed?: string;
	viewerInitials?: string;
	databaseMode: boolean;
}

/** The first value of a repeated query parameter, or null. */
function single(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

/** Same format rule as `lib/thesis/publish.ts`; no hardcoded asset list. */
function presetAsset(value: string | null): string | null {
	if (value === null) return null;
	const upper = value.trim().toUpperCase();
	return /^[A-Z0-9]+$/.test(upper) ? upper : null;
}

export async function composerData(
	searchParams: { [key: string]: string | string[] | undefined },
): Promise<ComposerData> {
	const databaseMode = usingDatabase();
	const origin = await siteOrigins();
	const { markets: marketSummaries, unavailable: marketsUnavailable } = await marketSummariesData();
	const requestedAsset = presetAsset(single(searchParams.asset));
	const asset = databaseMode && !marketSummaries.some(market => market.asset === requestedAsset) ? null : requestedAsset;
	const assets: AssetTag[] = marketSummaries.map((market) => ({ asset: market.asset, name: market.name }));
	// Mock presets retain their fixture behavior. Db pills contain only the live set.
	if (asset !== null && !assets.some((tag) => tag.asset === asset)) assets.unshift({ asset, name: asset });

	// The ONE card builder (round-1 fold item 9). Imported here rather than at the
	// top of the module because it reaches `@nuts/thetanuts` for the risk model,
	// and only this branch of `/new` needs it.
	const { linkedPositionCard } = await import("../position/view");

	const link = single(searchParams.link);
	// `?link=` is validated by the SAME grammar the post text is read with, so a
	// link the composer accepts is exactly a link that will unfurl.
	const [linkedId] = link === null ? [] : extractTradeLinks(link, origin);
	const presetRationale = linkedId === undefined ? "" : tradeLinkHref(linkedId);

	if (!databaseMode) {
		const mock = await import("@/mock/data");
		const found = mock.mockLinkedPositions.filter((entry) => entry.position.id === linkedId);
		return {
			assets, marketsUnavailable, siteOrigin: origin,
			presetAsset: asset,
			presetRationale,
			previewCards: found.map((entry) => linkedPositionCard(entry)),
			signedIn: false,
			databaseMode,
		};
	}

	const { getSession } = await import("../auth/session");
	const session = await getSession();
	const { listPositionsByIds } = await import("../data/reads");
	const entry = linkedId === undefined ? undefined : (await listPositionsByIds([linkedId])).get(linkedId);
	return {
		assets, marketsUnavailable, siteOrigin: origin,
		presetAsset: asset,
		presetRationale,
		previewCards: entry === undefined ? [] : [linkedPositionCard(entry)],
		signedIn: session !== null,
		// This data path has the session address, not the user row.
		viewerSeed: session?.walletAddress.toLowerCase(),
		viewerInitials: session ? creatorInitials(null, session.walletAddress) : "?",
		databaseMode,
	};
}
