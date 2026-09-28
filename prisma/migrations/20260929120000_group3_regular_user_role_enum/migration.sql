-- Group 3: schema drift fix for regular_users.role.
--
-- schema.prisma declares `role UserRole @default(USER)` (a PostgreSQL enum),
-- but the Stage 10 Part 2 migration created the column as plain TEXT and never
-- created the "UserRole" type. Prisma binds enum values as "UserRole", so any
-- query that writes or filters on this column fails with
-- `type "public.UserRole" does not exist`, and `prisma migrate diff` reports
-- drift on every run.
--
-- Small, additive and idempotent: creates the type only when missing, and only
-- converts the column when it is still TEXT. Existing values are normalised
-- first so the cast can never fail (anything unexpected becomes 'USER').
DO $$
BEGIN
  CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'regular_users'
      AND column_name = 'role'
      AND data_type = 'text'
  ) THEN
    UPDATE "regular_users" SET "role" = 'USER'
      WHERE "role" IS NULL OR "role" NOT IN ('USER', 'ADMIN', 'SUPER_ADMIN');
    ALTER TABLE "regular_users" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "regular_users"
      ALTER COLUMN "role" TYPE "UserRole" USING ("role"::"UserRole");
    ALTER TABLE "regular_users" ALTER COLUMN "role" SET DEFAULT 'USER';
  END IF;
END $$;
