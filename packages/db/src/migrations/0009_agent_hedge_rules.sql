CREATE TABLE "agent_hedge_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"asset" text NOT NULL,
	"floor_usd" text NOT NULL,
	"budget_per_trigger" text NOT NULL,
	"daily_cap_usd" text NOT NULL,
	"permission_ref" text,
	"account_address" text NOT NULL,
	"status" text DEFAULT 'armed' NOT NULL,
	"last_fired_at" timestamp with time zone,
	"spent_day" text,
	"spent_today" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_hedge_rules_wallet_idx" ON "agent_hedge_rules" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "agent_hedge_rules_status_idx" ON "agent_hedge_rules" USING btree ("status","asset");