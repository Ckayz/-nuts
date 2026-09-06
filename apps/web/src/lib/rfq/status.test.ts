/**
 * `rfqStatusFor`, driven as a table of timestamps. Pure and offline.
 *
 * The live reveal window on Base was 60 seconds when this was written
 * (`optionFactory.getRevealWindow()` on the OptionFactory
 * `0x8118daD971dEbffB49B9280047659174128A8B94`, read 2026-09-06). Nothing here
 * depends on that value — it is passed in — but the fixtures use it so the
 * arithmetic is legible.
 */
import { describe, expect, test } from "bun:test";
import { rfqStatusFor, type RfqChainView, type RfqIndexerView, type RfqStatusRow } from "./status";

const OFFER_END = 1_788_600_000;
const REVEAL = 60;
const WINNER = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const OPTION = "0x4444444444444444444444444444444444444444";

const at = (unix: number) => new Date(unix * 1000);

const row = (over: Partial<RfqStatusRow> = {}): RfqStatusRow => ({
	status: "active",
	quotationId: "125",
	offerEndTimestamp: OFFER_END,
	expiryTimestamp: OFFER_END + 86_400,
	...over,
});

const chain = (over: Partial<RfqChainView> = {}): RfqChainView => ({
	isActive: true,
	currentWinner: ZERO,
	optionContract: ZERO,
	offerEndTimestamp: OFFER_END,
	...over,
});

const indexer = (over: Partial<RfqIndexerView> = {}): RfqIndexerView => ({
	status: "active",
	offerEndTimestamp: OFFER_END,
	currentBestPrice: "1000000",
	...over,
});

const call = (input: {
	row?: RfqStatusRow;
	chain?: RfqChainView | null;
	indexer?: RfqIndexerView | null;
	revealWindowSeconds?: number | null;
	now: number;
}) =>
	rfqStatusFor({
		row: input.row ?? row(),
		indexer: input.indexer === undefined ? null : input.indexer,
		chain: input.chain === undefined ? chain() : input.chain,
		revealWindowSeconds: input.revealWindowSeconds === undefined ? REVEAL : input.revealWindowSeconds,
		now: at(input.now),
	});

describe("rfqStatusFor, on the clock", () => {
	test.each([
		["one second before the offer deadline", OFFER_END - 1, "waiting_for_offers", "cancel"],
		["exactly at the offer deadline", OFFER_END, "reveal_window", "wait"],
		["inside the reveal window", OFFER_END + REVEAL - 1, "reveal_window", "wait"],
		["exactly at the end of the reveal window", OFFER_END + REVEAL, "reveal_window", "wait"],
	])("%s is %s / %s", (_name, now, status, nextAction) => {
		const view = call({ now: now as number });
		expect(view.status).toBe(status as never);
		expect(view.nextAction).toBe(nextAction as never);
	});

	test("after the reveal window with a winner it is ready to settle", () => {
		const view = call({ chain: chain({ currentWinner: WINNER }), now: OFFER_END + REVEAL + 1 });
		expect(view.status).toBe("ready_to_settle");
		expect(view.nextAction).toBe("settle");
		expect(view.hasWinner).toBe(true);
		expect(view.settleReadyAt).toBe(new Date((OFFER_END + REVEAL) * 1000).toISOString());
	});

	test("after the reveal window with NO winner it is unfilled and can be cancelled", () => {
		const view = call({ now: OFFER_END + REVEAL + 1 });
		expect(view.status).toBe("expired_unfilled");
		expect(view.nextAction).toBe("cancel");
		expect(view.hasWinner).toBe(false);
	});

	/**
	 * THE FAIL-CLOSED PROPERTY. `getRevealWindow()` is a chain read and it can
	 * fail. A missing window must never be treated as zero, because that would
	 * hand back "settle it now" for a request whose reveal window has not run.
	 * The mutant `revealWindowSeconds ?? 0` turns this red.
	 */
	test("an unreadable reveal window never says settle, even with a winner and a year of slack", () => {
		const view = call({
			chain: chain({ currentWinner: WINNER }),
			revealWindowSeconds: null,
			now: OFFER_END + 31_536_000,
		});
		expect(view.status).toBe("reveal_window");
		expect(view.nextAction).toBe("wait");
		expect(view.settleReadyAt).toBeNull();
		expect(view.sentence).toContain("could not be read");
	});

	test("a row with no recorded offer deadline says so instead of guessing", () => {
		const view = call({
			row: row({ offerEndTimestamp: null }),
			chain: null,
			indexer: null,
			now: OFFER_END,
		});
		expect(view.status).toBe("reveal_window");
		expect(view.nextAction).toBe("wait");
		expect(view.offerEndAt).toBeNull();
	});
});

