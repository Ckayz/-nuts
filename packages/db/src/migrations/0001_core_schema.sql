CREATE TYPE "public"."position_role" AS ENUM('creator', 'participant');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('back', 'counter');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('pending', 'confirmed', 'indexed', 'expired', 'settled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."thesis_direction" AS ENUM('bull', 'bear');--> statement-breakpoint
CREATE TYPE "public"."thesis_status" AS ENUM('draft', 'pending', 'open', 'expired', 'settled', 'cancelled');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thesis_id" uuid,
	"position_id" uuid,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_domain_reference_required" CHECK ("activity"."thesis_id" is not null or "activity"."position_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"nonce" text NOT NULL,
	"domain" text NOT NULL,
	"chain_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "auth_challenges_base_chain" CHECK ("auth_challenges"."chain_id" = 8453),
	CONSTRAINT "auth_challenges_wallet_address_lowercase" CHECK ("auth_challenges"."wallet_address" = lower("auth_challenges"."wallet_address"))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_user_id" uuid NOT NULL,
	"followed_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_user_id_followed_user_id_pk" PRIMARY KEY("follower_user_id","followed_user_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "position_role" NOT NULL,
	"side" "position_side" NOT NULL,
	"status" "position_status" NOT NULL,
	"chain_id" integer NOT NULL,
	"wallet_address" text NOT NULL,
	"order_id" text NOT NULL,
	"order_hash" text,
	"order_snapshot" jsonb NOT NULL,
	"fill_event" jsonb,
	"indexer_position_id" text,
	"tx_hash" text NOT NULL,
	"option_address" text,
	"referrer" text,
	"budget" numeric NOT NULL,
	"budget_decimals" integer NOT NULL,
	"contracts" numeric NOT NULL,
	"contract_decimals" integer NOT NULL,
	"premium" numeric NOT NULL,
	"premium_decimals" integer NOT NULL,
	"fees" numeric NOT NULL,
	"fee_decimals" integer NOT NULL,
	"collateral" numeric NOT NULL,
	"collateral_decimals" integer NOT NULL,
	"maximum_loss" numeric,
	"maximum_loss_decimals" integer,
	"maximum_payout" numeric,
	"maximum_payout_decimals" integer,
	"break_even_prices" numeric[] NOT NULL,
	"break_even_price_decimals" integer NOT NULL,
	"estimated_pnl" numeric,
	"estimated_pnl_decimals" integer,
	"settlement_price" numeric,
	"settlement_price_decimals" integer,
	"payout" numeric,
	"payout_decimals" integer,
	"final_pnl" numeric,
	"final_pnl_decimals" integer,
	"entry_premium_usd" numeric,
	"entry_fees_usd" numeric,
	"maximum_loss_usd" numeric,
	"maximum_payout_usd" numeric,
	"break_even_prices_usd" numeric[] NOT NULL,
	"estimated_pnl_usd" numeric,
	"final_pnl_usd" numeric,
	"settlement_price_usd" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"indexed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "positions_base_chain" CHECK ("positions"."chain_id" = 8453),
	CONSTRAINT "positions_confirmed_fill_event_required" CHECK ("positions"."status" not in ('confirmed', 'indexed', 'expired', 'settled') or ("positions"."fill_event" is not null and coalesce("positions"."fill_event"->>'version' = '1', false))),
	CONSTRAINT "positions_budget_decimals_nonnegative" CHECK ("positions"."budget_decimals" >= 0),
	CONSTRAINT "positions_contract_decimals_nonnegative" CHECK ("positions"."contract_decimals" >= 0),
	CONSTRAINT "positions_premium_decimals_nonnegative" CHECK ("positions"."premium_decimals" >= 0),
	CONSTRAINT "positions_fee_decimals_nonnegative" CHECK ("positions"."fee_decimals" >= 0),
	CONSTRAINT "positions_collateral_decimals_nonnegative" CHECK ("positions"."collateral_decimals" >= 0),
	CONSTRAINT "positions_maximum_loss_decimals_nonnegative" CHECK ("positions"."maximum_loss_decimals" >= 0),
	CONSTRAINT "positions_maximum_payout_decimals_nonnegative" CHECK ("positions"."maximum_payout_decimals" >= 0),
	CONSTRAINT "positions_break_even_price_decimals_nonnegative" CHECK ("positions"."break_even_price_decimals" >= 0),
	CONSTRAINT "positions_estimated_pnl_decimals_nonnegative" CHECK ("positions"."estimated_pnl_decimals" >= 0),
	CONSTRAINT "positions_settlement_price_decimals_nonnegative" CHECK ("positions"."settlement_price_decimals" >= 0),
	CONSTRAINT "positions_payout_decimals_nonnegative" CHECK ("positions"."payout_decimals" >= 0),
	CONSTRAINT "positions_final_pnl_decimals_nonnegative" CHECK ("positions"."final_pnl_decimals" >= 0),
	CONSTRAINT "positions_maximum_loss_decimals_required" CHECK ("positions"."maximum_loss" is null or "positions"."maximum_loss_decimals" is not null),
	CONSTRAINT "positions_maximum_payout_decimals_required" CHECK ("positions"."maximum_payout" is null or "positions"."maximum_payout_decimals" is not null),
	CONSTRAINT "positions_estimated_pnl_decimals_required" CHECK ("positions"."estimated_pnl" is null or "positions"."estimated_pnl_decimals" is not null),
	CONSTRAINT "positions_settlement_price_decimals_required" CHECK ("positions"."settlement_price" is null or "positions"."settlement_price_decimals" is not null),
	CONSTRAINT "positions_payout_decimals_required" CHECK ("positions"."payout" is null or "positions"."payout_decimals" is not null),
	CONSTRAINT "positions_final_pnl_decimals_required" CHECK ("positions"."final_pnl" is null or "positions"."final_pnl_decimals" is not null),
	CONSTRAINT "positions_wallet_address_lowercase" CHECK ("positions"."wallet_address" = lower("positions"."wallet_address")),
	CONSTRAINT "positions_budget_integral_nonnegative" CHECK (scale("positions"."budget") = 0 and "positions"."budget" >= 0),
	CONSTRAINT "positions_contracts_integral_nonnegative" CHECK (scale("positions"."contracts") = 0 and "positions"."contracts" > 0),
	CONSTRAINT "positions_premium_integral_nonnegative" CHECK (scale("positions"."premium") = 0 and "positions"."premium" >= 0),
	CONSTRAINT "positions_fees_integral_nonnegative" CHECK (scale("positions"."fees") = 0 and "positions"."fees" >= 0),
	CONSTRAINT "positions_collateral_integral_nonnegative" CHECK (scale("positions"."collateral") = 0 and "positions"."collateral" >= 0),
	CONSTRAINT "positions_maximum_loss_integral_nonnegative" CHECK ("positions"."maximum_loss" is null or (scale("positions"."maximum_loss") = 0 and "positions"."maximum_loss" >= 0)),
	CONSTRAINT "positions_maximum_payout_integral_nonnegative" CHECK ("positions"."maximum_payout" is null or (scale("positions"."maximum_payout") = 0 and "positions"."maximum_payout" >= 0)),
	CONSTRAINT "positions_settlement_price_integral_nonnegative" CHECK ("positions"."settlement_price" is null or (scale("positions"."settlement_price") = 0 and "positions"."settlement_price" >= 0)),
	CONSTRAINT "positions_payout_integral_nonnegative" CHECK ("positions"."payout" is null or (scale("positions"."payout") = 0 and "positions"."payout" >= 0)),
	CONSTRAINT "positions_estimated_pnl_integral" CHECK ("positions"."estimated_pnl" is null or scale("positions"."estimated_pnl") = 0),
	CONSTRAINT "positions_final_pnl_integral" CHECK ("positions"."final_pnl" is null or scale("positions"."final_pnl") = 0),
	CONSTRAINT "positions_break_even_prices_integral_nonnegative" CHECK (case when cardinality("positions"."break_even_prices") = 0 then true when array_ndims("positions"."break_even_prices") = 1 then array_position("positions"."break_even_prices", NULL) is null and array_to_string("positions"."break_even_prices", ',') ~ '^[0-9]+(,[0-9]+)*$' else false end)
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"headline" text NOT NULL,
	"rationale" text,
	"direction" "thesis_direction" NOT NULL,
	"status" "thesis_status" NOT NULL,
	"underlying_asset" text NOT NULL,
	"expiry_at" timestamp with time zone NOT NULL,
	"product_type" text NOT NULL,
	"is_call" boolean NOT NULL,
	"is_long" boolean NOT NULL,
	"strikes" numeric[] NOT NULL,
	"strike_decimals" integer NOT NULL,
	"collateral_address" text NOT NULL,
	"collateral_symbol" text NOT NULL,
	"collateral_decimals" integer NOT NULL,
	"creator_order_snapshot" jsonb NOT NULL,
	"creator_position_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "theses_strike_decimals_nonnegative" CHECK ("theses"."strike_decimals" >= 0),
	CONSTRAINT "theses_collateral_decimals_nonnegative" CHECK ("theses"."collateral_decimals" >= 0),
	CONSTRAINT "theses_public_creator_position_required" CHECK ("theses"."status" not in ('open', 'expired', 'settled') or "theses"."creator_position_id" is not null),
	CONSTRAINT "theses_strikes_integral_nonnegative" CHECK (case when array_ndims("theses"."strikes") = 1 then array_position("theses"."strikes", NULL) is null and cardinality("theses"."strikes") > 0 and array_to_string("theses"."strikes", ',') ~ '^[0-9]+(,[0-9]+)*$' else false end)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name" text,
	"bio" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_address_lowercase" CHECK ("users"."wallet_address" = lower("users"."wallet_address"))
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_user_id_users_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followed_user_id_users_id_fk" FOREIGN KEY ("followed_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_creator_position_id_positions_id_fk" FOREIGN KEY ("creator_position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_nonce_unique" ON "auth_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_chain_id_tx_hash_unique" ON "positions" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "theses_creator_position_unique" ON "theses" USING btree ("creator_position_id") WHERE "theses"."creator_position_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_address_unique" ON "users" USING btree ("wallet_address");