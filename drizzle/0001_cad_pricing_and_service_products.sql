-- Two changes, one migration:
--
-- 1. Money moves from INR paise to CAD cents, and a payment now records the
--    three amounts it always had implicitly — what the seller keeps, the
--    gateway fee the buyer carried, and the total actually charged.
--
-- 2. Products gain a `kind`. `reader` is material hosted here; `service` is a
--    mock test or lesson plan, delivered by a person, granting no account.
--
-- NOTE ON EXISTING ROWS: the columns are renamed rather than recreated, so any
-- stored value survives — but its MEANING changes. A row holding 149900 was
-- ₹1,499 and becomes CA$1,499.00, not CA$25. If this database already holds
-- real products or payments, reprice them after migrating; there is no
-- conversion that would be correct to apply automatically.

CREATE TYPE "public"."product_kind" AS ENUM('reader', 'service');--> statement-breakpoint

ALTER TABLE "products" ADD COLUMN "kind" "product_kind" DEFAULT 'reader' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" RENAME COLUMN "price_paise" TO "price_cents";--> statement-breakpoint
ALTER TABLE "products" RENAME COLUMN "list_price_paise" TO "list_price_cents";--> statement-breakpoint

-- Recreated because the check body names the old column.
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_price_positive";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_positive" CHECK ("products"."price_cents" > 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_reader_has_pages" CHECK ("products"."kind" <> 'reader' or not "products"."is_active" or "products"."page_count" > 0);--> statement-breakpoint

ALTER TABLE "payments" RENAME COLUMN "amount_paise" TO "amount_cents";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Added nullable, backfilled, then constrained: a NOT NULL column with no
-- default cannot be added to a table that already has rows.
ALTER TABLE "payments" ADD COLUMN "subtotal_cents" integer;--> statement-breakpoint
-- Payments taken before this migration carried no separate fee, so the whole
-- amount was the seller's.
UPDATE "payments" SET "subtotal_cents" = "amount_cents" WHERE "subtotal_cents" IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "subtotal_cents" SET NOT NULL;
