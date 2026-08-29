-- A payment becomes an order that can hold several products.
--
-- What was bought moves out of `payments.product_id` and into `payment_items`,
-- one row per line. Existing single-product payments are carried across as
-- one-line orders before the column is dropped, so no sales history is lost.
--
-- The fee columns go too: prices are now all-in, so there is no gross-up to
-- record — `amount_cents` is both what was charged and the whole story.

CREATE TABLE "payment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_price_cents" integer NOT NULL,
	CONSTRAINT "payment_items_price_positive" CHECK ("payment_items"."unit_price_cents" > 0)
);--> statement-breakpoint

ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "payment_items_payment_product_uq" ON "payment_items" USING btree ("payment_id","product_id");--> statement-breakpoint
CREATE INDEX "payment_items_payment_idx" ON "payment_items" USING btree ("payment_id");--> statement-breakpoint

-- Carry every existing payment across as a single-line order. `subtotal_cents`
-- was the pre-fee price of that one product, which is the right unit price;
-- older rows that predate it fall back to the amount charged.
INSERT INTO "payment_items" ("payment_id", "product_id", "unit_price_cents")
SELECT "id", "product_id", GREATEST(COALESCE("subtotal_cents", "amount_cents"), 1)
FROM "payments"
WHERE "product_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "subtotal_cents";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "fee_cents";
