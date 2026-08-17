CREATE TABLE IF NOT EXISTS "push_live_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"push_token" text NOT NULL,
	"apns_environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "apns_environment" text;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "live_activity_push_to_start_token" text;--> statement-breakpoint
ALTER TABLE "push_live_activities" DROP CONSTRAINT IF EXISTS "push_live_activities_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "push_live_activities" ADD CONSTRAINT "push_live_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_live_activities_user_device_operation" ON "push_live_activities" USING btree ("user_id","device_id","operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_user_operation" ON "push_live_activities" USING btree ("user_id","operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_last_seen" ON "push_live_activities" USING btree ("last_seen_at");
