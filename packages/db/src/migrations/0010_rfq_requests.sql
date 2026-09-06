CREATE TABLE "rfq_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"quotation_id" text,
	"status" text NOT NULL,
	"params" jsonb NOT NULL,
	"deposit" text NOT NULL,
	"collateral_symbol" text NOT NULL,
	"factory_address" text NOT NULL,
	"requester_public_key" text NOT NULL,
	"create_tx" text,
	"cancel_tx" text,
	"settle_tx" text,
	"option_address" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rfq_requests_wallet_idx" ON "rfq_requests" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_requests_factory_quotation_key" ON "rfq_requests" USING btree ("factory_address","quotation_id") WHERE "rfq_requests"."quotation_id" is not null;