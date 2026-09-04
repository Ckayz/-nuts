// EXAMPLE DATA
//
// Every name, headline, number and string below is copied from
// docs/mockups/thesis-fun-mockup.html. Nothing here is invented except where a
// TODO-OWNER comment says so. Replaced by live Thetanuts + database reads later.

import type {
	ActivityItem,
	Comment,
	Creator,
	Participant,
	Position,
	Thesis,
	ThesisDetail,
	TrendingItem,
} from "@/types";

/* ------------------------------------------------------------------ creators */

export const merkleMike: Creator = {
	handle: "merkle_mike",
	displayName: "merkle_mike",
	initials: "MK",
	walletAddress: "0x7c44…5dEd",
	sinceLabel: "since Jun 26",
	winRatePct: 71,
	thesesCount: 24,
	followers: 1204,
	netPnlUsd: 18240,
	verifiedPnl30dUsd: 18240,
	creatorPayoutsUsd: 3140,
	biggestLossUsd: -2000,
};

export const nutsauce: Creator = {
	handle: "nutsauce",
	displayName: "nutsauce",
	initials: "NS",
	winRatePct: 64,
	thesesCount: 31,
	netPnlUsd: 11905,
};

export const gammaEth: Creator = {
	handle: "gamma.eth",
	displayName: "gamma.eth",
	initials: "GA",
	winRatePct: 58,
	thesesCount: 12,
	netPnlUsd: 7310,
};

export const deltaVega: Creator = {
	handle: "delta_vega",
	displayName: "delta_vega",
	initials: "DV",
	winRatePct: 55,
	thesesCount: 40,
	netPnlUsd: 4082,
};

export const jlin: Creator = {
	handle: "jlin",
	displayName: "jlin",
	initials: "JL",
	winRatePct: 60,
	thesesCount: 9,
	netPnlUsd: 2915,
};

export const oxsable: Creator = {
	handle: "0xsable",
	displayName: "0xsable",
	initials: "0X",
	winRatePct: 52,
	thesesCount: 17,
	netPnlUsd: 1740,
};

export const tailbet: Creator = {
	handle: "tailbet",
	displayName: "tailbet",
	initials: "TB",
	winRatePct: 50,
	thesesCount: 6,
	netPnlUsd: 1212,
};

export const rektHedger: Creator = {
	handle: "rekt_hedger",
	displayName: "rekt_hedger",
	initials: "RH",
	winRatePct: 49,
	thesesCount: 19,
	netPnlUsd: -1140,
};

/**
 * The connected wallet. The mockup gives only the avatar monogram "WH"
 * (line 199) and the header address "0x7c4a…e10b" (line 204) — no handle, no
 * name, no stats. TODO-OWNER: name the connected user. The handle below is the
 * monogram lower-cased so the rail avatar has a route to point at; the display
 * name is the mockup's own missing-value glyph.
 */
export const currentUser: Creator = {
	handle: "wh",
	displayName: "—",
	initials: "WH",
};

export const CURRENT_USER_HANDLE = currentUser.handle;

/** Header wallet chip. */
export const wallet = {
	addressLabel: "0x7c4a…e10b",
	network: "Base",
};

/** Ranked 1..8, "Top P&L · Net P&L · 1W". Ranks 1-3 carry the gold `.rank.top`. */
export const leaderboard: Creator[] = [
	merkleMike,
	nutsauce,
	gammaEth,
	deltaVega,
	jlin,
	oxsable,
	tailbet,
	rektHedger,
];

/** Same eight creators, same order, in the "Top creators · 1W" tape. */
export const topCreators: Creator[] = leaderboard;

export const creatorPayouts = {
	paidToCreatorsUsd: 2184,
	fromFollowerFillsUsd: 412900,
	topEarner: merkleMike,
	topEarnerUsd: 611,
};

/** The "+9 new callouts" bar. */
export const newCallouts = {
	count: 9,
	avatars: [tailbet, jlin, nutsauce],
};

