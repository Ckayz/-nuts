import { relations } from "drizzle-orm";
import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const follows = pgTable(
  "follows",
  {
    followerUserId: uuid("follower_user_id").notNull().references(() => users.id),
    followedUserId: uuid("followed_user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.followerUserId, table.followedUserId] })],
);

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, { fields: [follows.followerUserId], references: [users.id], relationName: "follower" }),
  followed: one(users, { fields: [follows.followedUserId], references: [users.id], relationName: "following" }),
}));

export type Follow = typeof follows.$inferSelect;
export type NewFollow = typeof follows.$inferInsert;
