import { relations, sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { positions } from "./positions";
import { theses } from "./theses";
import { users } from "./users";

// Invariant: writers create activity only for a confirmed domain event and retain
// the foreign key to its underlying thesis and/or position; activity is not proof.
export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  thesisId: uuid("thesis_id").references(() => theses.id),
  positionId: uuid("position_id").references(() => positions.id),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("activity_domain_reference_required", sql`${table.thesisId} is not null or ${table.positionId} is not null`)]);

export const activityRelations = relations(activity, ({ one }) => ({
  user: one(users, { fields: [activity.userId], references: [users.id] }),
  thesis: one(theses, { fields: [activity.thesisId], references: [theses.id] }),
  position: one(positions, { fields: [activity.positionId], references: [positions.id] }),
}));

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