export const allCreators: Creator[] = [...leaderboard, currentUser];

export function creatorByHandle(handle: string): Creator | undefined {
	return allCreators.find((c) => c.handle === handle);
}

/* -------------------------------------------------------------------- theses */

// The mockup names one slug only: "thesis.fun/t/btc-nfp-4a2c" (line 457).
// TODO-OWNER: the other six slugs below are slugified headlines, not mockup values.

export const btcNfp: Thesis = {
	id: "btc-nfp-4a2c",
	slug: "btc-nfp-4a2c",
	headline:
		"BTC bleeds after NFP. Jobs print is hot, cuts get pushed, risk unwinds into the weekend.",
	note: "Skew is already paying for the downside wing. I want defined risk into Monday. If we open above 80.5k I'm wrong, and it stays on the chain.",
	asset: "BTC",
	chainId: 8453,
	creator: merkleMike,
	status: "live",
	statusLabel: "LIVE · 6d 14h",
	postedLabel: "· 18m",
	structure: {
		productType: "put spread",
		isCall: false,
		isLong: true,
		legs: [
			{ strikeUsd: 78000, isCall: false, isLong: true },
			{ strikeUsd: 74000, isCall: false, isLong: false },
		],
		strikesUsd: [78000, 74000],
		// The hero spells this expiry out: "11 Sep 26 08:00 UTC" (line 391).
		expiryAt: "2026-09-11T08:00:00Z",
		expiryLabel: "11 SEP",
		strikesLabel: "78,000 / 74,000 P",
		side: "bull",
		collateralSymbol: "USDC",
		contracts: 0.0126,
		venueLabel: "Base · OptionBook",
	},
	detailParts: ["Spot 79,607", "0.0126 ct", "max payout 4.6×", "Base · OptionBook"],
	creatorRiskedUsd: 1000,
	creatorLivePnlUsd: 612,
	creatorPnlLabel: "Live P&L",
	pooledUsd: 9420,
	bull: { pct: 78, count: 31, amountLabel: "$7,920" },
	bear: { pct: 22, count: 9, amountLabel: "$1,500" },
	earningsUsd: 611,
	fills: 40,
	likes: 142,
	commentCount: 17,
};

export const solLoses100: Thesis = {
	id: "sol-loses-100-before-the-weekend",
	slug: "sol-loses-100-before-the-weekend",
	headline: "SOL loses 100 before the weekend. Nobody is bidding this chop.",
	note: null,
	asset: "SOL",
	chainId: 8453,
	creator: nutsauce,
	status: "ending",
	statusLabel: "ENDING · 1d 02h",
	postedLabel: "· 2m",
	structure: {
		productType: "put",
		isCall: false,
		isLong: true,
		legs: [{ strikeUsd: 100, isCall: false, isLong: true }],
		strikesUsd: [100],
		// TODO-OWNER: the mockup gives "06 SEP" only; the time of day is copied
		// from the one expiry it spells out in full (11 Sep 26 08:00 UTC).
		expiryAt: "2026-09-06T08:00:00Z",
		expiryLabel: "06 SEP",
		strikesLabel: "100 P",
		side: "bull",
		collateralSymbol: "USDC",
		contracts: 0,
		venueLabel: "Base · OptionBook",
	},
	detailParts: [
		"Spot 101.46",
		"premium 2.14 / ct",
		"break-even 97.86",
		"Base · OptionBook",
	],
	creatorRiskedUsd: 300,
	creatorLivePnlUsd: -38,
	creatorPnlLabel: "Live P&L",
	pooledUsd: 0,
	bull: { pct: 40, count: 4, amountLabel: "$440" },
	bear: { pct: 60, count: 6, amountLabel: "$670" },
	earningsUsd: 14,
	fills: 10,
	likes: 9,
	commentCount: 3,
};

