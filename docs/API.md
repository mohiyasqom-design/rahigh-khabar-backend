> نسخهٔ مرحلهٔ ۵: قراردادهای Media و SEO در [MEDIA-SEO.md](MEDIA-SEO.md) و README فعلی هستند. این فایل مرجع endpointهای قبلی است.

# قرارداد API مرحلهٔ ۴

همهٔ bodyها JSON و strict هستند. خطای اعتبارسنجی 400 است و ورودی خام را echo نمی‌کند. نبود کوکی/کاربر غیرفعال 401 و نقش/مالکیت نامجاز 403 است. برای تمام درخواست‌های مرورگری احراز‌شده از credentials: include استفاده کنید.

## دسته‌بندی

| متد و مسیر | مجوز | درخواست / پاسخ موفق |
| --- | --- | --- |
| POST /admin/categories | فقط SUPER_ADMIN | name, slug, description?, order? / 201 دسته‌بندی |
| GET /admin/categories | ADMIN یا SUPER_ADMIN | بدون query / 200 آرایه |
| PATCH /admin/categories/:id | فقط SUPER_ADMIN | حداقل یک فیلد قابل‌ویرایش / 200 دسته‌بندی |
| DELETE /admin/categories/:id | فقط SUPER_ADMIN | 204 بدون بدنه |
| GET /categories | عمومی | بدون query / 200 آرایه |

پاسخ دسته‌بندی: `{ id, name, slug, description, order }`، description ممکن است null باشد. طول name برابر 1..120 و description حداکثر 2000 است. slug بین 1..200 و مطابق `^[a-z0-9]+(-[a-z0-9]+)*$` است. `order` عدد صحیح 0..10000 (پیش‌فرض 0) و ترتیب نمایش در ناوبری است؛ هر دو فهرست عمومی و مدیریتی بر اساس `order` سپس `name` مرتب برمی‌گردند. slug تکراری 409، PATCH/DELETE شناسهٔ ناموجود 404.

**مرحلهٔ ۱۰:** نوشتن روی دسته‌بندی‌ها (POST/PATCH/DELETE) فقط برای `SUPER_ADMIN` است؛ نقش `ADMIN` تنها می‌تواند فهرست را بخواند تا هنگام نوشتن خبر دسته انتخاب کند (Least Privilege). **حذف دسته‌بندی‌ای که خبری به آن متصل است دیگر پیوندها را پاک نمی‌کند؛ پاسخ `409 CATEGORY_IN_USE` است** و ابتدا باید دستهٔ آن خبرها تغییر کند. ده دستهٔ رسمی سایت با migration `20260916000000_category_order_and_seed` seed می‌شوند و «خانه» جزو آن‌ها نیست (فقط لینک ناوبری به `/`).

## خبر مدیریتی

| متد و مسیر | مجوز | پاسخ موفق |
| --- | --- | --- |
| POST /admin/news | ADMIN یا SUPER_ADMIN | 201 خبر DRAFT با authorId نشست |
| GET /admin/news | ADMIN فقط خودش، SUPER_ADMIN همه | 200 فهرست صفحه‌بندی‌شده |
| GET /admin/news/:id | همان محدودیت مالکیت | 200 جزئیات |
| PATCH /admin/news/:id | ADMIN خبر خودش در DRAFT/IN_REVIEW/REJECTED؛ SUPER_ADMIN هر خبر | 200 جزئیات |
| DELETE /admin/news/:id | فقط SUPER_ADMIN | 204، حذف فیزیکی و Cascade پیوندها |
| POST /admin/news/:id/status | فقط SUPER_ADMIN | 200 جزئیات با وضعیت جدید |

ورودی ساخت:

```json
{
  "title": "عنوان خبر",
  "slug": "sample-news",
  "summary": "خلاصه اختیاری",
  "lead": "لید خبر",
  "body": "متن کامل خبر",
  "categoryIds": ["existing-category-id"],
  "coverImageId": null,
  "seoTitle": "عنوان سئو",
  "metaDescription": "توضیح متا"
}
```

title, slug, lead, body و categoryIds الزامی‌اند. authorId، status و publishedAt در body مجاز نیستند. PATCH همین فیلدهای محتوایی را به‌صورت اختیاری می‌گیرد؛ حداقل یکی باید فرستاده شود. optional nullableها: summary, coverImageId, seoTitle, metaDescription. با null پاک می‌شوند؛ سایر فیلدها null نمی‌پذیرند. categoryIds شامل 1..50 شناسهٔ غیرتکراری موجود است. Media باید از قبل وجود داشته باشد؛ فایل یا URL به جای coverImageId پذیرفته نیست.

حدود: title تا 300، summary تا 2000، lead تا 5000، body تا 500000، seoTitle تا 200، metaDescription تا 500 کاراکتر. سقف کلی HTTP body همان 1 MiB است؛ متن چندبایتی ممکن است زودتر به این سقف برسد. شناسه‌ها string با طول حداکثر 128 هستند.

لیست admin: `?page=1&pageSize=20&status=DRAFT&categoryId=...`. همهٔ statusهای enum قابل فیلترند. بدون فیلتر status، همهٔ وضعیت‌ها در محدودهٔ مالکیت برمی‌گردند. query ناشناخته مثل authorId رد می‌شود.

