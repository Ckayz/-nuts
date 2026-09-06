/**
 * Turning the two machine strings the agent surface carries — an
 * `instrumentKey` and an instant — into something a person can read before
 * they approve anything.
 *
 * WHY IT IS A MODULE AND NOT A HELPER IN THE CARD (T-2, T-5, Opus user-flow
 * tester). Two surfaces need the same two answers: the OptionBook approval card
 * (`trade-approval.tsx`), which had the whole instrument in hand and printed
 * only `Market ETH` and an unlabelled `10`, and the RFQ cards
 * (`rfq-approval.tsx`, `rfq-execution.tsx`), which printed a raw ISO timestamp
 * on the surface a first-time user reads. Pure, exported and tested, because
 * every claim here is a claim about what a user is being asked to sign for.
 *
 * NOTHING IS GUESSED. The key's own grammar is
 * `lib/thetanuts/instrument.ts:14-24`; the strike scale is the book's own
 * (`lib/thetanuts/orders.ts:62` — `decimalString(strike, 100_000_000n)`); the
 * collateral symbols are the SDK's `chainConfig.tokens` on Base, pinned by
 * `instrument-label.test.ts`, which reads that map and fails when the two
 * disagree. An address this file cannot name prints no symbol at all rather
 * than a plausible one.
 */

/** Base mainnet. The app is Base-only (`lib/wagmi.ts`). */
export const COLLATERAL_CHAIN_ID = 8453 as const;

/**
 * Collateral address -> symbol, lowercase keys.
 *
 * MEASURED from `createReadClient(...).chainConfig.tokens` (SDK
 * `@thetanuts-finance/thetanuts-client@0.3.0`, chain 8453) on 2026-09-06, and
 * kept honest by the test beside this file rather than by this comment. It is
 * copied rather than imported because the SDK is a server module: pulling it
 * into a client component to name a token would ship ethers and viem to the
 * browser.
 */
export const COLLATERAL_SYMBOLS: Readonly<Record<string, string>> = {
	"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
	"0x4200000000000000000000000000000000000006": "WETH",
	"0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "cbBTC",
	"0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7": "aBasWETH",
	"0xbdb9300b7cde636d9cd4aff00f6f009ffbbc8ee6": "aBascbBTC",
	"0x4e65fe4dba92790696d040ac24aa414708f5c0ab": "aBasUSDC",
	"0x73c7a9c372f31c1b1c7f8e5a7d12b8735c817c79": "cbDOGE",
	"0x7b2cd9ea5566c345c9cdbcf58f5e211a0db47444": "cbXRP",
};

/** The token this address is, or null. Never a fallback symbol. */
export function collateralSymbol(address: string | null | undefined): string | null {
	if (typeof address !== "string") return null;
	const key = address.trim().toLowerCase();
	if (!Object.hasOwn(COLLATERAL_SYMBOLS, key)) return null;
	return COLLATERAL_SYMBOLS[key] ?? null;
}

/**
 * An integer string divided by `10 ** decimals`, with no float anywhere.
 *
 * The same rule the book uses to print a strike (`orders.ts:62`), and the same
 * reason money never crosses a boundary as a number in this app (PRD 10.3).
 * Trailing zeros are dropped, so `220000000000` reads `2200`, not
 * `2200.00000000`.
 */
export function decimalFromScaled(raw: string, decimals: number): string | null {
	if (!/^\d+$/.test(raw) || decimals < 0) return null;
	if (decimals === 0) return raw.replace(/^0+(?=\d)/, "");
	const padded = raw.padStart(decimals + 1, "0");
	const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "");
	const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
	return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** The book's strike scale: 8 decimals (`orders.ts:62`). */
export const STRIKE_DECIMALS = 8;

/** One strike from the key, in USD. */
export function strikeUsd(raw: string): string | null {
	return decimalFromScaled(raw, STRIKE_DECIMALS);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * TODO-OWNER: how an expiry reads on a money card.
 *
 * Built from the UTC getters by hand rather than through `Intl`: this string is
 * rendered on the server AND in the browser, and two ICU builds can format the
 * same instant differently, which is a hydration mismatch on an approval card.
 * UTC is stated because settlement is a UTC instant and a reader in +08 must
 * not read it as local.
 */
export function formatUtcInstant(at: Date): string | null {
	const ms = at.getTime();
	if (!Number.isFinite(ms)) return null;
	const day = String(at.getUTCDate()).padStart(2, "0");
	const month = MONTHS[at.getUTCMonth()];
	if (month === undefined) return null;
	const hour = String(at.getUTCHours()).padStart(2, "0");
	const minute = String(at.getUTCMinutes()).padStart(2, "0");
	return `${day} ${month} ${at.getUTCFullYear()}, ${hour}:${minute} UTC`;
}

/** The same, from the ISO instant the server hands the cards. Null if unreadable. */
export function formatUtcIso(iso: string | null | undefined): string | null {
	if (typeof iso !== "string" || iso === "") return null;
	const at = new Date(iso);
	return Number.isNaN(at.getTime()) ? null : formatUtcInstant(at);
}

/** The same, from the unix seconds the instrument key carries. */
export function formatUtcSeconds(seconds: number): string | null {
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	return formatUtcInstant(new Date(seconds * 1000));
}

/** What an `instrumentKey` says, once decoded. Any field can be absent. */
export interface InstrumentDescription {
	/** The underlying, e.g. "ETH". Null when the key carries the book's own "?". */
	readonly asset: string | null;
	/** Which side of the BOOK this order is, as `instrumentKey` records it. */
	readonly side: "buy" | "sell" | null;
	readonly right: "call" | "put" | null;
	/** USD strikes, in the key's own order. */
	readonly strikesUsd: readonly string[];
	/** The option's expiry, formatted; null when the key's field is not a time. */
	readonly expiryAt: string | null;
	/** The collateral token's symbol, or null when this file cannot name it. */
	readonly collateralSymbol: string | null;
}

/**
 * Decode an `instrumentKey`.
 *
 * The grammar is `lib/thetanuts/instrument.ts:14-24`:
 * `asset|side|collateral|C or P|strikes joined by "/"|expiry|implementation`.
 * A key that is not exactly seven fields is not one of ours, and answers null
 * rather than a partly-invented description.
 */
export function describeInstrumentKey(key: string | null | undefined): InstrumentDescription | null {
	if (typeof key !== "string" || key === "") return null;
	const parts = key.split("|");
	if (parts.length !== 7) return null;
	const [asset, side, collateral, right, strikes, expiry] = parts as [
		string,
		string,
		string,
		string,
		string,
		string,
		string,
	];
	const decoded = strikes
		.split("/")
		.map((raw) => strikeUsd(raw))
		.filter((value): value is string => value !== null);
	const seconds = Number(expiry);
	return {
		asset: asset === "" || asset === "?" ? null : asset,
		side: side === "buy" || side === "sell" ? side : null,
		right: right === "C" ? "call" : right === "P" ? "put" : null,
		strikesUsd: decoded,
		expiryAt: /^\d+$/.test(expiry) ? formatUtcSeconds(seconds) : null,
		collateralSymbol: collateralSymbol(collateral),
	};
}
