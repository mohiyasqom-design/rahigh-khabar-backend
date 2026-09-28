-- Group 1: editorial news tags (multi-select) + article <-> inline upload link.

-- 1. Tags. A separate table (not an enum column) because one article can be
--    FEATURED and TRENDING at the same time.
CREATE TYPE "NewsTagType" AS ENUM ('FEATURED', 'TRENDING', 'LATEST');

CREATE TABLE "news_tags" (
    "newsId" TEXT NOT NULL,
    "tag" "NewsTagType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_tags_pkey" PRIMARY KEY ("newsId", "tag")
);

-- Serves GET /news?tag=featured (filter by tag, then join to news).
CREATE INDEX "news_tags_tag_newsId_idx" ON "news_tags"("tag", "newsId");

ALTER TABLE "news_tags"
    ADD CONSTRAINT "news_tags_newsId_fkey" FOREIGN KEY ("newsId")
    REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Which article embeds an uploaded file in its body, so deleting the
--    article can remove its files from the volume as well.
ALTER TABLE "media_assets" ADD COLUMN "newsId" TEXT;

CREATE INDEX "media_assets_newsId_idx" ON "media_assets"("newsId");

ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_newsId_fkey" FOREIGN KEY ("newsId")
    REFERENCES "news"("id") ON DELETE SET NULL ON UPDATE CASCADE;
