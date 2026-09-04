import { relations, sql } from "drizzle-orm";
import { check, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { activity } from "./activity";
import { positionRoleEnum, positionSideEnum, positionStatusEnum } from "./enums";
import { theses } from "./theses";
import { users } from "./users";
import type { FillEventSnapshotV1 } from "../fill-event-snapshot";
import type { OrderSnapshotV1 } from "../order-snapshot";

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
    orderSnapshot: jsonb("order_snapshot").$type<OrderSnapshotV1>().notNull(),
    fillEvent: jsonb("fill_event").$type<FillEventSnapshotV1>(),
    indexerPositionId: text("indexer_position_id"),
    txHash: text("tx_hash").notNull(),
    optionAddress: text("option_address"),
    referrer: text("referrer"),
    // unit: collateral-token base units
    budget: numeric("budget").notNull(),
    // unit: decimal places used by budget
    budgetDecimals: integer("budget_decimals").notNull(),
    // unit: option contract base units
    contracts: numeric("contracts").notNull(),
    // unit: decimal places used by contracts
    contractDecimals: integer("contract_decimals").notNull(),
    // unit: collateral-token base units
    premium: numeric("premium").notNull(),
    // unit: decimal places used by premium
    premiumDecimals: integer("premium_decimals").notNull(),
    // unit: collateral-token base units
    fees: numeric("fees").notNull(),
    // unit: decimal places used by fees
    feeDecimals: integer("fee_decimals").notNull(),
    // unit: collateral-token base units
    collateral: numeric("collateral").notNull(),
    // unit: decimal places used by collateral
    collateralDecimals: integer("collateral_decimals").notNull(),
    // unit: collateral-token base units; null means no trusted deterministic value
    maximumLoss: numeric("maximum_loss"),
    // unit: decimal places used by maximumLoss
    maximumLossDecimals: integer("maximum_loss_decimals"),
    // unit: collateral-token base units; null means no trusted deterministic value
    maximumPayout: numeric("maximum_payout"),
    // unit: decimal places used by maximumPayout
    maximumPayoutDecimals: integer("maximum_payout_decimals"),
    // unit: underlying price base units
    breakEvenPrices: numeric("break_even_prices").array().notNull(),
    // unit: decimal places used by breakEvenPrices
    breakEvenPriceDecimals: integer("break_even_price_decimals").notNull(),
    // unit: collateral-token base units; null means unavailable
    estimatedPnl: numeric("estimated_pnl"),
    // unit: decimal places used by estimatedPnl
    estimatedPnlDecimals: integer("estimated_pnl_decimals"),
    // unit: underlying price base units; null before settlement
    settlementPrice: numeric("settlement_price"),
    // unit: decimal places used by settlementPrice
    settlementPriceDecimals: integer("settlement_price_decimals"),
    // unit: collateral-token base units; null before settlement
    payout: numeric("payout"),
    // unit: decimal places used by payout
    payoutDecimals: integer("payout_decimals"),
    // unit: collateral-token base units; null before settlement
    finalPnl: numeric("final_pnl"),
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
    check("positions_budget_integral_nonnegative", sql`scale(${table.budget}) = 0 and ${table.budget} >= 0`),
    check("positions_contracts_integral_nonnegative", sql`scale(${table.contracts}) = 0 and ${table.contracts} >= 0`),
    check("positions_premium_integral_nonnegative", sql`scale(${table.premium}) = 0 and ${table.premium} >= 0`),
    check("positions_fees_integral_nonnegative", sql`scale(${table.fees}) = 0 and ${table.fees} >= 0`),
    check("positions_collateral_integral_nonnegative", sql`scale(${table.collateral}) = 0 and ${table.collateral} >= 0`),
    check("positions_maximum_loss_integral_nonnegative", sql`${table.maximumLoss} is null or (scale(${table.maximumLoss}) = 0 and ${table.maximumLoss} >= 0)`),
    check("positions_maximum_payout_integral_nonnegative", sql`${table.maximumPayout} is null or (scale(${table.maximumPayout}) = 0 and ${table.maximumPayout} >= 0)`),
    check("positions_settlement_price_integral_nonnegative", sql`${table.settlementPrice} is null or (scale(${table.settlementPrice}) = 0 and ${table.settlementPrice} >= 0)`),
    check("positions_payout_integral_nonnegative", sql`${table.payout} is null or (scale(${table.payout}) = 0 and ${table.payout} >= 0)`),
    check("positions_estimated_pnl_integral", sql`${table.estimatedPnl} is null or scale(${table.estimatedPnl}) = 0`),
    check("positions_final_pnl_integral", sql`${table.finalPnl} is null or scale(${table.finalPnl}) = 0`),
    check("positions_break_even_prices_integral_nonnegative", sql`array_to_string(${table.breakEvenPrices}, ',') ~ '^[0-9]+(,[0-9]+)*$' or cardinality(${table.breakEvenPrices}) = 0`),
  ],
);

export const positionsRelations = relations(positions, ({ one, many }) => ({
  thesis: one(theses, { fields: [positions.thesisId], references: [theses.id], relationName: "thesisPositions" }),
  user: one(users, { fields: [positions.userId], references: [users.id] }),
  activity: many(activity),
}));

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
