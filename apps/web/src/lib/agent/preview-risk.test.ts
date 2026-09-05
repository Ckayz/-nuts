/// <reference types="bun" />
/**
 * The agent and the market ticket must not disagree about one structure.
 *
 * `previewOptionBookTrade` used to answer `maxPayoutUsd: null, breakEvenUsd:
 * null` with the sentence "not computed yet", while `/m/<asset>`'s Bull/Bear
 * ticket printed both for the same order at the same budget. The fix was to
 * call the ticket's own `riskOutputs` (`lib/market/quote.ts`) rather than to
 * write a second payoff model, and the point of this file is that the choice
 * stays made: every case below asserts the tool's decimal figures against
 * `quoteStructure`'s USD-8 figures for the SAME book row and the SAME budget.
 *
 * Two independent means, per the self-distrust rule:
 *  1. the equality pin against `quoteStructure`, and
 *  2. an arithmetic recomputation in this file, from `raw.numContracts`,
 *     `raw.premium` and the strikes, that touches neither `riskOutputs` nor
 *     `@nuts/thetanuts` — a break-even is a strike plus the premium per
 *     contract, and a spread's payout is its width minus the premium.
 *
 * WHY A SUBPROCESS. Identical to `tools-page.test.ts`: `lib/thetanuts/orders.ts`
 * holds ONE module-level snapshot cache and the tool reaches it with nothing in
 * between, so driving the tool through a fake book leaves that cache holding
 * the fake book for whatever file bun loads next (`orders.test.ts` expects its
 * own three rows). A child shares no module state, so no ordering can matter.
 *
 * The book rows are ours; everything from `normalizeOdetteOrder` onward —
 * `deriveMarkets`, `toTradeable`, `sizeFill`, `quoteFill`/`quoteSellFill`,
 * `riskOutputs` — is production code.
 */
import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

const TIMEOUT_MS = 60_000;

interface Risk {
	readonly maxLossUsd: string | null;
	readonly maxLoss: { readonly amount: string; readonly token: string };
	readonly maxPayoutUsd: string | null;
	readonly breakEvenUsd: string | null;
	readonly unavailable?: string;
}
interface Case {
	/** What the agent tool answered. */
	readonly tool: {
		readonly executable: boolean;
		readonly reason?: string;
		readonly side: "buy" | "sell";
		readonly risk: Risk;
		readonly raw: { readonly numContracts: string; readonly premium: string; readonly feeEstimate: string; readonly collateralRequired: string | null; readonly collateralDecimals: number };
		readonly contractSizeDecimals: number;
	};
	/** What the market ticket answered for the same order and budget, USD-8. */
	readonly quote:
		| { readonly ok: true; readonly maxPayoutUsd8: string | null; readonly breakEvenUsd8: string | null; readonly maxLossUsd8: string | null; readonly premiumUsd8: string | null; readonly numContracts: string }
		| { readonly ok: false; readonly code: string; readonly reason: string };
	/** The book row's own strikes, 8-decimal integers as strings. */
	readonly strikes8: string[];
	readonly implementation: string | null;
}
type Probe = Record<"longCall" | "longPut" | "callSpread" | "ranger" | "noUsdPrice" | "shortPut", Case>;

/**
 * One child, every case, one JSON line back.
 *
 * Addresses are the SDK's own Base chain config (`dist/index.js`, chain 8453):
 * the ETH price feed, five implementations and two 6-decimal collateral tokens,
 * one of which (`cbXRP`) is deliberately absent from `COLLATERAL_USD_SOURCES`.
 */
