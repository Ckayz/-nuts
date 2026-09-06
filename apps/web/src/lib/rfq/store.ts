import "server-only";

/**
 * Every `rfq_requests` read and write this app makes, behind one interface.
 *
 * WHY IT IS A SEAM. `lib/rfq/prepare.ts` is the money path, and its fences —
 * the ticket binding, the receipt checks, the "only bind a row that is still
 * unbound" update — are exactly the parts that must be provable without a
 * database standing by. Drizzle's builder chain cannot be faked structurally,
 * so the six operations are named here instead and a test supplies its own.
 *
 * Both writes that move a row to a terminal state are CONDITIONAL, and both
 * conditions are the point rather than an optimisation:
 *
 *  - `bindQuotation` requires `quotation_id IS NULL`, so two concurrent
 *    recordings of the same create cannot both write the row.
 *  - `markTerminal` requires `status = 'active'`, so a cancel cannot overwrite a
 *    settlement (or the reverse), and a replayed recording cannot regress a row.
 *
 * Every method is scoped by WALLET as well as by id. The wallet always comes
 * from the server session, so a row can only ever be read or written by the
 * wallet that owns it.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db as defaultDb } from "@nuts/db";
import { rfqRequests, type NewRfqRequest, type RfqRequest } from "@nuts/db/schema/index";
import type { Database } from "./keys";

export interface RfqRowStore {
	insertPending(row: NewRfqRequest): Promise<RfqRequest>;
	/** The row, only if this wallet owns it. Null otherwise — the two cases are one answer. */
	findOwn(id: string, wallet: string): Promise<RfqRequest | null>;
	listForWallet(wallet: string, limit: number): Promise<RfqRequest[]>;
	/** Null when the row was already bound by someone else's concurrent recording. */
	bindQuotation(input: {
		id: string;
		wallet: string;
		quotationId: string;
		createTx: string;
		at: Date;
	}): Promise<RfqRequest | null>;
	/** Null when the row was no longer `active`. */
	markTerminal(input: {
		id: string;
		wallet: string;
		status: "cancelled" | "settled";
		cancelTx?: string;
		settleTx?: string;
		optionAddress?: string | null;
		at: Date;
	}): Promise<RfqRequest | null>;
	markFailed(input: { id: string; wallet: string; reason: string; at: Date }): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function drizzleRfqStore(database: Database = defaultDb): RfqRowStore {
	return {
		async insertPending(row) {
			const [inserted] = await database.insert(rfqRequests).values(row).returning();
			if (!inserted) throw new Error("The rfq_requests row could not be written");
			return inserted;
		},
		async findOwn(id, wallet) {
			// A malformed id is not sent to Postgres: `uuid = $1` raises rather than
			// returning no rows, and a lookup miss is not an error condition here.
			if (!UUID.test(id)) return null;
			const [row] = await database
				.select()
				.from(rfqRequests)
				.where(and(eq(rfqRequests.id, id), eq(rfqRequests.walletAddress, wallet)))
				.limit(1);
			return row ?? null;
		},
		async listForWallet(wallet, limit) {
			return await database
				.select()
				.from(rfqRequests)
				.where(eq(rfqRequests.walletAddress, wallet))
				.orderBy(desc(rfqRequests.createdAt))
				.limit(limit);
		},
		async bindQuotation({ id, wallet, quotationId, createTx, at }) {
			const [row] = await database
				.update(rfqRequests)
				.set({ status: "active", quotationId, createTx, failureReason: null, updatedAt: at })
				.where(
					and(
						eq(rfqRequests.id, id),
						eq(rfqRequests.walletAddress, wallet),
						isNull(rfqRequests.quotationId),
					),
				)
				.returning();
			return row ?? null;
		},
		async markTerminal({ id, wallet, status, cancelTx, settleTx, optionAddress, at }) {
			const [row] = await database
				.update(rfqRequests)
				.set({
					status,
					...(cancelTx === undefined ? {} : { cancelTx }),
					...(settleTx === undefined ? {} : { settleTx }),
					...(optionAddress === undefined ? {} : { optionAddress }),
					updatedAt: at,
				})
				.where(
					and(
						eq(rfqRequests.id, id),
						eq(rfqRequests.walletAddress, wallet),
						eq(rfqRequests.status, "active"),
					),
				)
				.returning();
			return row ?? null;
		},
		async markFailed({ id, wallet, reason, at }) {
			await database
				.update(rfqRequests)
				.set({ status: "failed", failureReason: reason, updatedAt: at })
				.where(and(eq(rfqRequests.id, id), eq(rfqRequests.walletAddress, wallet)));
		},
	};
}
