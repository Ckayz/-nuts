ALTER TABLE "activity" DROP CONSTRAINT "activity_domain_reference_required";--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "target_user_id" uuid;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_target_user_created_at_idx" ON "activity" USING btree ("target_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_domain_reference_required" CHECK ("activity"."thesis_id" is not null or "activity"."position_id" is not null or "activity"."target_user_id" is not null);