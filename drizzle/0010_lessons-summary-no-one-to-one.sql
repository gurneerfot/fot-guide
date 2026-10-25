-- The ten-lesson plan no longer promises one-to-one lessons.

UPDATE "products"
SET "summary" = 'Ten lessons built around your target score and your weakest areas.'
WHERE "slug" = 'lessons-10';