export const ethFusaka: Thesis = {
	id: "eth-reclaims-2600-into-fusaka",
	slug: "eth-reclaims-2600-into-fusaka",
	headline:
		"ETH reclaims 2,600 into the Fusaka upgrade. Every dip has been bought for a month.",
	note: "Cheap upside because vol got crushed after the last range. Call spread caps it but I only need 2,800.",
	asset: "ETH",
	chainId: 8453,
	creator: gammaEth,
	status: "live",
	statusLabel: "LIVE · 20d 09h",
	postedLabel: "· 3h",
	structure: {
		productType: "call spread",
		isCall: true,
		isLong: true,
		legs: [
			{ strikeUsd: 2600, isCall: true, isLong: true },
			{ strikeUsd: 2800, isCall: true, isLong: false },
		],
		strikesUsd: [2600, 2800],
		// TODO-OWNER: time of day copied from the one expiry the mockup spells out.
		expiryAt: "2026-09-25T08:00:00Z",
		expiryLabel: "25 SEP",
		strikesLabel: "2,600 / 2,800 C",
		side: "bull",
		collateralSymbol: "USDC",
		contracts: 0.71,
		venueLabel: "Base · OptionBook",
	},
	detailParts: ["Spot 2,450", "0.71 ct", "max payout 3.1×", "Base · OptionBook"],
	creatorRiskedUsd: 500,
	creatorLivePnlUsd: 204,
	creatorPnlLabel: "Live P&L",
	pooledUsd: 0,
	bull: { pct: 61, count: 22, amountLabel: "$4,205" },
	bear: { pct: 39, count: 14, amountLabel: "$2,670" },
	earningsUsd: 388,
	fills: 36,
	likes: 88,
	commentCount: 12,
};

export const ethPrints2500: Thesis = {
	id: "eth-prints-2500-by-friday-close",
	slug: "eth-prints-2500-by-friday-close",
	headline: "ETH prints 2,500 by Friday close. Funding reset, shorts are crowded.",
	note: null,
	asset: "ETH",
	chainId: 8453,
	creator: deltaVega,
	status: "settled",
	statusLabel: "SETTLED · BULL WON",
	postedLabel: "· settled 9m",
	structure: {
		productType: "call spread",
		isCall: true,
		isLong: true,
		legs: [
			{ strikeUsd: 2400, isCall: true, isLong: true },
			{ strikeUsd: 2500, isCall: true, isLong: false },
		],
		strikesUsd: [2400, 2500],
		// TODO-OWNER: time of day copied from the one expiry the mockup spells out.
		expiryAt: "2026-09-04T08:00:00Z",
		expiryLabel: "04 SEP",
		strikesLabel: "2,400 / 2,500 C",
		side: "bull",
		collateralSymbol: "USDC",
		contracts: 0,
		venueLabel: "Base · OptionBook",
	},
	detailParts: ["Settled 2,512.40", "payout 1,120 / ct"],
	detailTx: { label: "0x91ab…4f2e ↗", href: "#" },
	creatorRiskedUsd: 800,
	creatorLivePnlUsd: 1920,
	creatorPnlLabel: "Result",
	pooledUsd: 0,
	bull: { pct: 71, count: 27, amountLabel: "+$3,455" },
	bear: { pct: 29, count: 11, amountLabel: "−$1,580" },
	earningsUsd: 524,
	fills: 38,
	likes: 210,
	commentCount: 41,
};

/** The callout feed, in mockup order. */
export const theses: Thesis[] = [btcNfp, solLoses100, ethFusaka, ethPrints2500];

export function thesisBySlug(slug: string): Thesis | undefined {
	return theses.find((t) => t.slug === slug);
}

export function thesesByCreator(handle: string): Thesis[] {
	return theses.filter((t) => t.creator.handle === handle);
}

/* ------------------------------------------------------------------ trending */

