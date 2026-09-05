-- Positions are independent of posts (owner 2026-09-05: "trade is just trade.
-- post(thesis) is it's own thing. doesn't have to be tied."). A fill made from
-- the market ticket belongs to no post; a post links one with a /p/<id> URL.
--
-- The frozen 0002 triggers are untouched. They already refuse to accept a
-- standalone row as a thesis's creator position: `enforce_thesis_creator_position`
-- raises unless the linked position has `role = 'creator'`, and a standalone row
-- never does. The CHECK below keeps the two facts in step in both directions.
--
-- `ALTER TYPE ... ADD VALUE` and a use of the new enum literal cannot share one
-- transaction, and drizzle runs each migration in one, so the CHECK compares
-- `role::text` instead of the enum literal.
ALTER TYPE "public"."position_role" ADD VALUE 'standalone';--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "thesis_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_thesis_role_consistent" CHECK (("positions"."thesis_id" is null) = ("positions"."role"::text = 'standalone'));