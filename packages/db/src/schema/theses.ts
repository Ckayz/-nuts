import { relations, sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { activity } from "./activity";
import { comments } from "./comments";
import { thesisDirectionEnum, thesisStatusEnum } from "./enums";
import { positions } from "./positions";
import { users } from "./users";
import type { OrderSnapshotV1 } from "../order-snapshot";

export const theses = pgTable(
  "theses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorUserId: uuid("creator_user_id").notNull().references(() => users.id),
    // TODO-OWNER: content limit
    headline: text("headline").notNull(),
    // TODO-OWNER: content limit
    rationale: text("rationale"),
    direction: thesisDirectionEnum("direction").notNull(),
    status: thesisStatusEnum("status").notNull(),
    underlyingAsset: text("underlying_asset").notNull(),
    expiryAt: timestamp("expiry_at", { withTimezone: true }).notNull(),
    productType: text("product_type").notNull(),
    isCall: boolean("is_call").notNull(),
    isLong: boolean("is_long").notNull(),
    // unit: underlying price base units per strike
    strikes: numeric("strikes").array().notNull(),
    // unit: decimal places used by every value in strikes
    strikeDecimals: integer("strike_decimals").notNull(),
    collateralAddress: text("collateral_address").notNull(),
    collateralSymbol: text("collateral_symbol").notNull(),
    // unit: decimal places used by collateral-token base-unit quantities
    collateralDecimals: integer("collateral_decimals").notNull(),
    creatorOrderSnapshot: jsonb("creator_order_snapshot").$type<OrderSnapshotV1>().notNull(),
    creatorPositionId: uuid("creator_position_id").references((): AnyPgColumn => positions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    // Invariant: a public thesis has exactly one confirmed creator position. The unique
    // reference and presence for public lifecycle states are database-enforced here;
    // status/role/ownership confirmation is enforced transactionally when publishing
    // because it spans the positions table.
    uniqueIndex("theses_creator_position_unique")
      .on(table.creatorPositionId)
      .where(sql`${table.creatorPositionId} is not null`),
    check(
      "theses_public_creator_position_required",
      sql`${table.status} not in ('open', 'expired', 'settled') or ${table.creatorPositionId} is not null`,
    ),
    check("theses_strikes_integral_nonnegative", sql`cardinality(${table.strikes}) > 0 and array_to_string(${table.strikes}, ',') ~ '^[0-9]+(,[0-9]+)*$'`),
  ],
);

export const thesesRelations = relations(theses, ({ one, many }) => ({
  creator: one(users, { fields: [theses.creatorUserId], references: [users.id] }),
  creatorPosition: one(positions, {
    fields: [theses.creatorPositionId],
    references: [positions.id],
    relationName: "creatorPosition",
  }),
  positions: many(positions, { relationName: "thesisPositions" }),
  comments: many(comments),
  activity: many(activity),
}));

export type Thesis = typeof theses.$inferSelect;
export type NewThesis = typeof theses.$inferInsert;
