/**
 * I-1, item 3. THE SAME ASSERTION, ON THE LIVE BOOK.
 *
 * `lib/market/direction.test.ts` proves the mapping over fixtures. This proves
 * it end to end on a real OptionBook structure: the ticket the market page
 * builds, the refusal wording, and the side `prepareTradeFor` actually resolves
 * for a Bull press and a Bear press on a PUT — the instrument the whole fold is
 * about, because it is the one where the two words swap.
 *
 * Live, so it needs `DATABASE_URL` and the order feed. It signs nothing and
 * sends nothing: a fresh random wallet has no allowance, so preparation stops at
 * the approval stage and no transaction is ever broadcast (the same fence
 * `record.integration.test.ts` relies on).
 */
import { randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { db } from "@nuts/db";
import { positions } from "@nuts/db/schema/index";
import { eq, sql } from "drizzle-orm";
import { createOrFetchUser } from "@/lib/auth/store";
import { sideWord } from "@/lib/market/direction";
import { getLiveMarkets, sideNoteFor, type LiveStructure } from "@/lib/market/live";
import { positionDirection } from "@/lib/position/lifecycle";
import { directionOfSide, quoteView, takerForSide } from "./view";
import { prepareTradeFor } from "./prepare";

const databaseUrl = process.env.DATABASE_URL;
const describeLive = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
	console.log("direction integration skipped: DATABASE_URL is not set");
}

describeLive("I-1: Bull and Bear on a LIVE put", () => {
	test("the Bull button sells the put and the Bear button buys it, all the way into prepareTrade", async () => {
		const book = await getLiveMarkets();
		if ("error" in book) throw new Error(book.detail);

		// A single-strike put the book can actually be taken on. `riskKind` is the
		// structure's own classification, not a name match.
		const put: LiveStructure | undefined = book.assets
			.flatMap((asset) => asset.structures)
			.find(
				(candidate) =>
					candidate.riskKind === "put" &&
					candidate.isCall === false &&
					candidate.buy !== null &&
					candidate.collateralDecimals === 6,
			);
		if (put === undefined) throw new Error("no takeable single-strike put on the book");
		console.log(
			`[live put] ${put.asset} ${put.productType} ${put.strikesUsd.join("/")} id=${put.id} buy=${put.buy !== null} sell=${put.sell !== null}`,
		);

		// 1. THE MAPPING, on this real structure.
		expect(takerForSide(put, "bull")).toBe("sell");
		expect(takerForSide(put, "bear")).toBe("buy");
		expect(sideWord(put, "buy")).toBe("Bear");
		expect(sideWord(put, "sell")).toBe("Bull");
		expect(directionOfSide(put, "buy")).toBe("bear");

		// 2. THE POSITION each press produces carries the press's own word — read
		//    from `positionDirection`, which is what `/p/<id>`, the share card and
		//    the OG image print.
		for (const side of ["bull", "bear"] as const) {
			expect(positionDirection({ isCall: put.isCall, takerSide: takerForSide(put, side) })).toBe(side);
		}

		// 3. THE SENTENCE the ticket shows, from the real structure.
		const refused = { ok: false as const, code: "NOT_QUOTED", reason: "x" };
		const bearNote = sideNoteFor(put, "buy", refused);
		const bullNote = sideNoteFor(put, "sell", refused);
		console.log(`[bear note] ${bearNote}`);
		console.log(`[bull note] ${bullNote}`);
		expect(bearNote.startsWith(`Bear buys the ${put.asset} `)).toBe(true);
		expect(bearNote).toContain("pays premium");
		expect(bullNote.startsWith(`Bull sells the ${put.asset} `)).toBe(true);
		expect(bullNote).toContain("posts collateral");

		// 4. THE TICKET VIEW the browser renders for a Bear press: taker BUY.
		const view = quoteView({ structure: put, side: "bear", quote: refused, budgetInput: "10" });
		expect(view.side).toBe("bear");
		expect(view.taker).toBe("buy");
		expect(view.sideNote).toBe(bearNote);

		// 5. PREPARE, the money path. The Bull press asks for the taker SELL side.
		//    On a book that only quotes the buy side of this put that refusal names
		//    the BULL button — before this fold the same press named Bull and built
		//    a taker BUY.
		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await createOrFetchUser(db, wallet);
		const session = { userId: user.id, walletAddress: wallet };

		const bull = await prepareTradeFor(session, {
			structureId: put.id,
			side: "bull",
			taker: takerForSide(put, "bull"),
			budgetInput: "10",
		});
		console.log(`[prepare bull] ${JSON.stringify(bull.ok ? { ok: true, stage: bull.stage } : bull)}`);
		if (put.sell === null) {
			expect(bull).toMatchObject({ ok: false, code: "NO_ORDER_ON_SIDE" });
			expect((bull as { reason: string }).reason).toContain("so the Bull side cannot be filled");
			expect((bull as { reason: string }).reason).toContain("No maker is buying");
		}

		const bear = await prepareTradeFor(session, {
			structureId: put.id,
			side: "bear",
			taker: takerForSide(put, "bear"),
			budgetInput: "10",
		});
		console.log(`[prepare bear] ${JSON.stringify(bear.ok ? { ok: true, stage: bear.stage } : bear)}`);
		// A fresh wallet holds no collateral allowance, so the honest outcomes are
		// the approval stage or a quote-level refusal. What must never happen is
		// the pre-fold behaviour: the Bear press reaching the SELL side.
		if (!bear.ok) {
			expect(bear.code).not.toBe("TAKER_SIDE_CONTRADICTION");
			expect(bear.reason).not.toContain("No maker is buying this structure");
		}

		// Nothing was written by either press.
		const rows = await db
			.select({ total: sql<string>`count(*)` })
			.from(positions)
			.where(eq(positions.userId, user.id));
		expect(rows[0]?.total).toBe("0");
	}, 120_000);

	test("a request that names no taker keeps the LEGACY mapping — the agent's path is untouched", async () => {
		const book = await getLiveMarkets();
		if ("error" in book) throw new Error(book.detail);
		const put = book.assets
			.flatMap((asset) => asset.structures)
			.find((candidate) => candidate.riskKind === "put" && candidate.buy !== null && candidate.sell === null);
		if (put === undefined) throw new Error("no buy-only put on the book");

		const wallet = `0x${randomBytes(20).toString("hex")}`;
		const user = await createOrFetchUser(db, wallet);
		// `lib/agent/execute.ts:205` sends exactly this shape: a hardcoded
		// `side: "bull"` that has always meant "prepare a taker BUY", after the
		// agent has refused every order whose own side is not `buy`. It must still
		// reach the BUY side — the side the agent priced and limit-checked.
		const agentShaped = await prepareTradeFor(
			{ userId: user.id, walletAddress: wallet },
			{ structureId: put.id, side: "bull", budgetInput: "10" },
		);
		console.log(
			`[prepare agent-shaped] ${JSON.stringify(agentShaped.ok ? { ok: true, stage: agentShaped.stage } : agentShaped)}`,
		);
		expect(agentShaped).not.toMatchObject({ code: "NO_ORDER_ON_SIDE" });
	}, 120_000);
});