describe("rfqStatusFor, on terminal states", () => {
	test("an inactive quotation with no option contract was cancelled", () => {
		const view = call({ chain: chain({ isActive: false }), now: OFFER_END + 10 });
		expect(view.status).toBe("cancelled");
		expect(view.nextAction).toBe("none");
	});

	test("an inactive quotation WITH an option contract settled", () => {
		const view = call({
			chain: chain({ isActive: false, optionContract: OPTION, currentWinner: WINNER }),
			now: OFFER_END + 10,
		});
		expect(view.status).toBe("settled");
		expect(view.nextAction).toBe("none");
	});

	test("a row that never reached the chain is pending_create and offers nothing to do", () => {
		const view = call({
			row: row({ status: "pending_create", quotationId: null }),
			chain: null,
			now: OFFER_END - 100,
		});
		expect(view.status).toBe("pending_create");
		expect(view.nextAction).toBe("none");
	});

	test("a failed row says the escrow never happened", () => {
		const view = call({ row: row({ status: "failed" }), chain: null, now: OFFER_END });
		expect(view.status).toBe("failed");
		expect(view.nextAction).toBe("none");
		expect(view.sentence).toContain("nothing was escrowed");
	});

	test("with no chain read the indexer decides a terminal state", () => {
		expect(call({ chain: null, indexer: indexer({ status: "settled" }), now: OFFER_END }).status).toBe("settled");
		expect(call({ chain: null, indexer: indexer({ status: "cancelled" }), now: OFFER_END }).status).toBe("cancelled");
	});

	/**
	 * C-4. "Was my money returned?" is the one axis where a guess costs the most,
	 * and this branch used to answer it for ANY value the indexer sent: anything
	 * that was neither `active` nor `settled` read as "cancelled and its escrowed
	 * deposit was returned". The SDK types the field as a plain `string`
	 * (`dist/index.d.ts:1018-1019` names three values in a comment, nothing more),
	 * so a fourth one is a shape this build has never seen — and it must say so.
	 *
	 * Mutant: fold the unknown case back into the cancelled branch.
	 */
	test("an indexer status this build does not know never claims the deposit came back", () => {
		for (const unknown of ["expired", "pending", "revealing", "UNKNOWN", ""]) {
			const view = call({ chain: null, indexer: indexer({ status: unknown }), now: OFFER_END });
			expect(view.status).toBe("unknown");
			expect(view.nextAction).toBe("none");
			expect(view.sentence).not.toContain("returned");
			expect(view.sentence).not.toContain("cancelled");
		}
	});

	/**
	 * PRECEDENCE. The chain is the factory itself and the indexer lags it, so a
	 * settled indexer row cannot override a chain that still says active.
	 */
	test("the chain beats the indexer", () => {
		const view = call({
			chain: chain(),
			indexer: indexer({ status: "settled" }),
			now: OFFER_END - 1,
		});
		expect(view.status).toBe("waiting_for_offers");
	});

	test("with neither read, our own terminal row is still honoured", () => {
		expect(call({ row: row({ status: "cancelled" }), chain: null, now: OFFER_END }).status).toBe("cancelled");
		expect(call({ row: row({ status: "settled" }), chain: null, now: OFFER_END }).status).toBe("settled");
	});

	test("a winner is read from the indexer when there is no chain view", () => {
		const view = call({
			chain: null,
			indexer: indexer({ winner: WINNER }),
			now: OFFER_END + REVEAL + 1,
		});
		expect(view.hasWinner).toBe(true);
		expect(view.status).toBe("ready_to_settle");
	});
});
