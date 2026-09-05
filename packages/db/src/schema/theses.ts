import { relations, sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { activity } from "./activity";
import { likes } from "./likes";
import { comments } from "./comments";
import { thesisDirectionEnum, thesisStatusEnum } from "./enums";
import { positions } from "./positions";
import { users } from "./users";
import type { OrderSnapshotV1 } from "../order-snapshot";

// ECMAScript WhiteSpace + LineTerminator, matching ai-context.ts trim().
// Keep this SQL escape list in sync with migration 0003 and its snapshot.
const headlineWhitespaceSql = sql.raw(String.raw`E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'`);

export const theses = pgTable(
  "theses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    creatorUserId: uuid("creator_user_id").notNull().references(() => users.id),
    // TODO-OWNER: content limit
    headline: text("headline").notNull(),
    // TODO-OWNER: content limit
    rationale: text("rationale"),
    direction: thesisDirectionEnum("direction"),
    status: thesisStatusEnum("status").notNull(),
    taggedAsset: text("tagged_asset"),
    underlyingAsset: text("underlying_asset"),
    expiryAt: timestamp("expiry_at", { withTimezone: true }),
    productType: text("product_type"),
    isCall: boolean("is_call"),
    isLong: boolean("is_long"),
    // unit: underlying price base units per strike
    strikes: numeric("strikes").array(),
    // unit: decimal places used by every value in strikes
    strikeDecimals: integer("strike_decimals"),
    collateralAddress: text("collateral_address"),
    collateralSymbol: text("collateral_symbol"),
    // unit: decimal places used by collateral-token base-unit quantities
    collateralDecimals: integer("collateral_decimals"),
    creatorOrderSnapshot: jsonb("creator_order_snapshot").$type<OrderSnapshotV1>(),
    creatorPositionId: uuid("creator_position_id").references((): AnyPgColumn => positions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("theses_slug_unique").on(table.slug),
    // The market page lists every open thesis tagged to one asset, newest
    // first. Without this the query is a full scan of the table, because
    // `tagged_asset` carried no index at all: the page used to filter the
    // newest 50 site-wide posts in JS instead, which silently hid older posts.
    index("theses_tagged_asset_created_at_idx").on(table.taggedAsset, table.createdAt),
    check("theses_slug_format", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("theses_headline_nonblank", sql`btrim(${table.headline}, ${headlineWhitespaceSql}) <> ''`),
    check("theses_structure_all_or_nothing", sql`(${table.direction} is null and ${table.underlyingAsset} is null and ${table.expiryAt} is null and ${table.productType} is null and ${table.isCall} is null and ${table.isLong} is null and ${table.strikes} is null and ${table.strikeDecimals} is null and ${table.collateralAddress} is null and ${table.collateralSymbol} is null and ${table.collateralDecimals} is null and ${table.creatorOrderSnapshot} is null) or (${table.direction} is not null and ${table.underlyingAsset} is not null and ${table.expiryAt} is not null and ${table.productType} is not null and ${table.isCall} is not null and ${table.isLong} is not null and ${table.strikes} is not null and ${table.strikeDecimals} is not null and ${table.collateralAddress} is not null and ${table.collateralSymbol} is not null and ${table.collateralDecimals} is not null and ${table.creatorOrderSnapshot} is not null)`),
    check("theses_tagged_asset_uppercase", sql`${table.taggedAsset} = upper(${table.taggedAsset})`),
    check("theses_tagged_asset_matches_structure", sql`${table.underlyingAsset} is null or (${table.taggedAsset} is not null and ${table.taggedAsset} = ${table.underlyingAsset})`),
    check("theses_strike_decimals_nonnegative", sql`${table.strikeDecimals} >= 0`),
    check("theses_collateral_decimals_nonnegative", sql`${table.collateralDecimals} >= 0`),
    // A linked backing position is unique and validated by deferred triggers.
    uniqueIndex("theses_creator_position_unique")
      .on(table.creatorPositionId)
      .where(sql`${table.creatorPositionId} is not null`),
    check(
      "theses_backing_requires_structure",
      sql`${table.creatorPositionId} is null or ${table.underlyingAsset} is not null`,
    ),
    check("theses_strikes_integral_nonnegative", sql`${table.strikes} is null or case when array_ndims(${table.strikes}) = 1 then array_position(${table.strikes}, NULL) is null and cardinality(${table.strikes}) > 0 and array_to_string(${table.strikes}, ',') ~ '^[0-9]+(,[0-9]+)*$' else false end`),
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
  likes: many(likes),
  activity: many(activity),
}));

export type Thesis = typeof theses.$inferSelect;
export type NewThesis = typeof theses.$inferInsert;
