CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text,
	"thesis_id" uuid,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"scope_allowed" boolean,
	"scope_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"max_loss_usd" text,
	"collateral_usd" text,
	"tx_to" text,
	"tx_data" text,
	"source_fetched_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"chain_id" integer DEFAULT 8453 NOT NULL,
	"tx_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"block_number" text,
	"option_address" text,
	"contracts" text,
	"raw" jsonb,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_rfq_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"subject" text NOT NULL,
	"day" text NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_receipts" ADD CONSTRAINT "agent_receipts_proposal_id_agent_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."agent_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conversations_wallet_idx" ON "agent_conversations" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "agent_conversations_thesis_idx" ON "agent_conversations" USING btree ("thesis_id");--> statement-breakpoint
CREATE INDEX "agent_messages_conversation_idx" ON "agent_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_conversation_idx" ON "agent_proposals" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_wallet_idx" ON "agent_proposals" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_receipts_tx_hash_key" ON "agent_receipts" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE INDEX "agent_receipts_proposal_idx" ON "agent_receipts" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_rfq_keys_wallet_key" ON "agent_rfq_keys" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_usage_subject_day_key" ON "agent_usage" USING btree ("subject_kind","subject","day");