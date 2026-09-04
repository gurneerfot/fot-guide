-- Lessons are CA$25 each, so the ten-lesson plan is CA$250 — down from CA$280.
-- The INR price is deliberately left alone; it is set on its own, not converted.

UPDATE "products"
SET "price_cents" = 25000
WHERE "slug" = 'lessons-10';
