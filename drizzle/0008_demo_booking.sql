CREATE TABLE "demo_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"level_note" text NOT NULL,
	"time_zone" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_bookings_seat_range" CHECK ("demo_bookings"."seat" between 1 and 2)
);
--> statement-breakpoint
CREATE TABLE "demo_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"meet_url" text NOT NULL,
	"google_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_bookings" ADD CONSTRAINT "demo_bookings_slot_id_demo_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."demo_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_bookings_slot_seat_uq" ON "demo_bookings" USING btree ("slot_id","seat");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_bookings_slot_email_uq" ON "demo_bookings" USING btree ("slot_id",lower("email"));--> statement-breakpoint
CREATE INDEX "demo_bookings_ip_time_idx" ON "demo_bookings" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_slots_starts_at_uq" ON "demo_slots" USING btree ("starts_at");