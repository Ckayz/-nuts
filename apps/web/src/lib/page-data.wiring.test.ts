/// <reference types="bun" />
import { expect, test } from "bun:test";

/**
 * B1 WIRING (fold-final-D-2). The builders were pinned; the PAGE WIRING was not.
 *
 * `live-pnl.test.ts` proves that `withCards`, `linkedPositionCard` and
 * `listRowPnl` price a card correctly WHEN a `LivePriceBook` is handed to them.
 * That is not the bug B1 was. B1 was that nobody handed them one. Claude's own
 * adversarial mutant made the point:
 *
 *   replace the body of `livePriceBook` in `lib/position/spot.ts` with
 *   `return emptyPriceBook();`
 *   -> live-pnl.test.ts, map.test.ts, lib/data/* and thesis.integration.test.ts
 *      ALL stay green (offline 32/0, live 119/0)
 *
 * because every one of them injects its own book. A regression that drops the
 * fetch would have shipped unnoticed — the exact class of defect B1 was.
 *
 * So this file exercises the REAL chain, end to end, with nothing injected:
 *
 *   page-data.ts  ->  cardPrices / rowPnl
 *                 ->  lib/position/spot.ts  livePriceBook
 *                 ->  @/lib/thetanuts/orders  getOrderSnapshot + collateralUsdPrice
 *                 ->  withCards / linkedPositionCard / display.position
 *
 * The ONLY thing stubbed is the outermost edge, `@/lib/thetanuts/orders`, so
 * `livePriceBook` runs for real against a known snapshot and makes no network
 * call. Everything between the page read and the rendered figure is production
 * code.
 *
 * WHY A SUBPROCESS. `mock.module` is process-wide in bun, and this file has to
 * stub `@/lib/thetanuts/orders` — the module `lib/thetanuts/orders.test.ts`,
 * the market suites and the agent suites all exercise for real. Stubbing it
 * in-process would silently replace it for whichever of those files happened to
 * run afterwards (see the note at the top of `src/test/trade-mocks.ts`). Each
 * case therefore runs in its own child with the stubs installed as bun plugins,
 * the same shape `site-origin.test.ts` uses.
 *
 * The assertion is an EQUALITY against `derivePnlAtSpot`, never a literal, and
 * every case first asserts the figure is not "—" so nothing can pass vacuously.
 */

const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? "";
const live = DATABASE_URL === "" ? test.skip : test;
if (DATABASE_URL === "") console.log("page-data wiring skipped: DATABASE_URL is not set");

/** Each case spawns a child that connects to Postgres and reads four pages. */
const TIMEOUT_MS = 30_000;

/** $2,480.54 — a spot the fixture's ETH 2340 put is comfortably out of the money at. */
const SPOT = 2480.54;

/**
 * The one real fill this repo has decoded bytes for: Base tx
 * `0x9c4bb145…828f8c`, taker-BUY of an ETH 2340 put, 999998 USDC premium.
 * `packages/db`'s own order-snapshot shape, so `positionInstrument` decodes it
 * exactly as it decodes a production row.
 */
const ORDER_SNAPSHOT = {
	version: 1,
	order: {
		maker: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
		taker: "0x0000000000000000000000000000000000000000",
		option: "0x96C2c0d1d1aD8Ea8483B8294B802352363b16422",
		isBuyer: true,
		numContracts: "389926",
		price: "256458427",
		expiry: "1788768000",
		nonce: "66204603414887816953614478114089474291546535720490116488777793285874330342942",
	},
	signature: "0x25",
	availableAmount: "10000000000",
	makerAddress: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
	rawApiData: {
		isCall: false,
		isLong: false,
		strikes: ["234000000000"],
		priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
		collateral: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		implementation: "0x7355EB92dfb0503DB558a70c10843618932ab290",
		extraOptionData: "0x",
		maxCollateralUsable: "10000000000",
		orderExpiryTimestamp: 1788559332,
	},
};

/**
 * Run `body` in a child with the edge stubbed and the app's own modules real.
 *
 * `cwd` is `apps/web`, so `@/…` resolves through the app's tsconfig paths
 * exactly as it does in a page render.
 */
