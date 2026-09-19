-- Stage 10 Part 2 fix: a Google account exists before onboarding picks a
-- username. The original schema made `username` NOT NULL, so the OAuth callback
-- inserted an empty string and the second ever signup violated the unique index.
-- Nullable + UNIQUE is correct in PostgreSQL: multiple NULLs are allowed.
ALTER TABLE "regular_users" ALTER COLUMN "username" DROP NOT NULL;

-- Repair rows created by the buggy build.
UPDATE "regular_users" SET "username" = NULL WHERE "username" = '';