function probe(): Probe {
	const script = String.raw`
		import { plugin } from "bun";
		plugin({ name: "preview-risk-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
		}});

		const orders = await import("@/lib/thetanuts/orders");
		const { previewOptionBookTrade } = await import("@/lib/agent/tools");
		const { instrumentKey } = await import("@/lib/thetanuts/instrument");
		const { quoteStructure } = await import("@/lib/market/quote");
		const { deriveMarkets, takerSide } = await import("@nuts/thetanuts");
		const { env } = await import("@nuts/env/server");

		const CTX = { toolCallId: "test", messages: [], context: {} };
		const PRICES = { prices: { ETH: 2400, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 },
			metadata: { lastUpdated: 0, currentTime: 0 } };
		const ETH_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
		const IMPL = {
			LINEAR_CALL: "0x051791df68223AE173Fade5217C48875e36eef61",
			PUT: "0x7355EB92dfb0503DB558a70c10843618932ab290",
			CALL_SPREAD: "0xfaeD63f7040E65b79cF0Ae29706fDc423eE249A9",
			PHYSICAL_PUT: "0x6aD53DD058bea004829cCf58a282C21a7Df02DcA",
			RANGER: "0x9980ec85bc6fE07340adb36c76FA093bb6D4FcBc",
		};
		const TOKEN = {
			// In BOTH SDK maps (tokens and the deprecated collateralTokens), which is what a
			// single-strike CALL needs: calculateMaxContracts switches to a 10**6 contract-size
			// unit whenever getCollateralDecimals falls back to 18, and aBasUSDC is not in the
			// deprecated map, so an aBasUSDC single-strike call sizes to zero contracts.
			USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
			aBasUSDC: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
			// 6 decimals, and deliberately NOT in COLLATERAL_USD_SOURCES.
			cbXRP: "0x7B2Cd9EA5566c345C9cdbcF58f5E211a0dB47444",
		};
		const E8 = (usd) => (BigInt(usd) * 100000000n).toString();

		let seq = 0;
		/** One maker order. isLong is the MAKER's long flag: false => the TAKER BUYS. */
		function row({ implementation, collateral, isCall, isLong, strikes }) {
			seq += 1;
			const expiry = Math.floor(Date.now() / 1000) + 100000 + seq;
			const rawApiData = { collateral, priceFeed: ETH_FEED, implementation,
				strikes, isCall, isLong, orderExpiryTimestamp: expiry,
				extraOptionData: "0x", maxCollateralUsable: "22000000000" };
			return { signature: "0x12",
				order: { ...rawApiData, maker: "0x" + "1".repeat(40), price: "212682750", expiry } };
		}

		const CASES = {
			longCall:   row({ implementation: IMPL.LINEAR_CALL, collateral: TOKEN.USDC,     isCall: true,  isLong: false, strikes: [E8(2450)] }),
			longPut:    row({ implementation: IMPL.PUT,         collateral: TOKEN.aBasUSDC, isCall: false, isLong: false, strikes: [E8(2450)] }),
			callSpread: row({ implementation: IMPL.CALL_SPREAD,  collateral: TOKEN.aBasUSDC, isCall: true,  isLong: false, strikes: [E8(2450), E8(2500)] }),
			// RANGER carries four strikes in the SDK's own implementation map, and the risk
			// model covers no ranger at any strike count.
			ranger:     row({ implementation: IMPL.RANGER,       collateral: TOKEN.aBasUSDC, isCall: false, isLong: false, strikes: [E8(2400), E8(2450), E8(2500), E8(2550)] }),
			noUsdPrice: row({ implementation: IMPL.PUT,          collateral: TOKEN.cbXRP,    isCall: false, isLong: false, strikes: [E8(2450)] }),
			// The one decoded taker-SELL pair (VERIFIED_SELL_PAIRS): PHYSICAL_PUT + aBasUSDC.
			shortPut:   row({ implementation: IMPL.PHYSICAL_PUT, collateral: TOKEN.aBasUSDC, isCall: false, isLong: true,  strikes: [E8(2450)] }),
		};
		/** Decimal collateral-token budget per case; 6-decimal tokens throughout. */
		const BUDGET = { longCall: "1", longPut: "1", callSpread: "1", ranger: "1", noUsdPrice: "1", shortPut: "5" };

		orders.rawOrderApi.request = async () => ({ data: { orders: Object.values(CASES) } });
		orders.readClient.api.getMarketData = async () => PRICES;
		const snapshot = await orders.getOrderSnapshot(true);
		if (orders.isFeedUnavailable(snapshot)) throw new Error("unexpected " + snapshot.error);

		const out = {};
		for (const [name, feedRow] of Object.entries(CASES)) {
			const normalized = orders.rawOrderApi.normalizeOdetteOrder(feedRow);
			const market = deriveMarkets([normalized])[0];
			if (!market) throw new Error(name + ": deriveMarkets dropped the row");
			const tradeable = snapshot.orders.find((o) =>
				o.entry.order.implementation.toLowerCase() === feedRow.order.implementation.toLowerCase() &&
				o.entry.order.collateral.toLowerCase() === feedRow.order.collateral.toLowerCase() &&
				o.entry.order.expiry === feedRow.order.expiry);
			if (!tradeable) throw new Error(name + ": row missing from the snapshot");

			const tool = await previewOptionBookTrade.execute(
				{ instrumentKey: instrumentKey(tradeable), budget: BUDGET[name] }, CTX);

			// The SAME budget in base units, and the taker side the book row states.
			const decimals = market.collateralToken.decimals;
			const [whole, fraction = ""] = BUDGET[name].split(".");
			const budgetBaseUnits = BigInt(whole) * 10n ** BigInt(decimals)
				+ BigInt(fraction.padEnd(decimals, "0") || "0");
			const q = quoteStructure({ client: orders.readClient, market, side: takerSide(market.order),
				budget: budgetBaseUnits, referrer: env.THESIS_REFERRER });
			const s = (v) => (v === null || v === undefined ? null : v.toString());
			out[name] = {
				tool: { executable: tool.executable, reason: tool.reason, side: tool.side,
					risk: tool.risk, raw: tool.raw, contractSizeDecimals: tool.contractSizeDecimals },
				quote: q.ok
					? { ok: true, maxPayoutUsd8: s(q.maxPayoutUsd8), breakEvenUsd8: s(q.breakEvenUsd8),
						maxLossUsd8: s(q.maxLossUsd8), premiumUsd8: s(q.premiumUsd8), numContracts: s(q.numContracts) }
					: { ok: false, code: q.code, reason: q.reason },
				strikes8: market.strikes.map(String),
				implementation: market.implementation.info?.name ?? null,
			};
		}
		console.log("RESULT:" + JSON.stringify(out));
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: new URL("../../..", import.meta.url).pathname,
		env: {
			...process.env,
			DATABASE_URL: "postgresql://localhost/offline",
			DIRECT_DATABASE_URL: "",
			OPENROUTER_API_KEY: "offline-test",
			SKIP_ENV_VALIDATION: "1",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	if (child.exitCode !== 0) throw new Error(`${child.stderr.toString()}\n${out}`);
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("RESULT:".length)) as Probe;
}

/** One spawn for the whole file; each test still asserts only its own case. */
let cached: Probe | null = null;
const measured = (): Probe => (cached ??= probe());

/** 8-decimal integer string -> decimal string, the conversion `decimalFromUsd8` performs. */
function fromUsd8(value: string): string {
	const negative = value.startsWith("-");
	const digits = (negative ? value.slice(1) : value).padStart(9, "0");
	const fraction = digits.slice(-8).replace(/0+$/, "");
	return `${negative ? "-" : ""}${digits.slice(0, -8)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * The premium in 8-decimal USD, recomputed here from base units.
 *
 * Every collateral in these cases is a 1-USD peg (`COLLATERAL_USD_SOURCES`), so
 * one token is 100000000 at 8 decimals and the conversion is a rescale.
 */
function premiumUsd8(premiumBaseUnits: string, collateralDecimals: number): bigint {
	return (BigInt(premiumBaseUnits) * 100_000_000n) / 10n ** BigInt(collateralDecimals);
}

/** THE PIN. Whatever the ticket says, the agent says — same order, same budget. */
function pinnedToTicket(row: Case): void {
	if (!row.quote.ok) throw new Error(`the ticket refused: ${row.quote.code}`);
	expect(row.tool.risk.maxPayoutUsd).toBe(row.quote.maxPayoutUsd8 === null ? null : fromUsd8(row.quote.maxPayoutUsd8));
	expect(row.tool.risk.breakEvenUsd).toBe(row.quote.breakEvenUsd8 === null ? null : fromUsd8(row.quote.breakEvenUsd8));
	// Both surfaces sized the SAME fill, or the comparison above would be vacuous.
	expect(row.tool.raw.numContracts).toBe(row.quote.numContracts);
}

test("a long call: the ticket's break-even, and no maximum payout because there is none", () => {
	const row = measured().longCall;
	console.log("LONG_CALL", JSON.stringify(row));
	expect(row.implementation).toBe("LINEAR_CALL");
	expect(row.tool.side).toBe("buy");
	pinnedToTicket(row);

	// A call you buy has unbounded upside: `risk.ts` returns null, and the result
	// must say UNCAPPED rather than leave the model to read null as "unknown".
	expect(row.tool.risk.maxPayoutUsd).toBeNull();
	expect(row.tool.risk.unavailable).toContain("uncapped");
	expect(row.tool.risk.unavailable).not.toContain("not computed yet");

	// Second means: break-even = strike + premium per contract, computed here.
	const strike = BigInt(row.strikes8[0] as string);
	const perContract =
		(premiumUsd8(row.tool.raw.premium, row.tool.raw.collateralDecimals) *
			10n ** BigInt(row.tool.contractSizeDecimals)) /
		BigInt(row.tool.raw.numContracts);
	expect(row.tool.risk.breakEvenUsd).toBe(fromUsd8((strike + perContract).toString()));
}, TIMEOUT_MS);

test("a long put: both figures, equal to the ticket's", () => {
	const row = measured().longPut;
	console.log("LONG_PUT", JSON.stringify(row));
	expect(row.implementation).toBe("PUT");
	expect(row.tool.side).toBe("buy");
	pinnedToTicket(row);
	expect(row.tool.risk.maxPayoutUsd).not.toBeNull();
	expect(row.tool.risk.breakEvenUsd).not.toBeNull();
	// Nothing is unavailable, so nothing claims to be.
	expect(row.tool.risk.unavailable).toBeUndefined();

	// Second means: a long put's break-even is the strike MINUS the premium per
	// contract, and its payout is strike x contracts minus the premium.
	const strike = BigInt(row.strikes8[0] as string);
	const contracts = BigInt(row.tool.raw.numContracts);
	const scale = 10n ** BigInt(row.tool.contractSizeDecimals);
	const premium = premiumUsd8(row.tool.raw.premium, row.tool.raw.collateralDecimals);
	expect(row.tool.risk.breakEvenUsd).toBe(fromUsd8((strike - (premium * scale) / contracts).toString()));
	expect(row.tool.risk.maxPayoutUsd).toBe(fromUsd8(((strike * contracts) / scale - premium).toString()));
}, TIMEOUT_MS);

test("a call spread: the payout is the width minus the premium, and the ticket agrees", () => {
	const row = measured().callSpread;
	console.log("CALL_SPREAD", JSON.stringify(row));
	expect(row.implementation).toBe("CALL_SPREAD");
	pinnedToTicket(row);
	expect(row.tool.risk.unavailable).toBeUndefined();

	// Second means: width x contracts, less the premium.
	const [low, high] = row.strikes8.map(BigInt) as [bigint, bigint];
	const contracts = BigInt(row.tool.raw.numContracts);
	const scale = 10n ** BigInt(row.tool.contractSizeDecimals);
	const premium = premiumUsd8(row.tool.raw.premium, row.tool.raw.collateralDecimals);
	expect(row.tool.risk.maxPayoutUsd).toBe(fromUsd8((((high - low) * contracts) / scale - premium).toString()));
	// A capped payout is a real number, not a null dressed as one.
	expect(Number(row.tool.risk.maxPayoutUsd)).toBeGreaterThan(0);
}, TIMEOUT_MS);

test("a structure with no payoff model reports both as unavailable, and says why", () => {
	const row = measured().ranger;
	console.log("RANGER", JSON.stringify(row));
	expect(row.implementation).toBe("RANGER");
	// The ticket has no figures for it either: one model, one answer.
	pinnedToTicket(row);
	expect(row.tool.risk.maxPayoutUsd).toBeNull();
	expect(row.tool.risk.breakEvenUsd).toBeNull();
	expect(row.tool.risk.unavailable).toContain("no payoff model");
	// Not the uncapped-call wording: these are opposite facts.
	expect(row.tool.risk.unavailable).not.toContain("uncapped");
}, TIMEOUT_MS);

test("a collateral with no USD source reports nulls and names the missing price", () => {
	const row = measured().noUsdPrice;
	console.log("NO_USD_PRICE", JSON.stringify(row));
	// The ticket refuses this order outright, for the same reason.
	expect(row.quote.ok).toBe(false);
	if (row.quote.ok) throw new Error("expected a refusal");
	expect(row.quote.code).toBe("COLLATERAL_USD_UNAVAILABLE");

	expect(row.tool.risk.maxPayoutUsd).toBeNull();
	expect(row.tool.risk.breakEvenUsd).toBeNull();
	expect(row.tool.risk.maxLossUsd).toBeNull();
	expect(String(row.tool.risk.unavailable)).toContain("cbXRP");
	expect(String(row.tool.risk.unavailable)).toContain("USD");
	// And the trade is refused, not silently sized: no USD price, no risk limit.
	expect(row.tool.executable).toBe(false);
}, TIMEOUT_MS);

/**
 * The taker-SELL side, and the two DIFFERENT quantities called "max loss".
 *
 * `sizeFill`'s `maxLoss` is the COLLATERAL that leaves the wallet, in collateral
 * tokens. `riskOutputs`' `maxLossUsd8` is the NET figure — that collateral minus
 * the premium the seller keeps — in USD. The preview reports the first and is
 * left alone by this build; only payout and break-even come from the model.
 */
test("a taker sell: payout and break-even come from the model, the collateral figure does not", () => {
	const row = measured().shortPut;
	console.log("SHORT_PUT", JSON.stringify(row));
	expect(row.implementation).toBe("PHYSICAL_PUT");
	expect(row.tool.side).toBe("sell");
	pinnedToTicket(row);

	if (!row.quote.ok) throw new Error("expected a quote");
	// The collateral the taker locks, unchanged, in collateral tokens. On a 1-USD peg
	// the USD figure beside it is the same number.
	const collateral = row.tool.risk.maxLoss;
	expect(collateral.token).toBe("aBasUSDC");
	expect(row.tool.risk.maxLossUsd).toBe(collateral.amount);

	// The model's max loss is a DIFFERENT quantity: that collateral MINUS the premium
	// the seller keeps. Exactly, in 8-decimal USD, with no tolerance.
	const collateralUsd8 = premiumUsd8(String(row.tool.raw.collateralRequired), row.tool.raw.collateralDecimals);
	const keptUsd8 = premiumUsd8(
		(BigInt(row.tool.raw.premium) - BigInt(row.tool.raw.feeEstimate)).toString(),
		row.tool.raw.collateralDecimals,
	);
	expect(BigInt(row.quote.maxLossUsd8 as string)).toBe(collateralUsd8 - keptUsd8);
	// So the two must not be printed under one name.
	expect(keptUsd8).toBeGreaterThan(0n);
	expect(fromUsd8(row.quote.maxLossUsd8 as string)).not.toBe(row.tool.risk.maxLossUsd);

	// A short put's payout is capped at the premium received.
	expect(row.tool.risk.maxPayoutUsd).toBe(fromUsd8(row.quote.premiumUsd8 as string));
}, TIMEOUT_MS);
