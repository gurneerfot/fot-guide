ALTER TABLE "users" ALTER COLUMN "access_expires_at" SET DEFAULT now() + interval '45 days';--> statement-breakpoint
UPDATE "users"
SET "access_expires_at" = "created_at" + interval '45 days';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "access_expires_at" SET NOT NULL;