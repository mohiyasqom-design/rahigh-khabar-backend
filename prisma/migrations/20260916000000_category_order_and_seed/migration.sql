-- Stage 10 / Part 1 - category navigation order + the ten real categories.
--
-- SAFE ON PRODUCTION, and additive only:
--   * the new column has a DEFAULT, so existing rows are valid immediately;
--   * every INSERT is guarded by ON CONFLICT, so re-running changes nothing;
--   * the backfill only ever ADDS join rows, it never deletes or rewrites news.
-- Rollback SQL: docs/STAGE-10-PART-1.md.
--
-- «خانه» is deliberately NOT seeded: it is a navigation link to `/`, not a
-- category. Exactly ten rows below.

-- 1) Navigation order.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "categories_order_idx" ON "categories"("order");

-- 2) The ten categories, in navigation order.
INSERT INTO "categories" ("id", "name", "slug", "description", "order", "createdAt", "updatedAt") VALUES
  ('cat_seed_iran', 'ایران', 'iran', NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_politics', 'سیاست', 'politics', NULL, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_economy', 'اقتصاد', 'economy', NULL, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_world', 'جهان', 'world', NULL, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_war_defense', 'جنگ و دفاع', 'war-defense', NULL, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_society', 'جامعه', 'society', NULL, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_technology', 'فناوری', 'technology', NULL, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_culture_art', 'فرهنگ و هنر', 'culture-art', NULL, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_sport', 'ورزش', 'sport', NULL, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cat_seed_region', 'منطقه', 'region', NULL, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE
  SET "name" = EXCLUDED."name",
      "order" = EXCLUDED."order",
      "updatedAt" = CURRENT_TIMESTAMP;

-- 3) Every news item must have at least one category (the API has enforced
--    `categoryIds` min(1) since stage 4, but rows written before that, or left
--    category-less by an older DELETE /admin/categories, would break the rule).
--    Those rows are attached to «ایران» and REPORTED in the migration output.
DO $$
DECLARE
  default_category_id TEXT;
  orphan_count INTEGER;
  orphan_slugs TEXT;
BEGIN
  SELECT "id" INTO default_category_id FROM "categories" WHERE "slug" = 'iran';

  IF default_category_id IS NULL THEN
    RAISE EXCEPTION 'STAGE-10: default category "iran" is missing; aborting rather than guessing.';
  END IF;

  SELECT count(*), coalesce(string_agg(n."slug", ', ' ORDER BY n."slug"), '')
    INTO orphan_count, orphan_slugs
    FROM "news" n
   WHERE NOT EXISTS (SELECT 1 FROM "news_categories" nc WHERE nc."newsId" = n."id");

  IF orphan_count > 0 THEN
    INSERT INTO "news_categories" ("newsId", "categoryId")
    SELECT n."id", default_category_id
      FROM "news" n
     WHERE NOT EXISTS (SELECT 1 FROM "news_categories" nc WHERE nc."newsId" = n."id")
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'STAGE-10 REPORT: % news item(s) had no category and were assigned to «ایران» (iran): %',
      orphan_count, orphan_slugs;
  ELSE
    RAISE NOTICE 'STAGE-10 REPORT: every news item already had at least one category; nothing was reassigned.';
  END IF;
END $$;
