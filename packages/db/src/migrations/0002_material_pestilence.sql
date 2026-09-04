ALTER TABLE "positions" ALTER COLUMN "budget" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "contracts" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "premium" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "fees" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "collateral" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "maximum_loss" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "maximum_payout" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "break_even_prices" SET DATA TYPE numeric[];--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "estimated_pnl" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "settlement_price" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "payout" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "final_pnl" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "strikes" SET DATA TYPE numeric[];--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "fill_event" jsonb;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "indexer_position_id" text;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_budget_integral_nonnegative" CHECK (scale("positions"."budget") = 0 and "positions"."budget" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_contracts_integral_nonnegative" CHECK (scale("positions"."contracts") = 0 and "positions"."contracts" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_premium_integral_nonnegative" CHECK (scale("positions"."premium") = 0 and "positions"."premium" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_fees_integral_nonnegative" CHECK (scale("positions"."fees") = 0 and "positions"."fees" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_collateral_integral_nonnegative" CHECK (scale("positions"."collateral") = 0 and "positions"."collateral" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_maximum_loss_integral_nonnegative" CHECK ("positions"."maximum_loss" is null or (scale("positions"."maximum_loss") = 0 and "positions"."maximum_loss" >= 0));--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_maximum_payout_integral_nonnegative" CHECK ("positions"."maximum_payout" is null or (scale("positions"."maximum_payout") = 0 and "positions"."maximum_payout" >= 0));--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_settlement_price_integral_nonnegative" CHECK ("positions"."settlement_price" is null or (scale("positions"."settlement_price") = 0 and "positions"."settlement_price" >= 0));--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_payout_integral_nonnegative" CHECK ("positions"."payout" is null or (scale("positions"."payout") = 0 and "positions"."payout" >= 0));--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_estimated_pnl_integral" CHECK ("positions"."estimated_pnl" is null or scale("positions"."estimated_pnl") = 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_final_pnl_integral" CHECK ("positions"."final_pnl" is null or scale("positions"."final_pnl") = 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_break_even_prices_integral_nonnegative" CHECK (array_to_string("positions"."break_even_prices", ',') ~ '^[0-9]+(,[0-9]+)*$' or cardinality("positions"."break_even_prices") = 0);--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_strikes_integral_nonnegative" CHECK (cardinality("theses"."strikes") > 0 and array_to_string("theses"."strikes", ',') ~ '^[0-9]+(,[0-9]+)*$');