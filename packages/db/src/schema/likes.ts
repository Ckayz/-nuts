import { relations } from "drizzle-orm";
import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { theses } from "./theses";
import { users } from "./users";

export const likes = pgTable("likes", {
  userId: uuid("user_id").notNull().references(() => users.id),
  thesisId: uuid("thesis_id").notNull().references(() => theses.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.thesisId] })]);

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userId], references: [users.id] }),
  thesis: one(theses, { fields: [likes.thesisId], references: [theses.id] }),
}));

export type Like = typeof likes.$inferSelect;
export type NewLike = typeof likes.$inferInsert;
