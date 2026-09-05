import type { Thesis as DomainThesis } from "@/types";
import type { Thesis } from "./display-types";
import { thesisDetails as domainDetails } from "@/mock/data";
import { usingDatabase } from "./data/source";
import { thesisDetailData } from "./page-data";

/** The view adapter omits confirmation; never infer it from a transaction link. */
export function shareVerification(thesis: Thesis, backing: DomainThesis["backing"]) {
	const verified = thesis.backing !== null && backing?.verification.confirmedOnchain === true;
	return { verified, pnl: verified ? (thesis.backing?.creatorLivePnlUsd ?? null) : null };
}

/**
 * Share-card data through the same mode-aware path as the page.
 *
 * Confirmation is only known from the domain fixtures in mock mode; the view
 * layer does not carry it, so in database mode the card never claims
 * "verified" (fail-safe). TODO: expose `confirmedOnchain` on the view so
 * database-backed cards can show the mark.
 */
export async function thesisShareData(slug: string) {
	const detail = await thesisDetailData(slug);
	if (!detail) return undefined;
	const source = usingDatabase() ? undefined : domainDetails.find((d) => d.thesis.slug === slug);
	return { ...detail, ...shareVerification(detail.thesis, source?.thesis.backing ?? null) };
}
