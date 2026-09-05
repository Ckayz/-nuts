/** EXAMPLE DATA ONLY. Content and market tag reuse the existing offline example. */
import type { Thesis } from "../schema";
import { openThesisAiContext } from "./thesis-ai-context.example";

export const textOnlyThesis: Thesis = {
  id: "20000000-0000-4000-8000-000000000003",
  slug: "btc-nfp-2000",
  creatorUserId: "10000000-0000-4000-8000-000000000001",
  headline: openThesisAiContext.thesis.headline,
  rationale: null,
  status: "open",
  taggedAsset: null,
  direction: null,
  underlyingAsset: null,
  expiryAt: null,
  productType: null,
  isCall: null,
  isLong: null,
  strikes: null,
  strikeDecimals: null,
  collateralAddress: null,
  collateralSymbol: null,
  collateralDecimals: null,
  creatorOrderSnapshot: null,
  creatorPositionId: null,
  createdAt: new Date(openThesisAiContext.thesis.createdAt),
  publishedAt: new Date(openThesisAiContext.thesis.createdAt),
  expiredAt: null,
  settledAt: null,
};

export const taggedUnbackedThesis: Thesis = {
  ...textOnlyThesis,
  id: "20000000-0000-4000-8000-000000000004",
  slug: "btc-nfp-20000",
  taggedAsset: openThesisAiContext.market.underlyingAsset,
};
