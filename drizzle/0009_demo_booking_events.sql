ALTER TABLE "demo_slots" ALTER COLUMN "meet_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD COLUMN "reminder_email_id" text;--> statement-breakpoint
ALTER TABLE "demo_slots" ADD COLUMN "meet_conference" jsonb;