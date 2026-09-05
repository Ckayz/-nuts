DROP INDEX "positions_chain_id_tx_hash_unique";--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "ticket_hash" text;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "failure_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "positions_chain_id_tx_hash_unique" ON "positions" USING btree ("chain_id","tx_hash") WHERE "positions"."status" <> 'failed';--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_failure_reason_only_when_failed" CHECK ("positions"."failure_reason" is null or "positions"."status"::text = 'failed');