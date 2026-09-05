import type { Thesis as DomainThesis } from "@/types";
import type { Thesis } from "./display-types";
import { thesisDetails as domainDetails } from "@/mock/data";
import { thesisDetailBySlug } from "./view-data";

/** The view adapter omits confirmation; never infer it from a transaction link. */
export function shareVerification(thesis: Thesis, backing: DomainThesis["backing"]) {
  const verified = thesis.backing !== null && backing?.verification.confirmedOnchain === true;
  return { verified, pnl: verified ? thesis.backing?.creatorLivePnlUsd ?? null : null };
}

export function thesisShareData(slug: string) {
  const detail = thesisDetailBySlug(slug);
  if (!detail) return undefined;
  const source = domainDetails.find(d => d.thesis.slug === slug);
  return { ...detail, ...shareVerification(detail.thesis, source?.thesis.backing ?? null) };
}
