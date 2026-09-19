# مرحلهٔ ۱۰ — بخش ۱: ترتیب ناوبری دسته‌بندی‌ها + seed ده دسته

## Migration
`prisma/migrations/20260916000000_category_order_and_seed/migration.sql`

سه کار انجام می‌دهد:

1. ستون `"order"` (INTEGER NOT NULL DEFAULT 0) به جدول `categories` + ایندکس `categories_order_idx`.
2. درج ده دستهٔ رسمی با `ON CONFLICT ("slug") DO UPDATE` روی `name` و `order`
   (پس اجرای دوباره بی‌خطر است و اگر دسته‌ای از قبل با همان slug وجود داشته
   باشد، به‌جای خطای یکتایی فقط نام/ترتیبش هم‌راستا می‌شود).
   **«خانه» ساخته نمی‌شود**؛ فقط لینک ناوبری به `/` است.
3. هر خبری که هیچ پیوند دسته‌بندی ندارد به «ایران» وصل می‌شود و تعداد و
   فهرست `slug` آن‌ها با `RAISE NOTICE` در خروجی migration چاپ می‌شود
   (`STAGE-10 REPORT: ...`). این خروجی را هنگام deploy نگه دارید.

### اجرا روی production
طبق `preDeployCommand` فعلی و با تأیید محمد:

```bash
npx prisma migrate deploy
```

migration فقط additive است: ستون با DEFAULT اضافه می‌شود، همهٔ INSERTها
guard دارند و backfill تنها ردیف پیوند **اضافه** می‌کند؛ هیچ خبری بازنویسی یا
حذف نمی‌شود.

### گزارش خبرهای دسته‌بندی‌شدهٔ خودکار (اگر خروجی NOTICE را از دست دادید)
قبل از اجرا:

```sql
SELECT n."slug", n."title", n."status"
  FROM "news" n
 WHERE NOT EXISTS (SELECT 1 FROM "news_categories" nc WHERE nc."newsId" = n."id")
 ORDER BY n."slug";
```

بعد از اجرا، همان خبرها را می‌توان با پیوند به «ایران» و نبود پیوند دیگر
شناسایی کرد.

### Rollback (Prisma migration پایین‌رونده اجرا نمی‌کند؛ دستی)
```sql
-- ستون و ایندکس:
DROP INDEX IF EXISTS "categories_order_idx";
ALTER TABLE "categories" DROP COLUMN IF EXISTS "order";

-- دسته‌های seed (فقط اگر هیچ خبری به آن‌ها وصل نیست، وگرنه پیوندها را
-- آگاهانه از دست می‌دهید):
DELETE FROM "categories"
 WHERE "id" LIKE 'cat_seed_%'
   AND NOT EXISTS (SELECT 1 FROM "news_categories" nc WHERE nc."categoryId" = "categories"."id");
```
backfill قابل بازگشت خودکار نیست: پس از اجرا نمی‌توان تشخیص داد کدام پیوند
«ایران» دستی بوده و کدام خودکار. اگر لازم است، خروجی NOTICE را قبل از rollback
نگه دارید.

## تغییر رفتار API
- `POST`/`PATCH`/`DELETE /admin/categories` فقط `SUPER_ADMIN` (قبلاً POST/PATCH
  برای `ADMIN` هم باز بود). `GET /admin/categories` همچنان برای `ADMIN` باز است،
  چون نوشتن خبر بدون خواندن فهرست دسته‌ها ممکن نیست.
- پاسخ دسته‌بندی یک فیلد بیشتر دارد: `order`.
- هر دو فهرست عمومی و مدیریتی بر اساس `order` سپس `name` مرتب‌اند.
- **`DELETE /admin/categories/:id` روی دستهٔ دارای خبر ۴۰۹ `CATEGORY_IN_USE`
  می‌دهد** (قبلاً ۲۰۴ می‌داد و پیوندها cascade می‌شدند و خبر PUBLISHED بدون
  دسته می‌ماند). شمارش داخل همان تراکنش serializable انجام می‌شود.
