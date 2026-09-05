import { pgEnum } from "drizzle-orm/pg-core";

export const thesisDirectionEnum = pgEnum("thesis_direction", ["bull", "bear"]);
export const thesisStatusEnum = pgEnum("thesis_status", [
  "draft",
  "pending",
  "open",
  "expired",
  "settled",
  "cancelled",
]);
/**
 * `standalone` (migration 0007, owner 2026-09-05): a fill that belongs to no
 * post. `positions.thesis_id` is nullable for exactly these rows and for no
 * others — see `positions_thesis_role_consistent`.
 */
export const positionRoleEnum = pgEnum("position_role", ["creator", "participant", "standalone"]);
export const positionSideEnum = pgEnum("position_side", ["back", "counter"]);
export const positionStatusEnum = pgEnum("position_status", [
  "pending",
  "confirmed",
  "indexed",
  "expired",
  "settled",
  "failed",
]);