function probe(body: string, feed: "readable" | "unusable" = "readable"): Record<string, unknown> {
	const script = `
		import { plugin } from "bun";
		const SNAPSHOT = ${JSON.stringify(ORDER_SNAPSHOT)};
		// Proves the stub is the module the app actually loaded. If the specifier
		// in lib/position/spot.ts ever stopped matching, the child would reach the
		// real feed over the network and this counter would stay 0 — so every case
		// asserts it moved, and no result is trusted without that.
		globalThis.__snapshotCalls = 0;
		plugin({ name: "wiring-probe", setup(build) {
			build.module("server-only", () => ({ exports: {}, loader: "object" }));
			// The ONE stub that matters: the outermost edge. Everything the page
			// does with what comes back is production code.
			build.module("@/lib/thetanuts/orders", () => ({ exports: {
				getOrderSnapshot: async () => (globalThis.__snapshotCalls++, ${feed === "unusable"}
					// The shape orders.ts returns when the book could not be read at
					// all. Not an empty book, and never a zero price.
					? { error: "feed_unusable", droppedEntries: 0, detail: "probe: feed unreadable" }
					: { orders: [], fetchedAt: new Date("2026-09-06T00:00:00Z"), droppedEntries: 0,
					    marketData: { ETH: ${SPOT} } }),
				isFeedUnavailable: (value) => typeof value === "object" && value !== null && "error" in value,
				collateralUsdPrice: (symbol) => (symbol === "USDC" ? 1 : null),
			}, loader: "object" }));
			// Request-scope APIs a page render supplies and a child does not.
			build.module("next/server", () => ({ exports: { connection: async () => {} }, loader: "object" }));
			build.module("next/headers", () => ({ exports: {
				headers: async () => new Map(),
				cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
			}, loader: "object" }));
			// D-R2-2: the market rail is a signed-in card, and it reads the session
			// through this specifier. The stub answers null unless a case sets
			// globalThis.__session, so every case above behaves exactly as before
			// (page-data.ts imports "./auth/session", a different specifier, and is
			// not touched by this at all).
			build.module("@/lib/auth/session", () => ({ exports: {
				getSession: async () => globalThis.__session ?? null,
			}, loader: "object" }));
		}});
		${body}
	`;
	const child = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: new URL("../..", import.meta.url).pathname,
		env: { ...process.env, DATA_SOURCE: "db", DATABASE_URL, DIRECT_DATABASE_URL: "" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = child.stdout.toString();
	if (child.exitCode !== 0) throw new Error(`${child.stderr.toString()}\n${out}`);
	const line = out.split("\n").find((part) => part.startsWith("RESULT:"));
	if (line === undefined) throw new Error(`no result:\n${out}\n${child.stderr.toString()}`);
	return JSON.parse(line.slice("RESULT:".length));
}

/**
 * Seed one user + one standalone position + one post whose text links it, then
 * read every page back through `lib/page-data.ts`. Everything is written into
 * the caller's throwaway database and deleted at the end of the child.
 */
const SEED_AND_READ = `
	const { randomUUID } = await import("node:crypto");
	const { db } = await import("@nuts/db");
	const { sql } = await import("drizzle-orm");

	const userId = randomUUID(), positionId = randomUUID(), thesisId = randomUUID();
	// Unique per run: two cases in this file, and a re-run after a crashed one,
	// must not collide on the users wallet-address unique index.
	const address = "0x" + positionId.replace(/-/g, "").slice(0, 40);
	const handle = "wiring_" + positionId.slice(0, 8);
	const slug = "wiring-" + positionId.slice(0, 8);
	const snapshot = JSON.stringify(SNAPSHOT);
	// A confirmed row must carry its decoded fill event
	// (check constraint positions_confirmed_fill_event_required). These are the
	// bytes the real Base fill emitted.
	const fillEvent = JSON.stringify({
		version: 1,
		buyer: "0xB792296bE8202ba2fc5D3276fA184e5B479920E3",
		seller: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
		sellerWasMaker: true,
		nonce: SNAPSHOT.order.nonce,
		optionAddress: SNAPSHOT.order.option,
		premiumAmount: "999998",
		feeCollected: "124999",
		referrer: "0x0000000000000000000000000000000000000000",
		referralFeePaid: "0",
	});

	await db.execute(sql\`insert into users (id, wallet_address, handle, display_name)
		values (\${userId}::uuid, \${address}, \${handle}, 'Wiring Probe')\`);
	// A standalone fill (migration 0007): role 'standalone', thesis_id null.
	await db.execute(sql\`insert into positions (
			id, thesis_id, user_id, role, side, status, chain_id, wallet_address,
			order_id, order_snapshot, fill_event, option_address, tx_hash,
			budget, budget_decimals, contracts, contract_decimals,
			premium, premium_decimals, fees, fee_decimals, collateral, collateral_decimals,
			break_even_prices, break_even_price_decimals, break_even_prices_usd,
			entry_premium_usd, maximum_loss_usd, created_at, confirmed_at)
		values (\${positionId}::uuid, null, \${userId}::uuid, 'standalone', 'back', 'confirmed', 8453, \${address},
			'wiring-order', \${snapshot}::jsonb, \${fillEvent}::jsonb, \${SNAPSHOT.order.option},
			\${"0x" + thesisId.replace(/-/g, "").repeat(2).slice(0, 64)},
			999998, 6, 389926, 6, 999998, 6, 124999, 6, 0, 6,
			'{}', 8, '{}', 0.999998, 0.999998, now(), now())\`);
	// The post is written by the product's OWN writer, so its text and slug are
	// shaped exactly as a published post's are.
	const { writePost } = await import("@/lib/thesis/publish");
	const written = await writePost(db, {
		userId,
		headline: "wiring probe " + slug,
		rationale: "See /p/" + positionId + " now",
	});
	if ("error" in written) throw new Error("writePost: " + written.error);

	try {
		// The expected figure, from the risk model, on the same instrument: an
		// EQUALITY, so this can never be a stale literal.
		const { positionInstrument } = await import("@/lib/position/instrument");
		const { derivePnlAtSpot, usd8FromSpotNumber } = await import("@/lib/position/pnl");
		const { derivationFor } = await import("@/lib/position/view");
		const instrument = positionInstrument(SNAPSHOT);
		const quantities = { contracts: "389926", contractDecimals: 6, premium: "999998",
			premiumDecimals: 6, fees: "124999", feeDecimals: 6, collateral: "0", collateralDecimals: 6 };
		const derivation = derivationFor(
			{ position: { economics: {}, status: "confirmed" }, owner: {}, instrument, quantities, thesis: null },
			usd8FromSpotNumber(1),
		);
		const expected = derivePnlAtSpot(derivation.inputs, usd8FromSpotNumber(${SPOT}));

		const pageData = await import("@/lib/page-data");
		const discover = await pageData.discoverData();
		const thread = await pageData.thesisDetailData(written.slug);
		const creator = await pageData.creatorPageData(handle);

		const cardOf = (post) => post?.tradeCards?.[0] ?? null;
		// B-P3-1: every audience now carries its own three ranked lists, so top
		// is trending/ending/settled rather than one array.
		const feedPost = [...discover.ranked.trending, ...discover.top.trending, ...discover.ranked.ending]
			.find((post) => post.slug === written.slug);

		console.log("RESULT:" + JSON.stringify({
			snapshotCalls: globalThis.__snapshotCalls,
			expected,
			asset: instrument?.asset ?? null,
			collateral: instrument?.collateralSymbol ?? null,
			feed: cardOf(feedPost) === null ? null
				: { pnl: cardOf(feedPost).pnl.raw, basis: cardOf(feedPost).basis },
			thread: cardOf(thread?.thesis) === null ? null
				: { pnl: cardOf(thread.thesis).pnl.raw, basis: cardOf(thread.thesis).basis },
			calloutCard: cardOf(creator?.callouts?.[0]) === null ? null
				: { pnl: cardOf(creator.callouts[0]).pnl.raw, basis: cardOf(creator.callouts[0]).basis },
			profileRow: creator?.positions?.[0] === undefined ? null
				: { pnl: creator.positions[0].livePnlUsd.raw, basis: creator.positions[0].basis },
		}));
	} finally {
		await db.execute(sql\`delete from activity where user_id = \${userId}::uuid\`);
		await db.execute(sql\`delete from positions where id = \${positionId}::uuid\`);
		await db.execute(sql\`delete from theses where creator_user_id = \${userId}::uuid\`);
		await db.execute(sql\`delete from users where id = \${userId}::uuid\`);
	}
	// @nuts/db opens an eager pool, whose handles keep the child alive forever.
	// The work is done and the rows are gone, so end the process deliberately.
	process.exit(0);
`;

live(
	"the REAL page reads price every card and row: feed, thread, profile callout, profile row",
	() => {
		const result = probe(SEED_AND_READ) as {
			snapshotCalls: number;
			expected: string | null;
			asset: string | null;
			collateral: string | null;
			feed: { pnl: string; basis: string } | null;
			thread: { pnl: string; basis: string } | null;
			calloutCard: { pnl: string; basis: string } | null;
			profileRow: { pnl: string; basis: string } | null;
		};

		// Guards: without these the equalities below could all hold at "—".
		// The page really consulted the (stubbed) feed — see __snapshotCalls above.
		expect(result.snapshotCalls).toBeGreaterThan(0);
		expect(result.asset).toBe("ETH");
		expect(result.collateral).toBe("USDC");
		expect(result.expected).not.toBeNull();
		expect(result.expected).not.toBe("—");

		// THE FEED. `discoverData` -> `toPosts` -> `cardPrices` -> `livePriceBook`.
		expect(result.feed).not.toBeNull();
		expect(result.feed?.pnl).toBe(result.expected!);
		expect(result.feed?.basis).toBe("derived");

		// THE THREAD. `thesisDetailData` -> `withThesisCards` -> `cardPrices`.
		expect(result.thread).not.toBeNull();
		expect(result.thread?.pnl).toBe(result.expected!);
		expect(result.thread?.basis).toBe("derived");

		// The profile's posts, the other `toPosts` caller.
		expect(result.calloutCard).not.toBeNull();
		expect(result.calloutCard?.pnl).toBe(result.expected!);
		expect(result.calloutCard?.basis).toBe("derived");

		// The LIST-ROW seam, which is a different wiring from the card seam:
		// `creatorPageData` -> `rowPnl` -> `livePriceBook` -> `listRowPnl`.
		expect(result.profileRow).not.toBeNull();
		expect(result.profileRow?.pnl).toBe(result.expected!);
		expect(result.profileRow?.basis).toBe("derived");
	},
	TIMEOUT_MS,
);

/**
 * The negative half, and the reason the positive half cannot be vacuous: with
 * the SAME wiring and a feed that reports itself unreadable, every surface goes
 * back to "—". If the page were not really consulting the feed, this could not
 * change anything.
 */
live("an unreadable feed leaves every one of those surfaces at '—'", () => {
	const result = probe(SEED_AND_READ, "unusable") as Record<string, unknown> & {
		snapshotCalls: number;
	};
	expect(result.snapshotCalls).toBeGreaterThan(0);
	for (const surface of ["feed", "thread", "calloutCard", "profileRow"] as const) {
		const cell = result[surface] as { pnl: string; basis: string } | null;
		expect(cell).not.toBeNull();
		expect(cell?.pnl).toBe("—");
		expect(cell?.basis).toBe("unavailable");
	}
}, TIMEOUT_MS);

/**
 * D-R2-2 (lane D pass 2). The market page's "Your <asset> positions" rail called
 * `display.position(row)` with NO price book, so the same confirmed fill showed
 * a derived P&L on `/p/<id>` and "not available yet" beside the ticket. The
 * portfolio and profile wiring above did not cover it: that card does its own
 * read inside the component.
 *
 * Same chain, same stubbed edge, and the assertion is again an EQUALITY against
 * `derivePnlAtSpot` — never a literal — plus the rendered markup of the ACTUAL
 * component, so a helper that computes the right number while the card ignores
 * it cannot pass.
 */
const SEED_AND_RENDER_RAIL = `
	const { randomUUID } = await import("node:crypto");
	const { db } = await import("@nuts/db");
	const { sql } = await import("drizzle-orm");

	const userId = randomUUID(), positionId = randomUUID();
	const address = "0x" + positionId.replace(/-/g, "").slice(0, 40);
	const handle = "rail_" + positionId.slice(0, 8);
	const snapshot = JSON.stringify(SNAPSHOT);
	const fillEvent = JSON.stringify({
		version: 1,
		buyer: "0xB792296bE8202ba2fc5D3276fA184e5B479920E3",
		seller: "0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E",
		sellerWasMaker: true,
		nonce: SNAPSHOT.order.nonce,
		optionAddress: SNAPSHOT.order.option,
		premiumAmount: "999998",
		feeCollected: "124999",
		referrer: "0x0000000000000000000000000000000000000000",
		referralFeePaid: "0",
	});

	await db.execute(sql\`insert into users (id, wallet_address, handle, display_name)
		values (\${userId}::uuid, \${address}, \${handle}, 'Rail Probe')\`);
	await db.execute(sql\`insert into positions (
			id, thesis_id, user_id, role, side, status, chain_id, wallet_address,
			order_id, order_snapshot, fill_event, option_address, tx_hash,
			budget, budget_decimals, contracts, contract_decimals,
			premium, premium_decimals, fees, fee_decimals, collateral, collateral_decimals,
			break_even_prices, break_even_price_decimals, break_even_prices_usd,
			entry_premium_usd, maximum_loss_usd, created_at, confirmed_at)
		values (\${positionId}::uuid, null, \${userId}::uuid, 'standalone', 'back', 'confirmed', 8453, \${address},
			'rail-order', \${snapshot}::jsonb, \${fillEvent}::jsonb, \${SNAPSHOT.order.option},
			\${"0x" + positionId.replace(/-/g, "").repeat(2).slice(0, 64)},
			999998, 6, 389926, 6, 999998, 6, 124999, 6, 0, 6,
			'{}', 8, '{}', 0.999998, 0.999998, now(), now())\`);

	// The rail renders only for a signed-in visitor; this is the ONLY thing the
	// child fakes about it.
	globalThis.__session = { userId, walletAddress: address, expiresAt: new Date(Date.now() + 3600_000) };

	try {
		const { positionInstrument } = await import("@/lib/position/instrument");
		const { derivePnlAtSpot, usd8FromSpotNumber } = await import("@/lib/position/pnl");
		const { derivationFor, listRowPnl } = await import("@/lib/position/view");
		const instrument = positionInstrument(SNAPSHOT);
		const quantities = { contracts: "389926", contractDecimals: 6, premium: "999998",
			premiumDecimals: 6, fees: "124999", feeDecimals: 6, collateral: "0", collateralDecimals: 6 };
		const derivation = derivationFor(
			{ position: { economics: {}, status: "confirmed" }, owner: {}, instrument, quantities, thesis: null },
			usd8FromSpotNumber(1),
		);
		const expected = derivePnlAtSpot(derivation.inputs, usd8FromSpotNumber(${SPOT}));

		// The countercheck the reviewer ran: the SAME row through the shared
		// valuation helper, so the string the card must print is derived, not typed.
		const { getPortfolio } = await import("@/lib/data/reads");
		const { livePriceBook } = await import("@/lib/position/spot");
		const { PNL_BASIS_SHORT, position } = await import("@/lib/display");
		const rows = await getPortfolio(address);
		const book = await livePriceBook(["ETH"], ["USDC"]);
		const counter = position(rows[0], new Date(), listRowPnl(rows[0], book));

		// The ACTUAL component, rendered.
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { YourPositionsRail } = await import("@/components/market/your-positions-rail");
		const html = renderToStaticMarkup(await YourPositionsRail({ asset: "ETH" }));

		console.log("RESULT:" + JSON.stringify({
			snapshotCalls: globalThis.__snapshotCalls,
			expected,
			rowCount: rows.length,
			counterRaw: counter.livePnlUsd.raw,
			counterBasis: counter.basis,
			railHasSigned: html.includes(counter.livePnlUsd.signed),
			railHasDerivedBasis: html.includes(PNL_BASIS_SHORT.derived),
			railHasUnavailableBasis: html.includes(PNL_BASIS_SHORT.unavailable),
			railHasCard: html.includes("Your ETH positions"),
		}));
	} finally {
		await db.execute(sql\`delete from activity where user_id = \${userId}::uuid\`);
		await db.execute(sql\`delete from positions where id = \${positionId}::uuid\`);
		await db.execute(sql\`delete from users where id = \${userId}::uuid\`);
	}
	process.exit(0);
`;

live("the market page's own positions rail prices its rows from the same book", () => {
	const result = probe(SEED_AND_RENDER_RAIL) as {
		snapshotCalls: number;
		expected: string | null;
		rowCount: number;
		counterRaw: string;
		counterBasis: string;
		railHasSigned: boolean;
		railHasDerivedBasis: boolean;
		railHasUnavailableBasis: boolean;
		railHasCard: boolean;
	};
	// Guards, so nothing below can hold vacuously.
	expect(result.snapshotCalls).toBeGreaterThan(0);
	expect(result.rowCount).toBe(1);
	expect(result.railHasCard).toBe(true);
	expect(result.expected).not.toBeNull();
	expect(result.expected).not.toBe("—");
	// The shared helper and the risk model agree...
	expect(result.counterRaw).toBe(result.expected!);
	expect(result.counterBasis).toBe("derived");
	// ...and the RENDERED card prints that figure, not "not available yet".
	expect(result.railHasSigned).toBe(true);
	expect(result.railHasDerivedBasis).toBe(true);
	expect(result.railHasUnavailableBasis).toBe(false);
}, TIMEOUT_MS);

live("an unreadable feed leaves the market rail at 'not available yet'", () => {
	const result = probe(SEED_AND_RENDER_RAIL, "unusable") as {
		snapshotCalls: number;
		railHasDerivedBasis: boolean;
		railHasUnavailableBasis: boolean;
		railHasCard: boolean;
	};
	expect(result.snapshotCalls).toBeGreaterThan(0);
	expect(result.railHasCard).toBe(true);
	expect(result.railHasDerivedBasis).toBe(false);
	expect(result.railHasUnavailableBasis).toBe(true);
}, TIMEOUT_MS);
