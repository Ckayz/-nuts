/// <reference types="bun" />
/**
 * m6 — the agent contradicted the market page.
 *
 * Measured on the live book 2026-09-06 (fold-final-D §14, re-measured here and
 * against a fake book): `searchOptionBookOrders` defaulted `limit` to 6 and
 * returned the first six of 26 matching ETH call spreads. The 2450/2500 spread
 * sat at index 9, quoted and selectable on `/m/eth` at that moment, and the
 * agent told the user it "is not on the Thetanuts orderbook right now".
 *
 * The page cap is the owner's number and is untouched. What these tests pin is
 * that the page ANNOUNCES itself as a page (`truncated`, and a note that says a
 * page is not evidence of absence), and that a named structure can be looked up
 * directly by its strikes instead of being paged for.
 *
 * WHY A SUBPROCESS (fold-final-F-2). `lib/thetanuts/orders.ts:9` holds ONE
 * module-level snapshot cache with a 20 s TTL, and `getOrderSnapshot()` without
 * `force` reads it. Driving the tool through a fake book necessarily leaves that
 * cache holding the fake book, and `lib/thetanuts/orders.test.ts:91` does an
 * UNFORCED read that expects its own three rows. In bun's default file order
 * this file happened to run second and nothing showed; `scripts/verify.ts`
 * passes an explicit SORTED file list in offline mode, `lib/agent/...` sorts
 * before `lib/thetanuts/...`, and the other file then read THIS file's 201-row
 * snapshot:
 *
 *   $ bun test ./src/lib/agent/tools-page.test.ts ./src/lib/thetanuts/orders.test.ts
 *   (fail) snapshot uses SDK methods, ... caches and deduplicates
 *   Expected length: 3   Received length: 201
 *
 * MEASURED, and it corrects the diagnosis this fix was asked for: the cause is
 * the cache, NOT `mock.module`. Removing this file's `mock.module("server-only")`
 * left the failure identical (`Received length: 201`); leaving `mock.module` in
 * and re-priming the cache with a 26-row book instead changed the failure to
 * `Received length: 26`, tracking the cache exactly. There is no seam to inject
 * a book through — `searchOptionBookOrders.execute` reaches `searchOrders` ->
 * `getOrderSnapshot()` with nothing in between — so the book-driven cases run in
 * a child process, the shape `page-data.wiring.test.ts` and `site-origin.test.ts`
 * use. A child shares no module state with this one, so no ordering can matter.
 *
 * `mock.module("server-only")` is gone from this file as well: `test/setup.ts`
 * already stubs that specifier for every suite through a bun plugin.
 */
import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://localhost/offline";
process.env.OPENROUTER_API_KEY ??= "offline-test";

/** These two read no book, so they stay in-process. */
const { searchOptionBookOrders, normalizeStrikes } = await import("./tools");

const TIMEOUT_MS = 60_000;

interface Search {
	readonly totalMatched: number;
	readonly returned: number;
	readonly truncated: boolean;
	readonly note?: string;
	readonly strikes: string[][];
}
interface Probe {
	readonly book26: { total: number; indexOfAsked: number };
	readonly page: Search;
	readonly exact: Search;
	readonly loose: Search;
	readonly absent: Search;
	readonly partialTotal: number;
	readonly partial: Search;
}

/**
 * One child, every book-driven case, one JSON line back.
 *
 * The SDK boundary is overwritten on the real module inside the child
 * (`rawOrderApi.request`, `readClient.api.getMarketData`) rather than stubbed,
 * so `getOrderSnapshot` -> `deriveMarkets` -> `toTradeable` -> the tool is all
 * production code; only the bytes the feed would have returned are ours. The
 * child asserts nothing: every assertion is below, in a named test.
 */