export const trending: TrendingItem[] = [
	{
		slug: btcNfp.slug,
		asset: "BTC",
		headline: "BTC bleeds after NFP",
		creatorHandle: "merkle_mike",
		timeLabel: "6d",
		pnlUsd: 612,
		bullPct: 78,
	},
	{
		slug: ethFusaka.slug,
		asset: "ETH",
		headline: "ETH reclaims 2,600 into Fusaka",
		creatorHandle: "gamma.eth",
		timeLabel: "20d",
		pnlUsd: 204,
		bullPct: 61,
	},
	{
		slug: solLoses100.slug,
		asset: "SOL",
		headline: "SOL loses 100 before the weekend",
		creatorHandle: "nutsauce",
		timeLabel: "1d",
		pnlUsd: -38,
		bullPct: 40,
	},
	{
		// TODO-OWNER: slug not in the mockup.
		slug: "btc-85k-by-october",
		asset: "BTC",
		headline: "BTC 85k by October. ETF flows don't care",
		creatorHandle: "tailbet",
		timeLabel: "26d",
		pnlUsd: 91,
		bullPct: 55,
	},
	{
		// TODO-OWNER: slug not in the mockup.
		slug: "eth-btc-bottoms-here",
		asset: "ETH",
		headline: "ETH/BTC bottoms here, ratio squeeze",
		creatorHandle: "jlin",
		timeLabel: "13d",
		pnlUsd: -120,
		bullPct: 33,
	},
	{
		// TODO-OWNER: slug not in the mockup.
		slug: "sol-holds-95-through-the-unlock",
		asset: "SOL",
		headline: "SOL holds 95 through the unlock",
		creatorHandle: "0xsable",
		timeLabel: "4d",
		pnlUsd: 47,
		bullPct: 66,
	},
];

/* ----------------------------------------------------------------- positions */

/**
 * The connected wallet's open positions ("Your positions · 3 open").
 * The mockup shows no settled position for the connected wallet.
 */
export const yourPositions: Position[] = [
	{
		thesisSlug: btcNfp.slug,
		thesisHeadline: "BTC bleeds after NFP",
		asset: "BTC",
		side: "bull",
		riskedUsd: 250,
		livePnlUsd: 96,
		settled: false,
	},
	{
		thesisSlug: ethFusaka.slug,
		thesisHeadline: "ETH reclaims 2,600 into Fusaka",
		asset: "ETH",
		side: "bear",
		riskedUsd: 80,
		livePnlUsd: -12,
		settled: false,
	},
	{
		thesisSlug: solLoses100.slug,
		thesisHeadline: "SOL loses 100 before the weekend",
		asset: "SOL",
		side: "bull",
		riskedUsd: 40,
		livePnlUsd: 0,
		settled: false,
	},
];

export const yourSettledPositions: Position[] = [];

/* -------------------------------------------------------- thesis page detail */

const btcParticipants: Participant[] = [
	{
		creator: merkleMike,
		side: "bull",
		riskedUsd: 1000,
		contracts: 0.0126,
		entryUsd: 79120,
		livePnlUsd: 612,
		says: "This is the thesis.",
		tx: { label: "0x5d…aa ↗", href: "#" },
		isCreator: true,
	},
	{
		creator: deltaVega,
		side: "bull",
		riskedUsd: 1500,
		contracts: 0.0189,
		entryUsd: 79340,
		livePnlUsd: 801,
		says: "Same read. Skew already pricing it.",
		tx: { label: "0xb2…9e ↗", href: "#" },
	},
	{
		creator: oxsable,
		side: "bear",
		riskedUsd: 120,
		contracts: 0.0015,
		entryUsd: 79400,
		livePnlUsd: -44,
		says: "NFP is priced. Fade the crowd.",
		tx: { label: "0x8a…07 ↗", href: "#" },
	},
	{
		creator: jlin,
		side: "bull",
		riskedUsd: 250,
		contracts: 0.0031,
		entryUsd: 79590,
		livePnlUsd: 96,
		says: "—",
		tx: { label: "0x3f…c1 ↗", href: "#" },
	},
	{
		creator: rektHedger,
		side: "bear",
		riskedUsd: 400,
		contracts: 0.0051,
		entryUsd: 79610,
		livePnlUsd: -131,
		says: "Selling this vol all day.",
		tx: { label: "0xe7…31 ↗", href: "#" },
	},
];