پاسخ admin شامل id, authorId, coverImageId, status, createdAt, updatedAt و فیلدهای محتوایی است؛ author فقط displayName، coverImage فقط url/altText/width/height، categories آرایهٔ تخت دسته‌بندی‌هاست. passwordHash و email حتی در پاسخ خبر admin برنمی‌گردند.

ورودی وضعیت: `{ "status": "PUBLISHED" }`. جدول کامل انتقال‌ها در [تصمیم‌ها](MARHALE-4.md) است. انتقال نامعتبر 400 و message شامل وضعیت‌های مجاز از وضعیت فعلی است. publishedAt فقط اولین بار انتشار تنظیم می‌شود.

## خبر عمومی

| مسیر | رفتار |
| --- | --- |
| GET /news | فقط PUBLISHED، مرتب publishedAt نزولی، سپس id نزولی |
| GET /news/:slug | جزئیات PUBLISHED؛ خبر ناموجود یا غیرمنتشرشده هر دو دقیقاً 404 یکسان |

query لیست: `page`, `pageSize`, `categorySlug`؛ پیش‌فرض 1 و 20، سقف 100000 و 100. query status در API عمومی 400 است. categorySlug معتبر ولی ناموجود فهرست خالی می‌دهد.

```json
{
  "items": [],
  "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```

هر آیتم عمومی: title, slug, summary, lead, publishedAt, `author: { displayName }`, coverImage و categories. جزئیات علاوه بر این‌ها body, seoTitle و metaDescription دارد. id خام خبر، authorId، status، ایمیل و زمان‌های داخلی ایجاد/ویرایش در پاسخ عمومی نیستند. لیست body کامل را نمی‌خواند. تمام تاریخ‌ها رشتهٔ ISO هستند، publishedAt برای دادهٔ قدیمی ناسازگار می‌تواند null باشد. نوشتن از API این ناسازگاری را ایجاد نمی‌کند.

API عمومی خبر `Cache-Control: no-store` دارد تا پس از آرشیو، محتوای ذخیره‌شده توسط این API همچنان نمایش داده نشود؛ اگر بعداً CDN/cache خارجی اضافه شد، invalidation باید جدا طراحی شود. این هدر محتوایی را که پیش‌تر نزد کاربر ذخیره شده از دستگاه او پاک نمی‌کند.

## خطاهای دامنه

```json
{ "code": "INVALID_CATEGORY_IDS", "message": "یک یا چند دسته‌بندی وجود ندارند." }
```

| وضعیت | code نمونه |
| --- | --- |
| 400 | INVALID_INPUT, INVALID_CATEGORY_IDS, INVALID_COVER_IMAGE, INVALID_CATEGORIES, INVALID_REFERENCE, INVALID_STATUS_TRANSITION |
| 401 | UNAUTHORIZED, TOKEN_EXPIRED |
| 403 | FORBIDDEN, ORIGIN_NOT_ALLOWED |
| 404 | NEWS_NOT_FOUND یا NOT_FOUND |
| 409 | SLUG_CONFLICT، CATEGORY_IN_USE یا CONCURRENT_MODIFICATION |

parser/خطای زیرساخت عمومی شکل قدیمی `{ "error": "..." }` دارد، برای حفظ رفتار Auth. در هیچ‌یک جزئیات SQL یا secret منتشر نمی‌شود. 413 برای body بزرگ و 415 برای content-type پشتیبانی‌نشده ممکن است.

## نمونهٔ اجرای محلی

```sh
API=http://localhost:3000
# این مثال اعتبارنامهٔ واقعی ندارد. رمز واقعی را در history یا لاگ ذخیره نکنید.
curl -i -c cookies.txt "$API/auth/login" -H 'Content-Type: application/json' \
  --data '{"email":"admin@example.com","password":"REPLACE_LOCALLY"}'
curl -b cookies.txt "$API/admin/categories" -H 'Content-Type: application/json' \
  --data '{"name":"ایران","slug":"iran"}'
# CATEGORY_ID را با خروجی درخواست قبل جایگزین کنید.
curl -b cookies.txt "$API/admin/news" -H 'Content-Type: application/json' \
  --data '{"title":"خبر نمونه","slug":"sample-news","lead":"لید","body":"متن","categoryIds":["CATEGORY_ID"]}'
# NEWS_ID را با خروجی ساخت خبر جایگزین کنید؛ نشست باید SUPER_ADMIN باشد.
curl -b cookies.txt "$API/admin/news/NEWS_ID/status" -H 'Content-Type: application/json' \
  --data '{"status":"PUBLISHED"}'
curl "$API/news?categorySlug=iran&page=1&pageSize=20"
curl "$API/news/sample-news"
curl -b cookies.txt -X PATCH "$API/admin/news/NEWS_ID" -H 'Content-Type: application/json' \
  --data '{"summary":null}'
# فقط برای دادهٔ آزمایشی: حذف واقعی است.
curl -b cookies.txt -X DELETE "$API/admin/news/NEWS_ID"
rm -f cookies.txt
```
