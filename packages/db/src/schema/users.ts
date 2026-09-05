import { relations, sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { activity } from "./activity";
import { comments } from "./comments";
import { likes } from "./likes";
import { follows } from "./follows";
import { positions } from "./positions";
import { theses } from "./theses";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle"),
    walletAddress: text("wallet_address").notNull(),
    // TODO-OWNER: content limit
    displayName: text("display_name"),
    // TODO-OWNER: content limit
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("users_handle_unique").on(table.handle),
    check("users_handle_format", sql`${table.handle} ~ '^[a-z0-9_]+$'`),
    // TODO-OWNER: placeholder handle bounds = 1–32 characters; owner sets them.
    check("users_handle_length", sql`char_length(${table.handle}) between 1 and 32`),
    uniqueIndex("users_wallet_address_unique").on(table.walletAddress),
    check("users_wallet_address_lowercase", sql`${table.walletAddress} = lower(${table.walletAddress})`),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  theses: many(theses),
  positions: many(positions),
  comments: many(comments),
  likes: many(likes),
  following: many(follows, { relationName: "follower" }),
  followers: many(follows, { relationName: "following" }),
  activity: many(activity, { relationName: "activityActor" }),
  targetedActivity: many(activity, { relationName: "activityTarget" }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
