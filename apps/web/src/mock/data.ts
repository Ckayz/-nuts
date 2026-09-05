// Base mainnet chainId 8453 is pinned by docs/PRD.md §10.3 (not a mockup number).
// EXAMPLE DATA: financial values and copy transcribed from docs/mockups/thesis-fun-mockup.html.
// TODO-OWNER: IDs prefixed mock-, non-BTC slugs and the wh handle are fixture identifiers, not DB IDs.
// TODO-OWNER: no full wallet/transaction/option addresses are supplied. Empty required wallet strings
// are incomplete fixtures; fragments are presentation evidence only. Never validate these as onchain contexts.
// TODO-OWNER: ISO dataAsOf/createdAt are reconstructed solely to reproduce mockup relative labels.
// Non-BTC expiry times reuse the mockup's 08:00 UTC; position timestamps/lifecycle are illustrative.
// TODO-OWNER: endingSoon flags reproduce chips, not an approved time window. Unknown contracts,
// collateralSymbol and pooledUsd remain null; unknown economics remain null, never zero.
// TODO-OWNER: fixture directions follow headlines; only BTC direction is explicitly owner-specified.
// TODO-OWNER: preset amounts reproduce the mockup, not approved product defaults.
// TODO-OWNER: sinceLabel and followers remain null where the mockup supplies no value.
// Creator rates, ranking, trending, remaining thesis details and connected-user identity stay TODO-OWNER.
import type { Creator, Thesis, Position, ThesisDetail, TrendingItem } from "@/types";
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
    "creatorPayoutsUsd": "3140",
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPayoutsUsd": null,
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
    "creatorPositionId": "mock-creator-position-btc-nfp-4a2c",
    "thesis": {
        "id": "btc-nfp-4a2c",
        "headline": "BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
        "rationale": "Skew is already paying for the downside wing. I want defined risk into Monday. If we open above 80.5k I'm wrong, and it stays on the chain.",
        "direction": "bear",
        "status": "open",
        "createdAt": "2026-09-04T17:42:00Z"
    },
    "creator": merkleMike,
    "market": {
        "chainId": 8453,
        "underlyingAsset": "BTC",
        "currentSpotPriceUsd": "79607",
        "expiryAt": "2026-09-11T08:00:00Z",
        "dataAsOf": "2026-09-04T18:00:00Z"
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
    "endingSoon": false,
    "mock": {
        "settledAgoMinutes": null,
        "settledWinner": null,
        "maxPayoutMultiple": "4.6",
        "premiumPerContractUsd": null,
        "payoutPerContractUsd": null,
        "transactionFragment": null
    },
    "pooledUsd": "9420",
    "earningsUsd": "611",
    "fills": 40,
    "likes": 142,
    "commentCount": 17,
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
    }
};
export const solLoses100: Thesis = {
    "id": "sol-loses-100-before-the-weekend",
    "slug": "sol-loses-100-before-the-weekend",
    "creatorUserId": "mock-user-nutsauce",
    "creatorPositionId": "mock-creator-position-sol-loses-100-before-the-weekend",
    "thesis": {
        "id": "sol-loses-100-before-the-weekend",
        "headline": "SOL loses 100 before the weekend. Nobody is bidding this chop.",
        "rationale": null,
        "direction": "bear",
        "status": "open",
        "createdAt": "2026-09-05T05:58:00Z"
    },
    "creator": nutsauce,
    "market": {
        "chainId": 8453,
        "underlyingAsset": "SOL",
        "currentSpotPriceUsd": "101.46",
        "expiryAt": "2026-09-06T08:00:00Z",
        "dataAsOf": "2026-09-05T06:00:00Z"
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
    "endingSoon": true,
    "mock": {
        "settledAgoMinutes": null,
        "settledWinner": null,
        "maxPayoutMultiple": null,
        "premiumPerContractUsd": "2.14",
        "payoutPerContractUsd": null,
        "transactionFragment": null
    },
    "pooledUsd": null,
    "earningsUsd": "14",
    "fills": 10,
    "likes": 9,
    "commentCount": 3,
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
    }
};
export const ethFusaka: Thesis = {
    "id": "eth-reclaims-2600-into-fusaka",
    "slug": "eth-reclaims-2600-into-fusaka",
    "creatorUserId": "mock-user-gamma.eth",
    "creatorPositionId": "mock-creator-position-eth-reclaims-2600-into-fusaka",
    "thesis": {
        "id": "eth-reclaims-2600-into-fusaka",
        "headline": "ETH reclaims 2,600 into the Fusaka upgrade. Every dip has been bought for a month.",
        "rationale": "Cheap upside because vol got crushed after the last range. Call spread caps it but I only need 2,800.",
        "direction": "bull",
        "status": "open",
        "createdAt": "2026-09-04T20:00:00Z"
    },
    "creator": gammaEth,
    "market": {
        "chainId": 8453,
        "underlyingAsset": "ETH",
        "currentSpotPriceUsd": "2450",
        "expiryAt": "2026-09-25T08:00:00Z",
        "dataAsOf": "2026-09-04T23:00:00Z"
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
    "endingSoon": false,
    "mock": {
        "settledAgoMinutes": null,
        "settledWinner": null,
        "maxPayoutMultiple": "3.1",
        "premiumPerContractUsd": null,
        "payoutPerContractUsd": null,
        "transactionFragment": null
    },
    "pooledUsd": null,
    "earningsUsd": "388",
    "fills": 36,
    "likes": 88,
    "commentCount": 12,
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
    }
};
export const ethPrints2500: Thesis = {
    "id": "eth-prints-2500-by-friday-close",
    "slug": "eth-prints-2500-by-friday-close",
    "creatorUserId": "mock-user-delta_vega",
    "creatorPositionId": "mock-creator-position-eth-prints-2500-by-friday-close",
    "thesis": {
        "id": "eth-prints-2500-by-friday-close",
        "headline": "ETH prints 2,500 by Friday close. Funding reset, shorts are crowded.",
        "rationale": null,
        "direction": "bull",
        "status": "settled",
        "createdAt": "2026-09-04T17:51:00Z"
    },
    "creator": deltaVega,
    "market": {
        "chainId": 8453,
        "underlyingAsset": "ETH",
        "currentSpotPriceUsd": null,
        "expiryAt": "2026-09-04T08:00:00Z",
        "dataAsOf": "2026-09-04T18:00:00Z"
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
    "endingSoon": false,
    "mock": {
        "settledAgoMinutes": 9,
        "settledWinner": "bull",
        "maxPayoutMultiple": null,
        "premiumPerContractUsd": null,
        "payoutPerContractUsd": "1120",
        "transactionFragment": "0x91ab…4f2e"
    },
    "pooledUsd": null,
    "earningsUsd": "524",
    "fills": 38,
    "likes": 210,
    "commentCount": 41,
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
    }
};
export const theses = [btcNfp, solLoses100, ethFusaka, ethPrints2500];
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
    "spotChangePct": "1.65",
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
    ],
    "ticket": {
        "sideNote": "Bull buys the same 78k / 74k put spread. Bear sells it and posts collateral. Both are live OptionBook fills sized to your budget.",
        "maximumLossUsd": "250",
        "collateralSymbol": "USDC",
        "presetsUsd": [
            "50",
            "100",
            "500",
            "1000"
        ],
        "orderLabel": "78000/74000-PS",
        "contracts": "0.0031",
        "maximumPayoutUsd": "1153",
        "breakEvenPricesUsd": [
            "76090"
        ],
        "liquidityLeftUsd": "41200"
    }
};
export const thesisDetails = [btcNfpDetail];
export const creatorPayouts = {
    "paidToCreatorsUsd": "2184",
    "fromFollowerFillsUsd": "412900",
    "topEarner": merkleMike,
    "topEarnerUsd": "611"
};
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
