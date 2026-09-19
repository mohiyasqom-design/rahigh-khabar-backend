-- Stage 10 Part 4: analytics event tables + publish scheduling column.
-- Purely additive: no existing column is changed or dropped.

-- Nullable scheduling date so the "scheduled" dashboard stat is real data.
ALTER TABLE "news" ADD COLUMN "scheduledFor" TIMESTAMP(3);
CREATE INDEX "news_scheduledFor_idx" ON "news"("scheduledFor");

CREATE TYPE "SharePlatform" AS ENUM ('TELEGRAM', 'TWITTER', 'WHATSAPP', 'COPY_LINK', 'OTHER');

CREATE TYPE "TrafficSource" AS ENUM (
  'DIRECT',
  'SEARCH_ENGINE',
  'SOCIAL',
  'INTERNAL_NEWS',
  'INTERNAL_HOME',
  'INTERNAL_OTHER',
  'EXTERNAL_LINK'
);

-- One row per page view. visitorId is a daily-rotating hash, never an IP.
CREATE TABLE "page_views" (
  "id" TEXT NOT NULL,
  "newsId" TEXT,
  "userId" TEXT,
  "visitorId" TEXT NOT NULL,
  "path" TEXT,
  "referrer" TEXT,
  "referrerSource" "TrafficSource" NOT NULL DEFAULT 'DIRECT',
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- Indexed from the first migration: this table grows with every visit.
CREATE INDEX "page_views_newsId_createdAt_idx" ON "page_views"("newsId", "createdAt");
CREATE INDEX "page_views_createdAt_idx" ON "page_views"("createdAt");
CREATE INDEX "page_views_visitorId_createdAt_idx" ON "page_views"("visitorId", "createdAt");
CREATE INDEX "page_views_referrerSource_createdAt_idx" ON "page_views"("referrerSource", "createdAt");
CREATE INDEX "page_views_userId_createdAt_idx" ON "page_views"("userId", "createdAt");

CREATE TABLE "reading_sessions" (
  "id" TEXT NOT NULL,
  "newsId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "scrollDepthPercent" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reading_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reading_sessions_newsId_createdAt_idx" ON "reading_sessions"("newsId", "createdAt");
CREATE INDEX "reading_sessions_createdAt_idx" ON "reading_sessions"("createdAt");

CREATE TABLE "share_events" (
  "id" TEXT NOT NULL,
  "newsId" TEXT NOT NULL,
  "platform" "SharePlatform" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "share_events_newsId_createdAt_idx" ON "share_events"("newsId", "createdAt");
CREATE INDEX "share_events_createdAt_idx" ON "share_events"("createdAt");

CREATE TABLE "saved_news" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newsId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_news_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_news_userId_newsId_key" ON "saved_news"("userId", "newsId");
CREATE INDEX "saved_news_newsId_idx" ON "saved_news"("newsId");
CREATE INDEX "saved_news_userId_createdAt_idx" ON "saved_news"("userId", "createdAt");

-- Deleting an article removes its events; deleting a reader keeps the
-- anonymous view but forgets whose it was.
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_newsId_fkey"
  FOREIGN KEY ("newsId") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "regular_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_newsId_fkey"
  FOREIGN KEY ("newsId") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_events" ADD CONSTRAINT "share_events_newsId_fkey"
  FOREIGN KEY ("newsId") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_news" ADD CONSTRAINT "saved_news_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "regular_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_news" ADD CONSTRAINT "saved_news_newsId_fkey"
  FOREIGN KEY ("newsId") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;
