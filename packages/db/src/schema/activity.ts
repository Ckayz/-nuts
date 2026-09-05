import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { positions } from "./positions";
import { theses } from "./theses";
import { users } from "./users";

// Invariant: writers create activity only for a confirmed domain event and retain
// the foreign key to its underlying thesis, position and/or followed user; activity is not proof.
export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  thesisId: uuid("thesis_id").references(() => theses.id),
  positionId: uuid("position_id").references(() => positions.id),
  targetUserId: uuid("target_user_id").references(() => users.id),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("activity_domain_reference_required", sql`${table.thesisId} is not null or ${table.positionId} is not null or ${table.targetUserId} is not null`),
  index("activity_target_user_created_at_idx").on(table.targetUserId, table.createdAt.desc()),
]);

export const activityRelations = relations(activity, ({ one }) => ({
  user: one(users, { fields: [activity.userId], references: [users.id], relationName: "activityActor" }),
  targetUser: one(users, { fields: [activity.targetUserId], references: [users.id], relationName: "activityTarget" }),
  thesis: one(theses, { fields: [activity.thesisId], references: [theses.id] }),
  position: one(positions, { fields: [activity.positionId], references: [positions.id] }),
}));

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