function probe(): Probe {
	const script = `
		import { plugin } from "bun";
		plugin({ name: "tools-page-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
		}});

		const orders = await import("@/lib/thetanuts/orders");
		const { searchOptionBookOrders } = await import("@/lib/agent/tools");
		const CTX = { toolCallId: "test", messages: [], context: {} };
		const PRICES = { prices: { ETH: 0, BTC: 0, SOL: 0, XRP: 0, BNB: 0, AVAX: 0 },
			metadata: { lastUpdated: 0, currentTime: 0 } };
		/** Base mainnet ETH feed, read from the SDK's own buildPriceFeedSymbolMap(8453). */
		const ETH_FEED = "0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70";
		/** SPREAD, two strikes - the same implementation the existing multi-leg tests use. */
		const SPREAD = "0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134";
		const A = (digit) => "0x" + digit.repeat(40);
		const E8 = (usd) => BigInt(usd) * 100000000n;

		/** One ETH taker-BUY call spread on the given strikes (1e8 units), unique per index. */
		function spread(index, lowE8, highE8) {
			const expiry = BigInt(Math.floor(Date.now() / 1000) + 10000 + index);
			const collateral = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
			const rawApiData = { collateral, priceFeed: ETH_FEED, implementation: SPREAD,
				strikes: [lowE8.toString(), highE8.toString()], isCall: true, isLong: false,
				orderExpiryTimestamp: Number(expiry), extraOptionData: "0x", maxCollateralUsable: "22000000000" };
			return { signature: "0x12",
				order: { ...rawApiData, maker: A("1"), price: "212682750", expiry: Number(expiry) } };
		}
		/** The measured book shape: the asked-for 2450/2500 at index 9, nothing else near it. */
		function book26() {
			const rows = [];
			for (let i = 0; i < 26; i += 1) {
				rows.push(i === 9 ? spread(i, E8(2450), E8(2500)) : spread(i, E8(2600 + i * 10), E8(2650 + i * 10)));
			}
			return rows;
		}
		async function withBook(rows, run) {
			orders.rawOrderApi.request = async () => ({ data: { orders: rows } });
			orders.readClient.api.getMarketData = async () => PRICES;
			const snapshot = await orders.getOrderSnapshot(true);
			if (orders.isFeedUnavailable(snapshot)) throw new Error("unexpected " + snapshot.error);
			return await run(snapshot);
		}
		const shape = (r) => ({ totalMatched: r.totalMatched, returned: r.returned,
			truncated: r.truncated, note: r.note, strikes: (r.orders ?? []).map((o) => o.strikesUsd) });

		const out = {};
		await withBook(book26(), async (snapshot) => {
			out.book26 = { total: snapshot.orders.length,
				indexOfAsked: snapshot.orders.findIndex((o) => o.strikesUsd.join("/") === "2450/2500") };
			out.page = shape(await searchOptionBookOrders.execute(
				{ limit: 6, asset: "ETH", direction: "call", kind: "multi_leg" }, CTX));
			out.exact = shape(await searchOptionBookOrders.execute(
				{ limit: 6, asset: "ETH", direction: "call", kind: "multi_leg", strikesUsd: ["2450", "2500"] }, CTX));
			// The user types the legs in the other order, with trailing zeros: same instrument.
			out.loose = shape(await searchOptionBookOrders.execute(
				{ limit: 6, asset: "ETH", strikesUsd: ["2500.00", "2450"] }, CTX));
			// A structure the book really does not have, over a COMPLETE search.
			out.absent = shape(await searchOptionBookOrders.execute(
				{ limit: 6, asset: "ETH", strikesUsd: ["9999"] }, CTX));
		});

		// 201 rows: the tool asks the adapter for 200, so the page it filters is SHORTER
		// than the matching set and the asked strikes sit on the row it cannot reach.
		const many = [];
		for (let i = 0; i < 200; i += 1) many.push(spread(i, E8(3000 + i), E8(3050 + i)));
		many.push(spread(200, E8(2450), E8(2500)));
		await withBook(many, async (snapshot) => {
			out.partialTotal = snapshot.orders.length;
			out.partial = shape(await searchOptionBookOrders.execute(
				{ limit: 6, asset: "ETH", strikesUsd: ["2450", "2500"] }, CTX));
		});

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

test("normalizeStrikes: trailing zeros and leg order do not change a strike set", () => {
	expect(normalizeStrikes(["2450", "2500"])).toBe(normalizeStrikes(["2500.00000000", "2450.0"]));
	expect(normalizeStrikes(["02450"])).toBe(normalizeStrikes(["2450"]));
	// Different strikes stay different: this is exact equality, not a tolerance.
	expect(normalizeStrikes(["2450"])).not.toBe(normalizeStrikes(["2451"]));
	expect(normalizeStrikes(["2450", "2500"])).not.toBe(normalizeStrikes(["2450"]));
	expect(normalizeStrikes(["2450.5"])).not.toBe(normalizeStrikes(["2450"]));
});

test("m6: a 6-of-26 page says it is a page, and the denied spread is not in it", () => {
	const { book26, page } = measured();
	console.log("M6_BOOK", JSON.stringify(book26));
	console.log("M6_PAGE", JSON.stringify(page));
	expect(book26).toEqual({ total: 26, indexOfAsked: 9 });
	expect(page.totalMatched).toBe(26);
	expect(page.returned).toBe(6);
	// The bug's shape: the asked structure really is absent from the six shown.
	expect(page.strikes.some((s) => s.join("/") === "2450/2500")).toBe(false);
	// ...so the result has to say, in the result itself, that this proves nothing.
	expect(page.truncated).toBe(true);
	expect(String(page.note)).toContain("one page");
	expect(String(page.note)).toContain("6 of 26");
}, TIMEOUT_MS);

test("m6: the named structure is looked up directly, whatever page it would have been on", () => {
	const { exact, loose, absent } = measured();
	console.log("M6_EXACT", JSON.stringify(exact));
	console.log("M6_ABSENT", JSON.stringify(absent));
	expect(exact.totalMatched).toBe(1);
	expect(exact.returned).toBe(1);
	expect(exact.truncated).toBe(false);
	expect(exact.note).toBeUndefined();
	expect(exact.strikes).toEqual([["2450", "2500"]]);

	expect(loose.totalMatched).toBe(1);
	expect(loose.strikes).toEqual([["2450", "2500"]]);

	// A structure the book really does not have is the plain "nothing matches" note,
	// not the truncation note: the whole matching set was searched.
	expect(absent.totalMatched).toBe(0);
	expect(absent.truncated).toBe(false);
	expect(String(absent.note)).toContain("Nothing on the book");
}, TIMEOUT_MS);

test("m6: an exact lookup over an adapter page that could not cover the book refuses to call it absence", () => {
	const { partialTotal, partial } = measured();
	console.log("M6_PARTIAL", JSON.stringify(partial));
	expect(partialTotal).toBe(201);
	expect(partial.totalMatched).toBe(0);
	// Fail closed: zero hits in a partial page is an unknown, never a "no".
	expect(partial.truncated).toBe(true);
	expect(String(partial.note)).toContain("NOT evidence");
}, TIMEOUT_MS);

test("m6: the tool description and the system prompt both forbid inferring absence from a page", async () => {
	const { SYSTEM_PROMPT } = await import("./prompt");
	const description = String(searchOptionBookOrders.description);
	expect(description).toContain("truncated");
	expect(description).toContain("proves nothing about absence");
	expect(description).toContain("strikesUsd");
	expect(SYSTEM_PROMPT).toContain("truncated: true");
	expect(SYSTEM_PROMPT).toContain("NEVER evidence that an instrument is missing from the book");
});
