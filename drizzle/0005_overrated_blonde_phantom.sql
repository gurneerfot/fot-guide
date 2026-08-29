CREATE TYPE "public"."currency" AS ENUM('CAD', 'INR');--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" "currency" DEFAULT 'CAD' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_inr_paise" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "list_price_inr_paise" integer;--> statement-breakpoint
UPDATE "products"
SET "price_inr_paise" = CASE
	WHEN "slug" IN ('guide-expression-orale-b', 'mock-reading', 'mock-listening') THEN 179900
	WHEN "slug" = 'lessons-10' THEN 1799900
	ELSE NULL
END;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "products" WHERE "price_inr_paise" IS NULL) THEN
		RAISE EXCEPTION 'Set an INR price for every product before applying migration 0005';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price_inr_paise" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_inr_price_positive" CHECK ("products"."price_inr_paise" > 0);