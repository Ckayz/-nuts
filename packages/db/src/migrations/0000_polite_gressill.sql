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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"tx_hash" text NOT NULL,
	"option_address" text,
	"referrer" text,
	"budget" numeric(78, 0) NOT NULL,
	"budget_decimals" integer NOT NULL,
	"contracts" numeric(78, 0) NOT NULL,
	"contract_decimals" integer NOT NULL,
	"premium" numeric(78, 0) NOT NULL,
	"premium_decimals" integer NOT NULL,
	"fees" numeric(78, 0) NOT NULL,
	"fee_decimals" integer NOT NULL,
	"collateral" numeric(78, 0) NOT NULL,
	"collateral_decimals" integer NOT NULL,
	"maximum_loss" numeric(78, 0),
	"maximum_loss_decimals" integer,
	"maximum_payout" numeric(78, 0),
	"maximum_payout_decimals" integer,
	"break_even_prices" numeric(78, 0)[] NOT NULL,
	"break_even_price_decimals" integer NOT NULL,
	"estimated_pnl" numeric(78, 0),
	"estimated_pnl_decimals" integer,
	"settlement_price" numeric(78, 0),
	"settlement_price_decimals" integer,
	"payout" numeric(78, 0),
	"payout_decimals" integer,
	"final_pnl" numeric(78, 0),
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
	CONSTRAINT "positions_wallet_address_lowercase" CHECK ("positions"."wallet_address" = lower("positions"."wallet_address"))
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
	"strikes" numeric(78, 0)[] NOT NULL,
	"strike_decimals" integer NOT NULL,
	"collateral_address" text NOT NULL,
	"collateral_symbol" text NOT NULL,
	"collateral_decimals" integer NOT NULL,
	"creator_order_snapshot" jsonb NOT NULL,
	"creator_position_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"settled_at" timestamp with time zone
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