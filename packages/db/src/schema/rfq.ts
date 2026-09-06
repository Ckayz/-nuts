import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One Request For Quotation on the Thetanuts **OptionFactory**, from the moment
 * the calldata is prepared to the moment the quotation is settled or cancelled.
 *
 * This is NOT a `positions` row. An OptionBook fill mints the option inside the
 * transaction the user signs, so `lib/trade/record.ts` can bind a receipt to a
 * position. An RFQ is an auction: the option (if any) is minted by the factory
 * at SETTLEMENT, possibly by somebody else — `settleQuotation` is permissionless
 * once the reveal window has passed. So the request itself is the row, and the
 * option it eventually produces is recorded in `option_address`.
 *
 * Money and quantities are decimal strings or base-unit strings, never floats,
 * matching the ThesisAiContext contract in PRD 10.3.
 *
 * The requester's ECDH keypair does NOT live here: it is per WALLET, not per
 * request, and it already has `agent_rfq_keys`. Only the public half is copied
 * onto each row, because that is what went into the calldata.
 */
export const rfqRequests = pgTable(
	"rfq_requests",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/** Lowercase 0x address of the requester. The session's wallet, never a client argument. */
		walletAddress: text("wallet_address").notNull(),
		/**
		 * The factory's quotation id, as a decimal string because it is a uint256.
		 * NULL until the create transaction is mined and its `QuotationRequested`
		 * log is decoded — the id does not exist before then.
		 */
		quotationId: text("quotation_id"),
		/**
		 * `pending_create` — calldata prepared or broadcast, no quotation id yet.
		 * `active` — mined, the offer period is open or awaiting settlement.
		 * `settled` — the factory settled it; `option_address` names the option.
		 * `cancelled` — the requester cancelled; the deposit is refunded.
		 * `failed` — the create reverted, or the request was abandoned.
		 */
		status: text("status", {
			enum: ["pending_create", "active", "settled", "cancelled", "failed"],
		}).notNull(),
		/**
		 * The `RfqCreateParams` this row was built from, minus the key material:
		 * underlying, strikes, expiry, contract count, reserve price, deadline —
		 * all as decimal strings.
		 */
		params: jsonb("params").notNull(),
		/**
		 * USDC escrowed at creation, in base units as a decimal string. MEASURED
		 * 2026-09-06: this is the calldata's top-level `reservePrice` argument
		 * (reserve per contract × contracts), NOT `params.requesterDeposit`, which
		 * the SDK hardcodes to 0 and the factory fills in itself.
		 */
		deposit: text("deposit").notNull(),
		/** `USDC` today; stored so a later collateral is never guessed from the deposit. */
		collateralSymbol: text("collateral_symbol").notNull(),
		/** The OptionFactory this request belongs to, read from `chainConfig`, never a constant. */
		factoryAddress: text("factory_address").notNull(),
		/** The compressed ECDH public key the calldata carried, so offers stay decryptable. */
		requesterPublicKey: text("requester_public_key").notNull(),
		createTx: text("create_tx"),
		cancelTx: text("cancel_tx"),
		settleTx: text("settle_tx"),
		/** The option contract minted at settlement, when there was one. */
		optionAddress: text("option_address"),
		failureReason: text("failure_reason"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("rfq_requests_wallet_idx").on(t.walletAddress, t.createdAt),
		/**
		 * A quotation id is unique per factory once it exists. PARTIAL, because
		 * every row starts with a NULL id and a plain unique index would then
		 * permit only... well, any number of NULLs — but the partial form states
		 * the rule the data actually has and keeps the index off the pending rows.
		 */
		uniqueIndex("rfq_requests_factory_quotation_key")
			.on(t.factoryAddress, t.quotationId)
			.where(sql`${t.quotationId} is not null`),
	],
);

export type RfqRequest = typeof rfqRequests.$inferSelect;
export type NewRfqRequest = typeof rfqRequests.$inferInsert;
