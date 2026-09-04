import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { theses } from "./theses";
import { users } from "./users";

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id").notNull().references(() => theses.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  // TODO-OWNER: content limit
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commentsRelations = relations(comments, ({ one }) => ({
  thesis: one(theses, { fields: [comments.thesisId], references: [theses.id] }),
  user: one(users, { fields: [comments.userId], references: [users.id] }),
}));

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
