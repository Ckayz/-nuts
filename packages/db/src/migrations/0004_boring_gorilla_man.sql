ALTER TABLE "positions" DROP CONSTRAINT "positions_contracts_integral_nonnegative";--> statement-breakpoint
ALTER TABLE "positions" DROP CONSTRAINT "positions_break_even_prices_integral_nonnegative";--> statement-breakpoint
ALTER TABLE "theses" DROP CONSTRAINT "theses_strikes_integral_nonnegative";--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_domain_reference_required" CHECK ("activity"."thesis_id" is not null or "activity"."position_id" is not null);--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_base_chain" CHECK ("auth_challenges"."chain_id" = 8453);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_base_chain" CHECK ("positions"."chain_id" = 8453);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_confirmed_fill_event_required" CHECK ("positions"."status" not in ('confirmed', 'indexed', 'expired', 'settled') or ("positions"."fill_event" is not null and coalesce("positions"."fill_event"->>'version' = '1', false)));--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_budget_decimals_nonnegative" CHECK ("positions"."budget_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_contract_decimals_nonnegative" CHECK ("positions"."contract_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_premium_decimals_nonnegative" CHECK ("positions"."premium_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_fee_decimals_nonnegative" CHECK ("positions"."fee_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_collateral_decimals_nonnegative" CHECK ("positions"."collateral_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_maximum_loss_decimals_nonnegative" CHECK ("positions"."maximum_loss_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_maximum_payout_decimals_nonnegative" CHECK ("positions"."maximum_payout_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_break_even_price_decimals_nonnegative" CHECK ("positions"."break_even_price_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_estimated_pnl_decimals_nonnegative" CHECK ("positions"."estimated_pnl_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_settlement_price_decimals_nonnegative" CHECK ("positions"."settlement_price_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_payout_decimals_nonnegative" CHECK ("positions"."payout_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_final_pnl_decimals_nonnegative" CHECK ("positions"."final_pnl_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_maximum_loss_decimals_required" CHECK ("positions"."maximum_loss" is null or "positions"."maximum_loss_decimals" is not null);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_maximum_payout_decimals_required" CHECK ("positions"."maximum_payout" is null or "positions"."maximum_payout_decimals" is not null);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_estimated_pnl_decimals_required" CHECK ("positions"."estimated_pnl" is null or "positions"."estimated_pnl_decimals" is not null);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_settlement_price_decimals_required" CHECK ("positions"."settlement_price" is null or "positions"."settlement_price_decimals" is not null);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_payout_decimals_required" CHECK ("positions"."payout" is null or "positions"."payout_decimals" is not null);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_final_pnl_decimals_required" CHECK ("positions"."final_pnl" is null or "positions"."final_pnl_decimals" is not null);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_contracts_integral_nonnegative" CHECK (scale("positions"."contracts") = 0 and "positions"."contracts" > 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_break_even_prices_integral_nonnegative" CHECK (case when cardinality("positions"."break_even_prices") = 0 then true when array_ndims("positions"."break_even_prices") = 1 then array_position("positions"."break_even_prices", NULL) is null and array_to_string("positions"."break_even_prices", ',') ~ '^[0-9]+(,[0-9]+)*$' else false end);--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_strike_decimals_nonnegative" CHECK ("theses"."strike_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_collateral_decimals_nonnegative" CHECK ("theses"."collateral_decimals" >= 0);--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_strikes_integral_nonnegative" CHECK (case when array_ndims("theses"."strikes") = 1 then array_position("theses"."strikes", NULL) is null and cardinality("theses"."strikes") > 0 and array_to_string("theses"."strikes", ',') ~ '^[0-9]+(,[0-9]+)*$' else false end);