const btcComments: Comment[] = [
	{
		creator: deltaVega,
		postedLabel: "· 11m",
		body: "Skew already pricing it, but the 74k wing is cheap. Took the same spread bigger.",
	},
	{
		creator: oxsable,
		postedLabel: "· 9m",
		body: "NFP is the most telegraphed print of the year. Fading, small size.",
	},
	{
		creator: merkleMike,
		postedLabel: "· 6m",
		body: "Fair. If we open above 80.5k Monday I'm wrong and it's on the chain forever.",
	},
];

const btcActivity: ActivityItem[] = [
	{
		creator: jlin,
		action: "joined",
		side: "bull",
		detail: "$250 · 0.0031 ct",
		tx: { label: "0x3f…c1 ↗", href: "#" },
	},
	{
		creator: oxsable,
		action: "took",
		side: "bear",
		detail: "$120 · sold 74k put",
		tx: { label: "0x8a…07 ↗", href: "#" },
	},
	{
		creator: deltaVega,
		action: "joined",
		side: "bull",
		detail: "$1,500 · 0.0189 ct",
		tx: { label: "0xb2…9e ↗", href: "#" },
	},
	{
		creator: merkleMike,
		action: "launched",
		detail: "$1,000 · 0.0126 ct",
		tx: { label: "0x5d…aa ↗", href: "#" },
	},
];

export const btcNfpDetail: ThesisDetail = {
	thesis: btcNfp,
	shareUrl: "thesis.fun/t/btc-nfp-4a2c",
	shareHeadline: "BTC bleeds after NFP…",
	expiryLabel: "11 Sep 26 08:00 UTC",
	settlementLabel: "settles on Thetanuts TWAP",
	launchedLabel: "launched 18m ago",
	spotUsd: 79607,
	spotChangeLabel: "+1.65%",
	maxPayoutUsd: 4612,
	breakEvenUsd: 76120,
	participants: btcParticipants,
	comments: btcComments,
	activity: btcActivity,
	activityCount: 40,
	participantCount: 40,
	ticket: {
		sideNote:
			"Bull buys the same 78k / 74k put spread. Bear sells it and posts collateral. Both are live OptionBook fills sized to your budget.",
		maxLossUsd: 250,
		collateralSymbol: "USDC",
		presetsUsd: [50, 100, 500, 1000],
		orderLabel: "78000/74000-PS",
		contracts: 0.0031,
		maxPayoutUsd: 1153,
		breakEvenUsd: 76090,
		liquidityLeftUsd: 41200,
	},
};

/**
 * The mockup builds one thesis page only (the BTC put spread). Every other
 * thesis has feed-level data only — no participants, comments, activity,
 * charts, board or ticket. TODO-OWNER: the rest.
 */
export const thesisDetails: ThesisDetail[] = [btcNfpDetail];

export function thesisDetailBySlug(slug: string): ThesisDetail | undefined {
	return thesisDetails.find((d) => d.thesis.slug === slug);
}

export function participantsByCreator(handle: string): Participant[] {
	return thesisDetails.flatMap((d) =>
		d.participants.filter((p) => p.creator.handle === handle),
	);
}

export function activityByCreator(handle: string): ActivityItem[] {
	return thesisDetails.flatMap((d) =>
		d.activity.filter((a) => a.creator.handle === handle),
	);
}

/* -------------------------------------------------------------- price footer */

export const marketPrices = [
	{ asset: "BTC", price: "79,607.32", change: "+1.65%" },
	{ asset: "ETH", price: "2,450.21", change: "+2.46%" },
	{ asset: "SOL", price: "101.46", change: "+3.18%" },
];

export const marketsSource = "from OptionBook liquidity";
export const footerSource = "Base · Thetanuts V4 · example data";
