-- Stage 10 Part 5: search, scheduling, web push, category follows, uploads.

-- 1. New article status for scheduled publication.
ALTER TYPE "NewsStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- 2. Full-text search vector maintained by a trigger, so it can never drift
--    from the article text (an application-side update would be skipped by raw
--    SQL writes and by the scheduler).
ALTER TABLE "news" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE OR REPLACE FUNCTION news_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('simple', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."lead", '') || ' ' || coalesce(NEW."summary", '')), 'B') ||
    setweight(to_tsvector('simple', left(regexp_replace(coalesce(NEW."body", ''), '<[^>]*>', ' ', 'g'), 200000)), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS news_search_vector_trigger ON "news";
CREATE TRIGGER news_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "lead", "summary", "body" ON "news"
  FOR EACH ROW EXECUTE FUNCTION news_search_vector_update();

-- Backfill existing rows through the trigger.
UPDATE "news" SET "title" = "title";

CREATE INDEX IF NOT EXISTS "news_search_vector_idx" ON "news" USING GIN ("searchVector");

-- 3. Optional semantic search. pgvector may be unavailable on the managed
--    instance, so this block must never abort the migration: the API falls
--    back to keyword-only search when the table is missing.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS "news_embeddings" (
    "newsId" text PRIMARY KEY REFERENCES "news"("id") ON DELETE CASCADE,
    "embedding" vector(1536) NOT NULL,
    "model" text NOT NULL,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS "news_embeddings_vector_idx"
    ON "news_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector unavailable; semantic search stays disabled (%)', SQLERRM;
END $$;

-- 4. Upload provenance.
CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" text PRIMARY KEY,
  "mediaId" text NOT NULL,
  "filename" text NOT NULL,
  "url" text NOT NULL,
  "sizeBytes" integer NOT NULL,
  "uploadedById" text,
  "uploadedBySiteUserId" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_mediaId_key" ON "media_assets"("mediaId");
CREATE INDEX IF NOT EXISTS "media_assets_createdAt_idx" ON "media_assets"("createdAt");

-- 5. Web push subscriptions.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" text PRIMARY KEY,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "userAgent" text,
  "userId" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- 6. Category follows.
CREATE TABLE IF NOT EXISTS "category_follows" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "categoryId" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "category_follows_userId_categoryId_key" ON "category_follows"("userId", "categoryId");
CREATE INDEX IF NOT EXISTS "category_follows_categoryId_idx" ON "category_follows"("categoryId");

-- 7. Foreign keys (added separately so re-runs stay idempotent).
DO $$
BEGIN
  ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedBySiteUserId_fkey"
    FOREIGN KEY ("uploadedBySiteUserId") REFERENCES "regular_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "regular_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER TABLE "category_follows" ADD CONSTRAINT "category_follows_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "regular_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$
BEGIN
  ALTER TABLE "category_follows" ADD CONSTRAINT "category_follows_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
