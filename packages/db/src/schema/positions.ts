import { relations, sql } from "drizzle-orm";
import { check, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { activity } from "./activity";
import { positionRoleEnum, positionSideEnum, positionStatusEnum } from "./enums";
import { theses } from "./theses";
import { users } from "./users";

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    thesisId: uuid("thesis_id").notNull().references((): AnyPgColumn => theses.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: positionRoleEnum("role").notNull(),
    side: positionSideEnum("side").notNull(),
    status: positionStatusEnum("status").notNull(),
    chainId: integer("chain_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    orderId: text("order_id").notNull(),
    orderHash: text("order_hash"),
    orderSnapshot: jsonb("order_snapshot").$type<Record<string, unknown>>().notNull(),
    txHash: text("tx_hash").notNull(),
    optionAddress: text("option_address"),
    referrer: text("referrer"),
    // unit: collateral-token base units
    budget: numeric("budget", { precision: 78, scale: 0 }).notNull(),
    // unit: decimal places used by budget
    budgetDecimals: integer("budget_decimals").notNull(),
    // unit: option contract base units
    contracts: numeric("contracts", { precision: 78, scale: 0 }).notNull(),
    // unit: decimal places used by contracts
    contractDecimals: integer("contract_decimals").notNull(),
    // unit: collateral-token base units
    premium: numeric("premium", { precision: 78, scale: 0 }).notNull(),
    // unit: decimal places used by premium
    premiumDecimals: integer("premium_decimals").notNull(),
    // unit: collateral-token base units
    fees: numeric("fees", { precision: 78, scale: 0 }).notNull(),
    // unit: decimal places used by fees
    feeDecimals: integer("fee_decimals").notNull(),
    // unit: collateral-token base units
    collateral: numeric("collateral", { precision: 78, scale: 0 }).notNull(),
    // unit: decimal places used by collateral
    collateralDecimals: integer("collateral_decimals").notNull(),
    // unit: collateral-token base units; null means no trusted deterministic value
    maximumLoss: numeric("maximum_loss", { precision: 78, scale: 0 }),
    // unit: decimal places used by maximumLoss
    maximumLossDecimals: integer("maximum_loss_decimals"),
    // unit: collateral-token base units; null means no trusted deterministic value
    maximumPayout: numeric("maximum_payout", { precision: 78, scale: 0 }),
    // unit: decimal places used by maximumPayout
    maximumPayoutDecimals: integer("maximum_payout_decimals"),
    // unit: underlying price base units
    breakEvenPrices: numeric("break_even_prices", { precision: 78, scale: 0 }).array().notNull(),
    // unit: decimal places used by breakEvenPrices
    breakEvenPriceDecimals: integer("break_even_price_decimals").notNull(),
    // unit: collateral-token base units; null means unavailable
    estimatedPnl: numeric("estimated_pnl", { precision: 78, scale: 0 }),
    // unit: decimal places used by estimatedPnl
    estimatedPnlDecimals: integer("estimated_pnl_decimals"),
    // unit: underlying price base units; null before settlement
    settlementPrice: numeric("settlement_price", { precision: 78, scale: 0 }),
    // unit: decimal places used by settlementPrice
    settlementPriceDecimals: integer("settlement_price_decimals"),
    // unit: collateral-token base units; null before settlement
    payout: numeric("payout", { precision: 78, scale: 0 }),
    // unit: decimal places used by payout
    payoutDecimals: integer("payout_decimals"),
    // unit: collateral-token base units; null before settlement
    finalPnl: numeric("final_pnl", { precision: 78, scale: 0 }),
    // unit: decimal places used by finalPnl
    finalPnlDecimals: integer("final_pnl_decimals"),
    // unit: decimal USD
    entryPremiumUsd: numeric("entry_premium_usd"),
    // unit: decimal USD
    entryFeesUsd: numeric("entry_fees_usd"),
    // unit: decimal USD
    maximumLossUsd: numeric("maximum_loss_usd"),
    // unit: decimal USD
    maximumPayoutUsd: numeric("maximum_payout_usd"),
    // unit: decimal USD per underlying asset
    breakEvenPricesUsd: numeric("break_even_prices_usd").array().notNull(),
    // unit: decimal USD
    estimatedPnlUsd: numeric("estimated_pnl_usd"),
    // unit: decimal USD
    finalPnlUsd: numeric("final_pnl_usd"),
    // unit: decimal USD per underlying asset
    settlementPriceUsd: numeric("settlement_price_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("positions_chain_id_tx_hash_unique").on(table.chainId, table.txHash),
    check("positions_wallet_address_lowercase", sql`${table.walletAddress} = lower(${table.walletAddress})`),
  ],
);

export const positionsRelations = relations(positions, ({ one, many }) => ({
  thesis: one(theses, { fields: [positions.thesisId], references: [theses.id], relationName: "thesisPositions" }),
  user: one(users, { fields: [positions.userId], references: [users.id] }),
  activity: many(activity),
}));

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
