import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

/**
 * AI agent track tables (PRD 10.4 step 6).
 *
 * Owned by the AI agent developer. The social product's tables (users, theses,
 * positions, follows, comments, activity) are owned by the core product developer
 * and live elsewhere in this schema directory.
 *
 * Money and quantity values are stored as decimal strings, never floats, matching
 * the ThesisAiContext contract in PRD 10.3.
 */

/** A wallet address is the v1 identity (PRD 18). Null means an unauthenticated guest. */
const walletAddress = () => text("wallet_address");

export const agentConversations = pgTable(
	"agent_conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		walletAddress: walletAddress(),
		/** Set when the conversation was opened from a thesis rather than open discovery. */
		thesisId: uuid("thesis_id"),
		title: text("title"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("agent_conversations_wallet_idx").on(t.walletAddress, t.createdAt),
		index("agent_conversations_thesis_idx").on(t.thesisId),
	],
);

export const agentMessages = pgTable(
	"agent_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => agentConversations.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
		/** AI SDK UIMessage parts, including tool calls and their results. */
		parts: jsonb("parts").notNull(),
		/**
		 * Scope gate decision for user messages (PRD 10.8 layer 1).
		 * Null on assistant messages and on messages recorded before gating.
		 */
		scopeAllowed: boolean("scope_allowed"),
		scopeReason: text("scope_reason"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("agent_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * An approval-gated transaction the agent prepared. Never submitted by the server:
 * calldata is handed to the user's wallet (PRD 10.1, 14).
 */
export const agentProposals = pgTable(
	"agent_proposals",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => agentConversations.id, { onDelete: "cascade" }),
		walletAddress: walletAddress().notNull(),
		kind: text("kind", {
			enum: ["optionbook_fill", "erc20_approve", "rfq_create", "rfq_cancel"],
		}).notNull(),
		status: text("status", {
			enum: [
				"pending",
				"approved",
				"prepared",
				"rejected",
				"stale",
				"submitted",
				"confirmed",
				"failed",
			],
		})
			.notNull()
			.default("pending"),

		/** Verbatim source order or RFQ parameters the preview was computed from. */
		source: jsonb("source").notNull(),
		/** Deterministic preview shown to the user. Decimal strings only. */
		preview: jsonb("preview").notNull(),
		maxLossUsd: text("max_loss_usd"),
		collateralUsd: text("collateral_usd"),

		/** Encoded transaction, set only once the user has approved. */
		txTo: text("tx_to"),
		txData: text("tx_data"),

		/**
		 * PRD §14 reports observed remaining signature validity of 59–113 seconds.
		 * Complete collateral approval before fetching the order; build and broadcast
		 * calldata within 30 seconds of this fetch, otherwise refresh and rebuild.
		 */
		sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }).notNull(),
		approvedAt: timestamp("approved_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("agent_proposals_conversation_idx").on(t.conversationId, t.createdAt),
		index("agent_proposals_wallet_idx").on(t.walletAddress, t.createdAt),
	],
);

export const agentReceipts = pgTable(
	"agent_receipts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		proposalId: uuid("proposal_id")
			.notNull()
			.references(() => agentProposals.id, { onDelete: "cascade" }),
		chainId: integer("chain_id").notNull().default(8453),
		txHash: text("tx_hash").notNull(),
		status: text("status", { enum: ["pending", "confirmed", "failed"] })
			.notNull()
			.default("pending"),
		blockNumber: text("block_number"),
		/** Populated after api.triggerIndexerUpdate() and the indexer catches up. */
		optionAddress: text("option_address"),
		contracts: text("contracts"),
		raw: jsonb("raw"),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("agent_receipts_tx_hash_key").on(t.chainId, t.txHash),
		index("agent_receipts_proposal_idx").on(t.proposalId),
	],
);

/**
 * ECDH keypair used as `requesterPublicKey` when creating an RFQ. These are
 * encryption keys only: they cannot move funds. The private half is stored
 * encrypted at rest and never leaves the server.
 */
export const agentRfqKeys = pgTable(
	"agent_rfq_keys",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		walletAddress: walletAddress().notNull(),
		publicKey: text("public_key").notNull(),
		encryptedPrivateKey: text("encrypted_private_key").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("agent_rfq_keys_wallet_key").on(t.walletAddress)],
);

/** Daily turn limits: 10 per guest IP, 50 per authenticated wallet (PRD 10.2). */
export const agentUsage = pgTable(
	"agent_usage",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		subjectKind: text("subject_kind", { enum: ["ip", "wallet"] }).notNull(),
		subject: text("subject").notNull(),
		/** UTC calendar day, YYYY-MM-DD. */
		day: text("day").notNull(),
		turns: integer("turns").notNull().default(0),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("agent_usage_subject_day_key").on(t.subjectKind, t.subject, t.day)],
);
