CREATE TABLE "likes" (
	"user_id" uuid NOT NULL,
	"thesis_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_user_id_thesis_id_pk" PRIMARY KEY("user_id","thesis_id")
);
--> statement-breakpoint
ALTER TABLE "theses" DROP CONSTRAINT "theses_public_creator_position_required";--> statement-breakpoint
ALTER TABLE "theses" DROP CONSTRAINT "theses_strikes_integral_nonnegative";--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "direction" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "underlying_asset" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "expiry_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "product_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "is_call" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "is_long" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "strikes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "strike_decimals" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "collateral_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "collateral_symbol" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "collateral_decimals" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ALTER COLUMN "creator_order_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ADD COLUMN "tagged_asset" text;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Derived backfill for pre-existing structured theses; no invented market values.
UPDATE "theses" SET "tagged_asset" = "underlying_asset";
--> statement-breakpoint
-- Drain the backfill deferred trigger events before further ALTER TABLE commands.
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_structure_all_or_nothing" CHECK (("theses"."direction" is null and "theses"."underlying_asset" is null and "theses"."expiry_at" is null and "theses"."product_type" is null and "theses"."is_call" is null and "theses"."is_long" is null and "theses"."strikes" is null and "theses"."strike_decimals" is null and "theses"."collateral_address" is null and "theses"."collateral_symbol" is null and "theses"."collateral_decimals" is null and "theses"."creator_order_snapshot" is null) or ("theses"."direction" is not null and "theses"."underlying_asset" is not null and "theses"."expiry_at" is not null and "theses"."product_type" is not null and "theses"."is_call" is not null and "theses"."is_long" is not null and "theses"."strikes" is not null and "theses"."strike_decimals" is not null and "theses"."collateral_address" is not null and "theses"."collateral_symbol" is not null and "theses"."collateral_decimals" is not null and "theses"."creator_order_snapshot" is not null));--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_tagged_asset_uppercase" CHECK ("theses"."tagged_asset" = upper("theses"."tagged_asset"));--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_tagged_asset_matches_structure" CHECK ("theses"."underlying_asset" is null or ("theses"."tagged_asset" is not null and "theses"."tagged_asset" = "theses"."underlying_asset"));--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_backing_requires_structure" CHECK ("theses"."creator_position_id" is null or "theses"."underlying_asset" is not null);--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_strikes_integral_nonnegative" CHECK ("theses"."strikes" is null or case when array_ndims("theses"."strikes") = 1 then array_position("theses"."strikes", NULL) is null and cardinality("theses"."strikes") > 0 and array_to_string("theses"."strikes", ',') ~ '^[0-9]+(,[0-9]+)*$' else false end);
