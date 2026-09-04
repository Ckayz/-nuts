/**
 * EXAMPLE DATA ONLY. Values are drawn from docs/mockups/thesis-fun-mockup.html
 * where that mockup supplies them; these objects are not live market data.
 */
import type { ThesisAiContext } from "../ai-context";

export const openThesisAiContext: ThesisAiContext = {
  thesis: { id: "btc-nfp-4a2c", headline: "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.", rationale: "This is the thesis.", direction: "bear", status: "open", createdAt: "2026-09-05T01:42:00.000Z" },
  creator: { walletAddress: "0x7c4a00000000000000000000000000000000e10b", displayName: "merkle_mike" },
  market: { chainId: 8453, underlyingAsset: "BTC", currentSpotPriceUsd: "79607.32", expiryAt: "2026-09-11T08:00:00.000Z", dataAsOf: "2026-09-05T02:00:00.000Z" },
  structure: { productType: "put spread", isCall: false, isLong: true, strikesUsd: ["78000", "74000"], collateralSymbol: "USDC", contracts: "0.0126" },
  economics: { entryPremiumUsd: "1000", entryFeesUsd: null, maximumLossUsd: "1000", maximumPayoutUsd: "4600", breakEvenPricesUsd: ["76120"], estimatedPnlUsd: "612", finalPnlUsd: null, settlementPriceUsd: null },
  verification: { transactionHash: "0x5d000000000000000000000000000000000000000000000000000000000000aa", optionAddress: "0x7800000000000000000000000000000000007400", confirmedOnchain: true },
};

export const expiredThesisAiContext: ThesisAiContext = {
  ...openThesisAiContext,
  thesis: { ...openThesisAiContext.thesis, id: "sol-put-06-sep", headline: "SOL put", rationale: null, status: "expired" },
  creator: { walletAddress: "0x7c4a00000000000000000000000000000000e10b", displayName: "nutsauce" },
  market: { ...openThesisAiContext.market, underlyingAsset: "SOL", currentSpotPriceUsd: "101.46", expiryAt: "2026-09-06T08:00:00.000Z" },
  structure: { productType: "put", isCall: false, isLong: true, strikesUsd: ["100"], collateralSymbol: "USDC", contracts: "0.0031" },
  economics: { entryPremiumUsd: "2.14", entryFeesUsd: null, maximumLossUsd: "250", maximumPayoutUsd: "1153", breakEvenPricesUsd: ["97.86"], estimatedPnlUsd: null, finalPnlUsd: null, settlementPriceUsd: null },
};

export const settledThesisAiContext: ThesisAiContext = {
  ...openThesisAiContext,
  thesis: { ...openThesisAiContext.thesis, id: "eth-2500-friday", headline: "ETH prints 2,500 by Friday close. Funding reset, shorts are crowded.", rationale: null, direction: "bull", status: "settled" },
  creator: { walletAddress: "0x7c4a00000000000000000000000000000000e10b", displayName: "delta_vega" },
  market: { ...openThesisAiContext.market, underlyingAsset: "ETH", currentSpotPriceUsd: "2450.21", expiryAt: "2026-09-04T08:00:00.000Z" },
  structure: { productType: "call spread", isCall: true, isLong: true, strikesUsd: ["2400", "2500"], collateralSymbol: "USDC", contracts: "0.0126" },
  economics: { entryPremiumUsd: null, entryFeesUsd: null, maximumLossUsd: null, maximumPayoutUsd: "1120", breakEvenPricesUsd: [], estimatedPnlUsd: null, finalPnlUsd: null, settlementPriceUsd: "2512.40" },
  verification: { transactionHash: "0x91ab000000000000000000000000000000000000000000000000000000004f2e", optionAddress: "0x2400000000000000000000000000000000002500", confirmedOnchain: true },
};

export const partiallyMissingThesisAiContext: ThesisAiContext = {
  ...openThesisAiContext,
  thesis: { ...openThesisAiContext.thesis, id: "eth-fusaka", headline: "ETH reclaims 2,600 into the Fusaka upgrade. Every dip has been bought for a month.", rationale: null, direction: "bull" },
  creator: { walletAddress: "0x7c4a00000000000000000000000000000000e10b", displayName: "gamma.eth" },
  market: { ...openThesisAiContext.market, underlyingAsset: "ETH", currentSpotPriceUsd: null, expiryAt: "2026-09-25T08:00:00.000Z" },
  structure: { productType: "call spread", isCall: true, isLong: true, strikesUsd: ["2600", "2800"], collateralSymbol: "USDC", contracts: "0.71" },
  economics: { entryPremiumUsd: null, entryFeesUsd: null, maximumLossUsd: null, maximumPayoutUsd: null, breakEvenPricesUsd: [], estimatedPnlUsd: null, finalPnlUsd: null, settlementPriceUsd: null },
  verification: { transactionHash: "0x5d000000000000000000000000000000000000000000000000000000000000aa", optionAddress: null, confirmedOnchain: false },
};

export const thesisAiContextExamples = [openThesisAiContext, expiredThesisAiContext, settledThesisAiContext, partiallyMissingThesisAiContext] as const;
