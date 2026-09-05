// Base mainnet chainId 8453 is pinned by docs/PRD.md §10.3 (not a mockup number).
// EXAMPLE DATA: financial values and copy transcribed from docs/mockups/thesis-fun-mockup.html.
// IDs prefixed mock-, non-BTC slugs and the wh handle are fixture identifiers, not DB IDs.
// No full wallet/transaction/option addresses are supplied. Empty required wallet strings
// are incomplete fixtures; fragments are presentation evidence only. Never validate these as onchain contexts.
// ISO dataAsOf/createdAt are reconstructed solely to reproduce mockup relative labels.
// Non-BTC expiry times reuse the mockup's 08:00 UTC; position timestamps/lifecycle are illustrative.
// Null provenance: rationale has no copy in the mockup; settledAgoMinutes/settledWinner
// are null before settlement; soldStructure and activity side are not applicable to those rows.
// Missing creator identity/statistics (displayName, mockWalletFragment, sinceLabel, winRatePct,
// thesesCount, followers, netPnlUsd, verifiedPnl30dUsd, biggestLossUsd),
// contracts, collateralSymbol, pooledUsd, currentSpotPriceUsd, entrySpotPriceUsd and economics
// remain null where the mockup supplies no value. This includes entryPremiumUsd, entryFeesUsd,
// maximumPayoutUsd, estimatedPnlUsd, finalPnlUsd and settlementPriceUsd; never substitute zero.
// Missing maxPayoutMultiple, premiumPerContractUsd, payoutPerContractUsd, transactionFragment,
// mockTransactionFragment, transactionHash and optionAddress likewise remain null.
// TODO-OWNER: endingSoon flags reproduce chips, not an approved time window.
// TODO-OWNER: fixture directions follow headlines; only BTC direction is explicitly owner-specified.
// TODO-OWNER: preset amounts reproduce the mockup, not approved product defaults.
// Ranking, trending, connected-user identity stay TODO-OWNER.
// Round 6: a thesis is a post (CLAUDE.md, owner 2026-09-05). Three states are
// fixtured: text only (nfpSetup: no market, no structure, no backing), tagged
// (ethCallsCheap: market + structure, no backing) and backed (the rest). The
// unbacked posts' headline, rationale and counts are example data in the shape
// the mockup's discover feed shows; likedByViewer is illustrative.
import type { Comment, Creator, Thesis, Position, ThesisDetail, TrendingItem, Market } from "@/types";
export const merkleMike: Creator = {
    "handle": "merkle_mike",
    "displayName": "merkle_mike",
    "initials": "MK",
    "id": "mock-user-merkle_mike",
    "walletAddress": "",
    "mockWalletFragment": "0x7c44…5dEd",
    "sinceLabel": "since Jun 26",
    "winRatePct": 71,
    "thesesCount": 24,
    "followers": 1204,
    "netPnlUsd": "18240",
    "verifiedPnl30dUsd": "18240",
    "biggestLossUsd": "-2000"
};
export const nutsauce: Creator = {
    "handle": "nutsauce",
    "displayName": "nutsauce",
    "initials": "NS",
    "id": "mock-user-nutsauce",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 64,
    "thesesCount": 31,
    "followers": null,
    "netPnlUsd": "11905",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const gammaEth: Creator = {
    "handle": "gamma.eth",
    "displayName": "gamma.eth",
    "initials": "GA",
    "id": "mock-user-gamma.eth",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 58,
    "thesesCount": 12,
    "followers": null,
    "netPnlUsd": "7310",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const deltaVega: Creator = {
    "handle": "delta_vega",
    "displayName": "delta_vega",
    "initials": "DV",
    "id": "mock-user-delta_vega",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 55,
    "thesesCount": 40,
    "followers": null,
    "netPnlUsd": "4082",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const jlin: Creator = {
    "handle": "jlin",
    "displayName": "jlin",
    "initials": "JL",
    "id": "mock-user-jlin",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 60,
    "thesesCount": 9,
    "followers": null,
    "netPnlUsd": "2915",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const oxsable: Creator = {
    "handle": "0xsable",
    "displayName": "0xsable",
    "initials": "0X",
    "id": "mock-user-0xsable",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 52,
    "thesesCount": 17,
    "followers": null,
    "netPnlUsd": "1740",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const tailbet: Creator = {
    "handle": "tailbet",
    "displayName": "tailbet",
    "initials": "TB",
    "id": "mock-user-tailbet",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 50,
    "thesesCount": 6,
    "followers": null,
    "netPnlUsd": "1212",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const rektHedger: Creator = {
    "handle": "rekt_hedger",
    "displayName": "rekt_hedger",
    "initials": "RH",
    "id": "mock-user-rekt_hedger",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": 49,
    "thesesCount": 19,
    "followers": null,
    "netPnlUsd": "-1140",
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const currentUser: Creator = {
    "handle": "wh",
    "displayName": null,
    "initials": "WH",
    "id": "mock-user-wh",
    "walletAddress": "",
    "mockWalletFragment": null,
    "sinceLabel": null,
    "winRatePct": null,
    "thesesCount": null,
    "followers": null,
    "netPnlUsd": null,
    "verifiedPnl30dUsd": null,
    "biggestLossUsd": null
};
export const allCreators = [merkleMike, nutsauce, gammaEth, deltaVega, jlin, oxsable, tailbet, rektHedger, currentUser];
export const leaderboard = allCreators.slice(0, -1);
export const topCreators = leaderboard;
export const CURRENT_USER_HANDLE = currentUser.handle;
export const btcNfp: Thesis = {
    "id": "btc-nfp-4a2c",
    "slug": "btc-nfp-4a2c",
    "creatorUserId": "mock-user-merkle_mike",
    "creator": merkleMike,
    "thesis": {
        "id": "btc-nfp-4a2c",
        "headline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
        "rationale": "Skew is already paying for the downside wing. I want defined risk into Monday. If we open above 80.5k I'm wrong, and it stays on the chain.",
        "direction": "bear",
        "status": "open",
        "createdAt": "2026-09-04T17:42:00Z"
    },
    "dataAsOf": "2026-09-04T18:00:00Z",
    "market": {
        "chainId": 8453,
        "underlyingAsset": "BTC",
        "currentSpotPriceUsd": "79607",
        "expiryAt": "2026-09-11T08:00:00Z"
    },
    "structure": {
        "productType": "put spread",
        "isCall": false,
        "isLong": true,
        "strikesUsd": [
            "78000",
            "74000"
        ],
        "contracts": "0.0126",
        "collateralSymbol": "USDC",
        "legs": [
            {
                "strikeUsd": "78000",
                "isCall": false,
                "isLong": true
            },
            {
                "strikeUsd": "74000",
                "isCall": false,
                "isLong": false
            }
        ]
    },
    "backing": {
        "creatorPositionId": "mock-creator-position-btc-nfp-4a2c",
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "1000",
            "maximumPayoutUsd": "4612",
            "breakEvenPricesUsd": [
                "77287"
            ],
            "estimatedPnlUsd": "612",
            "finalPnlUsd": null,
            "settlementPriceUsd": null
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "pooledUsd": "9420",
        "bull": {
            "pct": 78,
            "count": 31,
            "amountUsd": "7920",
            "signed": false
        },
        "bear": {
            "pct": 22,
            "count": 9,
            "amountUsd": "1500",
            "signed": false
        },
        "mock": {
            "settledAgoMinutes": null,
            "settledWinner": null,
            "maxPayoutMultiple": "4.6",
            "premiumPerContractUsd": null,
            "payoutPerContractUsd": null,
            "transactionFragment": null
        }
    },
    "endingSoon": false,
    "likes": 142,
    "likedByViewer": true,
    "commentCount": 17
};
/** Text-only post: no market, no structure, no fill. */
export const nfpSetup: Thesis = {
    "id": "nfp-nobody-is-pricing",
    "slug": "nfp-nobody-is-pricing",
    "creatorUserId": "mock-user-tailbet",
    "creator": tailbet,
    "thesis": {
        "id": "nfp-nobody-is-pricing",
        "headline": "Nobody is pricing a hot NFP into the weekend. The whole board is short vol.",
        "rationale": "No position on this one yet. Just saying the setup out loud so it's on the record.",
        "direction": "bear",
        "status": "open",
        "createdAt": "2026-09-04T17:53:00Z"
    },
    "dataAsOf": "2026-09-04T18:00:00Z",
    "market": null,
    "structure": null,
    "backing": null,
    "endingSoon": false,
    "likes": 34,
    "likedByViewer": false,
    "commentCount": 2
};
export const solLoses100: Thesis = {
    "id": "sol-loses-100-before-the-weekend",
    "slug": "sol-loses-100-before-the-weekend",
    "creatorUserId": "mock-user-nutsauce",
    "creator": nutsauce,
    "thesis": {
        "id": "sol-loses-100-before-the-weekend",
        "headline": "SOL loses 100 before the weekend. Nobody is bidding this chop.",
        "rationale": null,
        "direction": "bear",
        "status": "open",
        "createdAt": "2026-09-05T05:58:00Z"
    },
    "dataAsOf": "2026-09-05T06:00:00Z",
    "market": {
        "chainId": 8453,
        "underlyingAsset": "SOL",
        "currentSpotPriceUsd": "101.46",
        "expiryAt": "2026-09-06T08:00:00Z"
    },
    "structure": {
        "productType": "put",
        "isCall": false,
        "isLong": true,
        "strikesUsd": [
            "100"
        ],
        "contracts": null,
        "collateralSymbol": null,
        "legs": [
            {
                "strikeUsd": "100",
                "isCall": false,
                "isLong": true
            }
        ]
    },
    "backing": {
        "creatorPositionId": "mock-creator-position-sol-loses-100-before-the-weekend",
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "300",
            "maximumPayoutUsd": null,
            "breakEvenPricesUsd": [
                "97.86"
            ],
            "estimatedPnlUsd": "-38",
            "finalPnlUsd": null,
            "settlementPriceUsd": null
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "pooledUsd": null,
        "bull": {
            "pct": 40,
            "count": 4,
            "amountUsd": "440",
            "signed": false
        },
        "bear": {
            "pct": 60,
            "count": 6,
            "amountUsd": "670",
            "signed": false
        },
        "mock": {
            "settledAgoMinutes": null,
            "settledWinner": null,
            "maxPayoutMultiple": null,
            "premiumPerContractUsd": "2.14",
            "payoutPerContractUsd": null,
            "transactionFragment": null
        }
    },
    "endingSoon": true,
    "likes": 9,
    "likedByViewer": false,
    "commentCount": 3
};
/** Tagged post: it names a market and a structure, but the creator has not filled it. */
export const ethCallsCheap: Thesis = {
    "id": "eth-calls-cheapest-all-quarter",
    "slug": "eth-calls-cheapest-all-quarter",
    "creatorUserId": "mock-user-jlin",
    "creator": jlin,
    "thesis": {
        "id": "eth-calls-cheapest-all-quarter",
        "headline": "ETH calls are the cheapest they have been all quarter. Vol is asleep into Fusaka.",
        "rationale": "Watching the 2,600 / 2,800 spread on the board. Nothing filled yet — if I take it, it shows up under this post.",
        "direction": "bull",
        "status": "open",
        "createdAt": "2026-09-04T22:19:00Z"
    },
    "dataAsOf": "2026-09-04T23:00:00Z",
    "market": {
        "chainId": 8453,
        "underlyingAsset": "ETH",
        "currentSpotPriceUsd": "2450",
        "expiryAt": "2026-09-25T08:00:00Z"
    },
    "structure": {
        "productType": "call spread",
        "isCall": true,
        "isLong": true,
        "strikesUsd": [
            "2600",
            "2800"
        ],
        "contracts": null,
        "collateralSymbol": null,
        "legs": [
            {
                "strikeUsd": "2600",
                "isCall": true,
                "isLong": true
            },
            {
                "strikeUsd": "2800",
                "isCall": true,
                "isLong": false
            }
        ]
    },
    "backing": null,
    "endingSoon": false,
    "likes": 21,
    "likedByViewer": false,
    "commentCount": 2
};
export const ethFusaka: Thesis = {
    "id": "eth-reclaims-2600-into-fusaka",
    "slug": "eth-reclaims-2600-into-fusaka",
    "creatorUserId": "mock-user-gamma.eth",
    "creator": gammaEth,
    "thesis": {
        "id": "eth-reclaims-2600-into-fusaka",
        "headline": "ETH reclaims 2,600 into the Fusaka upgrade. Every dip has been bought for a month.",
        "rationale": "Cheap upside because vol got crushed after the last range. Call spread caps it but I only need 2,800.",
        "direction": "bull",
        "status": "open",
        "createdAt": "2026-09-04T20:00:00Z"
    },
    "dataAsOf": "2026-09-04T23:00:00Z",
    "market": {
        "chainId": 8453,
        "underlyingAsset": "ETH",
        "currentSpotPriceUsd": "2450",
        "expiryAt": "2026-09-25T08:00:00Z"
    },
    "structure": {
        "productType": "call spread",
        "isCall": true,
        "isLong": true,
        "strikesUsd": [
            "2600",
            "2800"
        ],
        "contracts": "0.71",
        "collateralSymbol": null,
        "legs": [
            {
                "strikeUsd": "2600",
                "isCall": true,
                "isLong": true
            },
            {
                "strikeUsd": "2800",
                "isCall": true,
                "isLong": false
            }
        ]
    },
    "backing": {
        "creatorPositionId": "mock-creator-position-eth-reclaims-2600-into-fusaka",
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "500",
            "maximumPayoutUsd": null,
            "breakEvenPricesUsd": [],
            "estimatedPnlUsd": "204",
            "finalPnlUsd": null,
            "settlementPriceUsd": null
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "pooledUsd": null,
        "bull": {
            "pct": 61,
            "count": 22,
            "amountUsd": "4205",
            "signed": false
        },
        "bear": {
            "pct": 39,
            "count": 14,
            "amountUsd": "2670",
            "signed": false
        },
        "mock": {
            "settledAgoMinutes": null,
            "settledWinner": null,
            "maxPayoutMultiple": "3.1",
            "premiumPerContractUsd": null,
            "payoutPerContractUsd": null,
            "transactionFragment": null
        }
    },
    "endingSoon": false,
    "likes": 88,
    "likedByViewer": false,
    "commentCount": 12
};
export const ethPrints2500: Thesis = {
    "id": "eth-prints-2500-by-friday-close",
    "slug": "eth-prints-2500-by-friday-close",
    "creatorUserId": "mock-user-delta_vega",
    "creator": deltaVega,
    "thesis": {
        "id": "eth-prints-2500-by-friday-close",
        "headline": "ETH prints 2,500 by Friday close. Funding reset, shorts are crowded.",
        "rationale": null,
        "direction": "bull",
        "status": "settled",
        "createdAt": "2026-09-04T17:51:00Z"
    },
    "dataAsOf": "2026-09-04T18:00:00Z",
    "market": {
        "chainId": 8453,
        "underlyingAsset": "ETH",
        "currentSpotPriceUsd": null,
        "expiryAt": "2026-09-04T08:00:00Z"
    },
    "structure": {
        "productType": "call spread",
        "isCall": true,
        "isLong": true,
        "strikesUsd": [
            "2400",
            "2500"
        ],
        "contracts": null,
        "collateralSymbol": null,
        "legs": [
            {
                "strikeUsd": "2400",
                "isCall": true,
                "isLong": true
            },
            {
                "strikeUsd": "2500",
                "isCall": true,
                "isLong": false
            }
        ]
    },
    "backing": {
        "creatorPositionId": "mock-creator-position-eth-prints-2500-by-friday-close",
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "800",
            "maximumPayoutUsd": null,
            "breakEvenPricesUsd": [],
            "estimatedPnlUsd": null,
            "finalPnlUsd": "1920",
            "settlementPriceUsd": "2512.40"
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "pooledUsd": null,
        "bull": {
            "pct": 71,
            "count": 27,
            "amountUsd": "3455",
            "signed": true
        },
        "bear": {
            "pct": 29,
            "count": 11,
            "amountUsd": "-1580",
            "signed": true
        },
        "mock": {
            "settledAgoMinutes": 9,
            "settledWinner": "bull",
            "maxPayoutMultiple": null,
            "premiumPerContractUsd": null,
            "payoutPerContractUsd": "1120",
            "transactionFragment": "0x91ab…4f2e"
        }
    },
    "endingSoon": false,
    "likes": 210,
    "likedByViewer": false,
    "commentCount": 41
};
export const theses = [btcNfp, nfpSetup, solLoses100, ethCallsCheap, ethFusaka, ethPrints2500];
export const trending: TrendingItem[] = [
    {
        "slug": "btc-nfp-4a2c",
        "underlyingAsset": "BTC",
        "headline": "BTC bleeds after NFP",
        "creatorHandle": "merkle_mike",
        "remainingDays": 6,
        "estimatedPnlUsd": "612",
        "bullPct": 78
    },
    {
        "slug": "eth-reclaims-2600-into-fusaka",
        "underlyingAsset": "ETH",
        "headline": "ETH reclaims 2,600 into Fusaka",
        "creatorHandle": "gamma.eth",
        "remainingDays": 20,
        "estimatedPnlUsd": "204",
        "bullPct": 61
    },
    {
        "slug": "sol-loses-100-before-the-weekend",
        "underlyingAsset": "SOL",
        "headline": "SOL loses 100 before the weekend",
        "creatorHandle": "nutsauce",
        "remainingDays": 1,
        "estimatedPnlUsd": "-38",
        "bullPct": 40
    },
    {
        "slug": "btc-85k-by-october",
        "underlyingAsset": "BTC",
        "headline": "BTC 85k by October. ETF flows don't care",
        "creatorHandle": "tailbet",
        "remainingDays": 26,
        "estimatedPnlUsd": "91",
        "bullPct": 55
    },
    {
        "slug": "eth-btc-bottoms-here",
        "underlyingAsset": "ETH",
        "headline": "ETH/BTC bottoms here, ratio squeeze",
        "creatorHandle": "jlin",
        "remainingDays": 13,
        "estimatedPnlUsd": "-120",
        "bullPct": 33
    },
    {
        "slug": "sol-holds-95-through-the-unlock",
        "underlyingAsset": "SOL",
        "headline": "SOL holds 95 through the unlock",
        "creatorHandle": "0xsable",
        "remainingDays": 4,
        "estimatedPnlUsd": "47",
        "bullPct": 66
    }
];
export const yourPositions: Position[] = [
    {
        "id": "mock-position-0",
        "thesisId": "btc-nfp-4a2c",
        "userId": "mock-user-wh",
        "role": "participant",
        "side": "back",
        "status": "indexed",
        "chainId": 8453,
        "walletAddress": "",
        "thesisSlug": "btc-nfp-4a2c",
        "thesisHeadline": "BTC bleeds after NFP",
        "underlyingAsset": "BTC",
        "contracts": null,
        "entrySpotPriceUsd": null,
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "250",
            "maximumPayoutUsd": null,
            "breakEvenPricesUsd": [],
            "estimatedPnlUsd": "96",
            "finalPnlUsd": null,
            "settlementPriceUsd": null
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "createdAt": "2026-09-04T17:42:00Z",
        "mockTransactionFragment": null
    },
    {
        "id": "mock-position-1",
        "thesisId": "eth-reclaims-2600-into-fusaka",
        "userId": "mock-user-wh",
        "role": "participant",
        "side": "counter",
        "status": "indexed",
        "chainId": 8453,
        "walletAddress": "",
        "thesisSlug": "eth-reclaims-2600-into-fusaka",
        "thesisHeadline": "ETH reclaims 2,600 into Fusaka",
        "underlyingAsset": "ETH",
        "contracts": null,
        "entrySpotPriceUsd": null,
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "80",
            "maximumPayoutUsd": null,
            "breakEvenPricesUsd": [],
            "estimatedPnlUsd": "-12",
            "finalPnlUsd": null,
            "settlementPriceUsd": null
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "createdAt": "2026-09-04T20:00:00Z",
        "mockTransactionFragment": null
    },
    {
        "id": "mock-position-2",
        "thesisId": "sol-loses-100-before-the-weekend",
        "userId": "mock-user-wh",
        "role": "participant",
        "side": "back",
        "status": "indexed",
        "chainId": 8453,
        "walletAddress": "",
        "thesisSlug": "sol-loses-100-before-the-weekend",
        "thesisHeadline": "SOL loses 100 before the weekend",
        "underlyingAsset": "SOL",
        "contracts": null,
        "entrySpotPriceUsd": null,
        "economics": {
            "entryPremiumUsd": null,
            "entryFeesUsd": null,
            "maximumLossUsd": "40",
            "maximumPayoutUsd": null,
            "breakEvenPricesUsd": [],
            "estimatedPnlUsd": "0",
            "finalPnlUsd": null,
            "settlementPriceUsd": null
        },
        "verification": {
            "transactionHash": null,
            "optionAddress": null,
            "confirmedOnchain": false
        },
        "createdAt": "2026-09-05T05:58:00Z",
        "mockTransactionFragment": null
    }
];
export const yourSettledPositions: Position[] = [];
export const btcNfpDetail: ThesisDetail = {
    "thesis": btcNfp,
    "shareUrl": "thesis.fun/t/btc-nfp-4a2c",
    "shareHeadline": "BTC bleeds after NFP…",
    "settlementLabel": "settles on Thetanuts TWAP",
    "activityCount": 40,
    "participantCount": 40,
    "participants": [
        {
            "id": "mock-creator-position-btc-nfp-4a2c",
            "thesisId": "btc-nfp-4a2c",
            "userId": "mock-user-merkle_mike",
            "role": "creator",
            "side": "back",
            "status": "indexed",
            "chainId": 8453,
            "walletAddress": "",
            "thesisSlug": "btc-nfp-4a2c",
            "thesisHeadline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
            "underlyingAsset": "BTC",
            "contracts": "0.0126",
            "entrySpotPriceUsd": "79120",
            "economics": {
                "entryPremiumUsd": null,
                "entryFeesUsd": null,
                "maximumLossUsd": "1000",
                "maximumPayoutUsd": null,
                "breakEvenPricesUsd": [],
                "estimatedPnlUsd": "612",
                "finalPnlUsd": null,
                "settlementPriceUsd": null
            },
            "verification": {
                "transactionHash": null,
                "optionAddress": null,
                "confirmedOnchain": false
            },
            "createdAt": "2026-09-04T17:42:00Z",
            "mockTransactionFragment": "0x5d…aa",
            "creator": merkleMike,
            "says": "This is the thesis."
        },
        {
            "id": "mock-participant-1",
            "thesisId": "btc-nfp-4a2c",
            "userId": "mock-user-delta_vega",
            "role": "participant",
            "side": "back",
            "status": "indexed",
            "chainId": 8453,
            "walletAddress": "",
            "thesisSlug": "btc-nfp-4a2c",
            "thesisHeadline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
            "underlyingAsset": "BTC",
            "contracts": "0.0189",
            "entrySpotPriceUsd": "79340",
            "economics": {
                "entryPremiumUsd": null,
                "entryFeesUsd": null,
                "maximumLossUsd": "1500",
                "maximumPayoutUsd": null,
                "breakEvenPricesUsd": [],
                "estimatedPnlUsd": "801",
                "finalPnlUsd": null,
                "settlementPriceUsd": null
            },
            "verification": {
                "transactionHash": null,
                "optionAddress": null,
                "confirmedOnchain": false
            },
            "createdAt": "2026-09-04T17:42:00Z",
            "mockTransactionFragment": "0xb2…9e",
            "creator": deltaVega,
            "says": "Same read. Skew already pricing it."
        },
        {
            "id": "mock-participant-2",
            "thesisId": "btc-nfp-4a2c",
            "userId": "mock-user-0xsable",
            "role": "participant",
            "side": "counter",
            "status": "indexed",
            "chainId": 8453,
            "walletAddress": "",
            "thesisSlug": "btc-nfp-4a2c",
            "thesisHeadline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
            "underlyingAsset": "BTC",
            "contracts": "0.0015",
            "entrySpotPriceUsd": "79400",
            "economics": {
                "entryPremiumUsd": null,
                "entryFeesUsd": null,
                "maximumLossUsd": "120",
                "maximumPayoutUsd": null,
                "breakEvenPricesUsd": [],
                "estimatedPnlUsd": "-44",
                "finalPnlUsd": null,
                "settlementPriceUsd": null
            },
            "verification": {
                "transactionHash": null,
                "optionAddress": null,
                "confirmedOnchain": false
            },
            "createdAt": "2026-09-04T17:42:00Z",
            "mockTransactionFragment": "0x8a…07",
            "creator": oxsable,
            "says": "NFP is priced. Fade the crowd."
        },
        {
            "id": "mock-participant-3",
            "thesisId": "btc-nfp-4a2c",
            "userId": "mock-user-jlin",
            "role": "participant",
            "side": "back",
            "status": "indexed",
            "chainId": 8453,
            "walletAddress": "",
            "thesisSlug": "btc-nfp-4a2c",
            "thesisHeadline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
            "underlyingAsset": "BTC",
            "contracts": "0.0031",
            "entrySpotPriceUsd": "79590",
            "economics": {
                "entryPremiumUsd": null,
                "entryFeesUsd": null,
                "maximumLossUsd": "250",
                "maximumPayoutUsd": null,
                "breakEvenPricesUsd": [],
                "estimatedPnlUsd": "96",
                "finalPnlUsd": null,
                "settlementPriceUsd": null
            },
            "verification": {
                "transactionHash": null,
                "optionAddress": null,
                "confirmedOnchain": false
            },
            "createdAt": "2026-09-04T17:42:00Z",
            "mockTransactionFragment": "0x3f…c1",
            "creator": jlin,
            "says": "—"
        },
        {
            "id": "mock-participant-4",
            "thesisId": "btc-nfp-4a2c",
            "userId": "mock-user-rekt_hedger",
            "role": "participant",
            "side": "counter",
            "status": "indexed",
            "chainId": 8453,
            "walletAddress": "",
            "thesisSlug": "btc-nfp-4a2c",
            "thesisHeadline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
            "underlyingAsset": "BTC",
            "contracts": "0.0051",
            "entrySpotPriceUsd": "79610",
            "economics": {
                "entryPremiumUsd": null,
                "entryFeesUsd": null,
                "maximumLossUsd": "400",
                "maximumPayoutUsd": null,
                "breakEvenPricesUsd": [],
                "estimatedPnlUsd": "-131",
                "finalPnlUsd": null,
                "settlementPriceUsd": null
            },
            "verification": {
                "transactionHash": null,
                "optionAddress": null,
                "confirmedOnchain": false
            },
            "createdAt": "2026-09-04T17:42:00Z",
            "mockTransactionFragment": "0xe7…31",
            "creator": rektHedger,
            "says": "Selling this vol all day."
        }
    ],
    "comments": [
        {
            "creator": deltaVega,
            "createdAt": "2026-09-04T17:49:00Z",
            "body": "Skew already pricing it, but the 74k wing is cheap. Took the same spread bigger."
        },
        {
            "creator": oxsable,
            "createdAt": "2026-09-04T17:51:00Z",
            "body": "NFP is the most telegraphed print of the year. Fading, small size."
        },
        {
            "creator": merkleMike,
            "createdAt": "2026-09-04T17:54:00Z",
            "body": "Fair. If we open above 80.5k Monday I'm wrong and it's on the chain forever."
        }
    ],
    "activity": [
        {
            "creator": jlin,
            "action": "joined",
            "side": "back",
            "amountUsd": "250",
            "contracts": "0.0031",
            "soldStructure": null,
            "transactionHash": null,
            "mockTransactionFragment": "0x3f…c1"
        },
        {
            "creator": oxsable,
            "action": "took",
            "side": "counter",
            "amountUsd": "120",
            "contracts": null,
            "soldStructure": "sold 74k put",
            "transactionHash": null,
            "mockTransactionFragment": "0x8a…07"
        },
        {
            "creator": deltaVega,
            "action": "joined",
            "side": "back",
            "amountUsd": "1500",
            "contracts": "0.0189",
            "soldStructure": null,
            "transactionHash": null,
            "mockTransactionFragment": "0xb2…9e"
        },
        {
            "creator": merkleMike,
            "action": "launched",
            "side": null,
            "amountUsd": "1000",
            "contracts": "0.0126",
            "soldStructure": null,
            "transactionHash": null,
            "mockTransactionFragment": "0x5d…aa"
        }
    ]
};
/**
 * The other posts have no thread content in the mockup, so their detail carries
 * empty participant / comment / activity lists rather than invented rows. A post
 * thread page must exist for every post, backed or not.
 */
function bareDetail(thesis: Thesis, settlementLabel: string | null, comments: Comment[] = []): ThesisDetail {
    return { thesis, shareUrl: `thesis.fun/t/${thesis.slug}`, shareHeadline: `${thesis.thesis.headline.slice(0, 28)}…`,
        settlementLabel, participants: [], comments, activity: [], activityCount: 0, participantCount: 0 };
}
// EXAMPLE DATA: complete the rail-only posts using their existing headline and
// creator. No structure, fill or economics is inferred from a rail summary.
const railOnlyTheses: Thesis[] = trending.filter(item => !theses.some(thesis => thesis.slug === item.slug)).map(item => {
    const creator = allCreators.find(creator => creator.handle === item.creatorHandle);
    if (!creator) throw new Error(`Missing example creator: ${item.creatorHandle}`);
    return { ...nfpSetup, id: item.slug, slug: item.slug, creatorUserId: creator.id, creator,
        thesis: { ...nfpSetup.thesis, id: item.slug, headline: item.headline, rationale: null, direction: null },
        likes: 0, commentCount: 0 };
});
// EXAMPLE following cohort, not a connected wallet's follow state.
export const following = theses.filter(thesis => allCreators.slice(0, 2).some(creator => creator.id === thesis.creatorUserId));
// TODO-OWNER: offline Top is the brief's example likes ordering.
export const top = [...theses].sort((a, b) => b.likes - a.likes);
// TODO-OWNER: example Ending uses the existing rail's remaining days.
export const ending = [...trending].sort((a, b) => a.remainingDays - b.remainingDays);
export const settled: TrendingItem[] = theses.filter(thesis => thesis.thesis.status === "settled").flatMap(thesis => {
    const pnl = thesis.backing?.economics.finalPnlUsd;
    if (pnl == null) return [];
    return [{
    slug: thesis.slug, underlyingAsset: thesis.market?.underlyingAsset ?? "", headline: thesis.thesis.headline,
    creatorHandle: thesis.creator.handle, remainingDays: 0,
    estimatedPnlUsd: pnl, bullPct: thesis.backing?.bull.pct ?? 0,
}];
});
export const thesisDetails: ThesisDetail[] = [
    btcNfpDetail,
    ...railOnlyTheses.map(thesis => bareDetail(thesis, null)),
    bareDetail(nfpSetup, "no structure named", [
        { "creator": merkleMike, "createdAt": "2026-09-04T17:56:00Z", "body": "Same read. I put the 78k / 74k spread behind mine, it is on the BTC market." },
        { "creator": oxsable, "createdAt": "2026-09-04T17:58:00Z", "body": "Talk is cheap. Tag a structure." }
    ]),
    bareDetail(solLoses100, "settles on Thetanuts TWAP"),
    bareDetail(ethCallsCheap, "settles on Thetanuts TWAP", [
        { "creator": gammaEth, "createdAt": "2026-09-04T22:31:00Z", "body": "The 2,600 / 2,800 is the cleanest one on the board right now." },
        { "creator": deltaVega, "createdAt": "2026-09-04T22:44:00Z", "body": "Vol is asleep because nobody wants to hold through the upgrade. Fair." }
    ]),
    bareDetail(ethFusaka, "settles on Thetanuts TWAP"),
    bareDetail(ethPrints2500, "settled on Thetanuts TWAP"),
];
export const newCallouts = { count: 9, avatars: [tailbet, jlin, nutsauce] };
export const wallet = { mockAddressFragment: "0x7c4a…e10b", network: "Base" };
export const marketPrices = [
    {
        "underlyingAsset": "BTC",
        "currentSpotPriceUsd": "79607.32",
        "changePct": "1.65"
    },
    {
        "underlyingAsset": "ETH",
        "currentSpotPriceUsd": "2450.21",
        "changePct": "2.46"
    },
    {
        "underlyingAsset": "SOL",
        "currentSpotPriceUsd": "101.46",
        "changePct": "3.18"
    }
];
export const marketsSource = "from OptionBook liquidity";
export const footerSource = "Base · Thetanuts V4 · example data";

/**
 * Market pages.
 *
 * EXAMPLE DATA, and only that. The real page derives every asset, strike and
 * expiry from live OptionBook orders (CLAUDE.md, "Every market Thetanuts has
 * liquidity for"); nothing here is a product list.
 *
 * Provenance: the BTC book rows, the ticket and the spot prices are transcribed
 * from docs/mockups/thesis-fun-mockup.html (market view table, "Take a side"
 * panel and the footer ticker). The ETH and SOL rows are example rows in the
 * same shape, reusing the strikes and expiries the mockup's own posts name.
 * TODO-OWNER: how structures are ordered, which are surfaced first, and which
 * chart windows ship are all product rules nobody has decided.
 */
/**
 * Price history for the market chart: the mockup's own seeded walk, ported
 * point for point — 168 hourly steps, seed 7, s = (s * 9301 + 49297) % 233280,
 * drift -2 below step 110 and +18 above (docs/mockups/thesis-fun-mockup.html,
 * drawSpot / drawMarket), scaled per asset.
 *
 * One deliberate deviation: the mockup overwrites its LAST point with the spot
 * price, which leaves a vertical spike in a real chart. Here the whole walk is
 * shifted so it ENDS at the spot instead, which keeps the mockup's shape and
 * the mockup's closing price without the artifact.
 *
 * EXAMPLE DATA: a shape, not a price feed.
 */
function walk(startUsd: number, stepUsd: number, driftUsd: number, endsAtUsd: string, lastAt: string) {
    const points = 168;
    const lastSeconds = Math.floor(Date.parse(lastAt) / 1000);
    let s = 7;
    let price = startUsd;
    const raw: number[] = [];
    for (let i = 0; i < points; i++) {
        s = (s * 9301 + 49297) % 233280;
        price += (s / 233280 - 0.5) * stepUsd + (i > 110 ? driftUsd : -driftUsd / 9);
        raw.push(price);
    }
    const offset = Number(endsAtUsd) - raw[points - 1]!;
    return raw.map((value, i) => ({
        time: lastSeconds - (points - 1 - i) * 3600,
        priceUsd: (value + offset).toFixed(2),
    }));
}
export const markets: Market[] = [
    {
        "slug": "btc",
        "chainId": 8453,
        "underlyingAsset": "BTC",
        "name": "Bitcoin",
        "currentSpotPriceUsd": "79607.32",
        "changePct": "1.65",
        "dataAsOf": "2026-09-04T18:00:00Z",
        "series": walk(78100, 420, 18, "79607.32", "2026-09-04T18:00:00Z"),
        "selectedStructureId": "btc-11sep-78000-74000-ps",
        "taggedThesisSlugs": ["btc-nfp-4a2c", "nfp-nobody-is-pricing"],
        "structures": [
            { "id": "btc-11sep-78000-74000-ps", "expiryAt": "2026-09-11T08:00:00Z", "productType": "put spread", "isCall": false, "strikesUsd": ["78000", "74000"], "premiumPerContractUsd": "79.40", "maxPayoutMultiple": "4.6", "liquidityLeftUsd": "41200" },
            { "id": "btc-11sep-76000-p", "expiryAt": "2026-09-11T08:00:00Z", "productType": "put", "isCall": false, "strikesUsd": ["76000"], "premiumPerContractUsd": "1204.00", "maxPayoutMultiple": "2.1", "liquidityLeftUsd": "18900" },
            { "id": "btc-11sep-82000-86000-cs", "expiryAt": "2026-09-11T08:00:00Z", "productType": "call spread", "isCall": true, "strikesUsd": ["82000", "86000"], "premiumPerContractUsd": "61.10", "maxPayoutMultiple": "5.5", "liquidityLeftUsd": "22750" },
            { "id": "btc-18sep-76000-70000-ps", "expiryAt": "2026-09-18T08:00:00Z", "productType": "put spread", "isCall": false, "strikesUsd": ["76000", "70000"], "premiumPerContractUsd": "112.80", "maxPayoutMultiple": "3.9", "liquidityLeftUsd": "9400" },
            { "id": "btc-18sep-85000-c", "expiryAt": "2026-09-18T08:00:00Z", "productType": "call", "isCall": true, "strikesUsd": ["85000"], "premiumPerContractUsd": "742.00", "maxPayoutMultiple": "3.2", "liquidityLeftUsd": "31060" },
            { "id": "btc-26sep-72000-88000-rg", "expiryAt": "2026-09-26T08:00:00Z", "productType": "ranger", "isCall": false, "strikesUsd": ["72000", "88000"], "premiumPerContractUsd": "318.50", "maxPayoutMultiple": "2.4", "liquidityLeftUsd": "6800" }
        ],
        "ticket": {
            "sideNote": "Bull buys the 78k / 74k put spread and pays premium. Bear sells it and posts collateral. Both are live OptionBook fills sized to your budget.",
            "maximumLossUsd": "250",
            "collateralSymbol": "USDC",
            "presetsUsd": ["50", "100", "500", "1000"],
            "orderLabel": "78000/74000-PS",
            "contracts": "0.0031",
            "maximumPayoutUsd": "1153",
            "breakEvenPricesUsd": ["77287"],
            "liquidityLeftUsd": "41200"
        }
    },
    {
        "slug": "eth",
        "chainId": 8453,
        "underlyingAsset": "ETH",
        "name": "Ether",
        "currentSpotPriceUsd": "2450.21",
        "changePct": "2.46",
        "dataAsOf": "2026-09-04T18:00:00Z",
        "series": walk(2402, 13, 0.55, "2450.21", "2026-09-04T18:00:00Z"),
        "selectedStructureId": "eth-25sep-2600-2800-cs",
        "taggedThesisSlugs": ["eth-calls-cheapest-all-quarter", "eth-reclaims-2600-into-fusaka", "eth-prints-2500-by-friday-close"],
        "structures": [
            { "id": "eth-25sep-2600-2800-cs", "expiryAt": "2026-09-25T08:00:00Z", "productType": "call spread", "isCall": true, "strikesUsd": ["2600", "2800"], "premiumPerContractUsd": "64.50", "maxPayoutMultiple": "3.1", "liquidityLeftUsd": "27400" },
            { "id": "eth-25sep-2600-c", "expiryAt": "2026-09-25T08:00:00Z", "productType": "call", "isCall": true, "strikesUsd": ["2600"], "premiumPerContractUsd": "88.20", "maxPayoutMultiple": "2.6", "liquidityLeftUsd": "15300" },
            { "id": "eth-11sep-2300-2200-ps", "expiryAt": "2026-09-11T08:00:00Z", "productType": "put spread", "isCall": false, "strikesUsd": ["2300", "2200"], "premiumPerContractUsd": "21.70", "maxPayoutMultiple": "4.6", "liquidityLeftUsd": "11850" }
        ],
        "ticket": {
            "sideNote": "Bull buys the 2,600 / 2,800 call spread and pays premium. Bear sells it and posts collateral. Both are live OptionBook fills sized to your budget.",
            "maximumLossUsd": "250",
            "collateralSymbol": "USDC",
            "presetsUsd": ["50", "100", "500", "1000"],
            "orderLabel": "2600/2800-CS",
            "contracts": "3.8759",
            "maximumPayoutUsd": "775",
            "breakEvenPricesUsd": ["2664.50"],
            "liquidityLeftUsd": "27400"
        }
    },
    {
        "slug": "sol",
        "chainId": 8453,
        "underlyingAsset": "SOL",
        "name": "Solana",
        "currentSpotPriceUsd": "101.46",
        "changePct": "3.18",
        "dataAsOf": "2026-09-05T06:00:00Z",
        "series": walk(99.4, 0.55, 0.023, "101.46", "2026-09-05T06:00:00Z"),
        "selectedStructureId": "sol-06sep-100-p",
        "taggedThesisSlugs": ["sol-loses-100-before-the-weekend"],
        "structures": [
            { "id": "sol-06sep-100-p", "expiryAt": "2026-09-06T08:00:00Z", "productType": "put", "isCall": false, "strikesUsd": ["100"], "premiumPerContractUsd": "2.14", "maxPayoutMultiple": "2.9", "liquidityLeftUsd": "4600" },
            { "id": "sol-06sep-105-c", "expiryAt": "2026-09-06T08:00:00Z", "productType": "call", "isCall": true, "strikesUsd": ["105"], "premiumPerContractUsd": "1.86", "maxPayoutMultiple": "3.4", "liquidityLeftUsd": "5200" },
            { "id": "sol-13sep-95-90-ps", "expiryAt": "2026-09-13T08:00:00Z", "productType": "put spread", "isCall": false, "strikesUsd": ["95", "90"], "premiumPerContractUsd": "0.94", "maxPayoutMultiple": "5.3", "liquidityLeftUsd": "3100" }
        ],
        "ticket": {
            "sideNote": "Bull buys the 100 put and pays premium. Bear sells it and posts collateral. Both are live OptionBook fills sized to your budget.",
            "maximumLossUsd": "250",
            "collateralSymbol": "USDC",
            "presetsUsd": ["50", "100", "500", "1000"],
            "orderLabel": "100-P",
            "contracts": "116.8224",
            "maximumPayoutUsd": "725",
            "breakEvenPricesUsd": ["97.86"],
            "liquidityLeftUsd": "4600"
        }
    }
];
