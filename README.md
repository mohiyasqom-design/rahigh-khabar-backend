# رحیق خبر | Backend مرحلهٔ ۵

نسخهٔ کامل بک‌اند Fastify 5.11.2 + TypeScript strict + Prisma 6.19.0 + PostgreSQL، بر پایهٔ ZIP پیوست مرحلهٔ ۴. شامل اصلاح مستقل خطای policy مرحلهٔ ۴، آپلود و مدیریت تصویر، فایل استاتیک عمومی، Sitemap، Robots و NewsArticle JSON-LD است. فرانت‌اند، OAuth، AI، S3 و پردازش/تبدیل تصویر در این تحویل اضافه نشده‌اند.

**وضعیت واقعی:** ۱۷ تست مستقل policy، ساختار فایل تصویر، ذخیره‌سازی محلی و قالب SEO پاس شده‌اند. بررسی نحوی فایل‌های TypeScript و XML نمونه نیز انجام شده است. این‌ها تأیید typecheck کامل یا build نیستند: محیط ساخت دسترسی اینترنت ندارد و npm، Fastify، Prisma، image-size، tsx و PostgreSQL نصب نیستند. تست‌های HTTP و یکپارچه نوشته شده‌اند، اما اجرا و تأیید نشده‌اند. گزارش دقیق در [DELIVERY](docs/DELIVERY.md) و [STATIC-CHECKS](docs/STATIC-CHECKS.txt).

## هشدار ضروری برای Railway

**uploads/ روی دیسک موقت container برای production قابل اتکا نیست و با redeploy از بین می‌رود. پیش از اولین استقرار واقعی، یا UPLOAD_DIR را روی Railway Volume پایدار mount کنید، یا adapter ذخیره‌سازی را به R2/S3 منتقل کنید.** از دیتابیس و فایل‌ها هماهنگ پشتیبان بگیرید. این adapter برای یک نمونهٔ backend است، نه چند replica با دیسک مشترک یا ephemeral. مسیر داده باید اختصاصی و فقط در اختیار فرآیند backend باشد. پوشهٔ src، ریشهٔ پروژه، dist و node_modules به‌عنوان upload root پذیرفته نمی‌شوند. مسیر custom را نیز در .gitignore پروژهٔ خود وارد کنید.

## اجرای محلی

Node.js شاخهٔ 22 از نسخهٔ 22.12 به بعد یا شاخهٔ 24، npm و PostgreSQL لازم است.

```sh
cd backend
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# خروجی را در JWT_SECRET قرار دهید؛ DATABASE_URL و دامنه‌ها را تنظیم کنید.
npm install
npm run prisma:migrate:deploy
npm run typecheck
npm run build
npm test
npm run create-admin -- --email admin@example.com --display-name "مدیر کل"
npm start
```

بعد از نصب موفق، lockfile واقعی تولیدشده را ثبت و برای نصب‌های بعدی از `npm ci` استفاده کنید. ZIP اولیه lockfile نداشت؛ lockfile یا خروجی dist ساختگی تولید نشده است. schema و migration قبلی بایت‌به‌بایت حفظ شده‌اند و migration جدید لازم نیست؛ توضیحات تاریخی migration دستی در `prisma/migrations/README.md` همچنان معتبر است.

## تنظیمات جدید

| متغیر | مقدار/قرارداد |
| --- | --- |
| PUBLIC_SITE_URL | الزامی؛ origin عمومی frontend مثل https://rahighkhabar.ir، بدون slash انتهایی، path، query یا اطلاعات ورود |
| PUBLIC_API_URL | الزامی؛ origin عمومی backend مثل https://api.rahighkhabar.ir، برای URL مطلق تصویر و JSON-LD، نه مقدار Host دریافتی از کاربر |
| MAX_UPLOAD_SIZE_BYTES | پیش‌فرض 5242880 (۵ MiB)، عدد صحیح مثبت، سقف تنظیم 52428800 |
| UPLOAD_DIR | پیش‌فرض uploads، نسبت به working directory؛ روی Railway باید به فضای پایدار اشاره کند |

دو origin بالا از CORS_ORIGIN حدس زده نمی‌شوند. نبود/نامعتبر بودن آن‌ها fail-fast است. متغیرهای قبلی NODE_ENV، PORT، DATABASE_URL، CORS_ORIGIN، JWT_SECRET، JWT_EXPIRES_IN، AUTH_RATE_LIMIT_MAX، AUTH_RATE_LIMIT_WINDOW_MS و TRUST_PROXY بدون تغییر معنایی حفظ شده‌اند. دامنه‌ها در production باید HTTPS و برای نشست مرورگر same-site باشند. fetch ادمین به `credentials: 'include'` نیاز دارد.

## قراردادهای جدید

| مسیر | دسترسی و نتیجه |
| --- | --- |
| POST /admin/media | ADMIN و SUPER_ADMIN؛ multipart، دقیقاً یک فیلد فایل به نام file و altText اختیاری، پاسخ 201 رکورد کامل Media |
| GET /admin/media?page=1&pageSize=20 | هر دو نقش؛ صفحه‌بندی با سقف pageSize=100 |
| DELETE /admin/media/:id | فقط SUPER_ADMIN؛ حذف فایل و رکورد، تمام coverImageIdها با FK قبلی null می‌شوند؛ پاسخ 204 |
| GET /uploads/:filename | عمومی؛ فقط نام UUID با پسوند jpg/png/webp، بدون فهرست پوشه و dotfile |
| GET /sitemap.xml | عمومی، XML؛ صفحهٔ اصلی، دسته‌بندی‌ها و فقط اخبار PUBLISHED |
| GET /sitemaps/:page.xml | فرزند sitemap برای بیش از ۱۰هزار URL؛ حداکثر ۱۰هزار ورودی در هر صفحه |
| GET /robots.txt | عمومی، text/plain؛ Allow عمومی، Disallow مسیر admin و sitemap روی دامنهٔ frontend |
| GET /news/:slug/structured-data | عمومی؛ NewsArticle، فقط PUBLISHED؛ 404 یکسان برای خبر مفقود و غیرعمومی |

مسیر قراردادی دسته در frontend برابر `/categories/:slug` و خبر `/news/:slug` است. **Frontend باید /sitemap.xml، /sitemaps/* و /robots.txt را از backend proxy/rewrite کند یا معادل آن‌ها را از API بخواند و روی دامنهٔ خود پاسخ دهد.** تنها وجود endpoint روی دامنهٔ API کافی نیست. این تحویل شامل ساخت frontend یا تنظیم DNS نیست.

متادیتای خالی/سفید seoTitle و metaDescription در پاسخ جزئیات عمومی null می‌شود؛ title جای seoTitle قرار داده نمی‌شود. updatedAt فقط به select داخلی getPublicNews اضافه شده تا JSON-LD dateModified داشته باشد؛ قرارداد JSON عمومی خبر همان whitelist قبلی است. منطق validateReferences، Auth، Category، RBAC و state machine تغییر نکرده است؛ ARCHIVED → PUBLISHED محفوظ است.

## امنیت و محدودیت‌ها

نام اصلی فایل کاملاً نادیده گرفته می‌شود؛ magic bytes، MIME گزارش‌شده، ساختار سبک container و ابعاد image-size بررسی می‌شوند. GIF، SVG، اسکریپت با پسوند جعلی، MIME ناسازگار، فایل خالی/بریده و دادهٔ اضافی بعد از تصویر رد می‌شوند. این بررسی جای decoder کامل، antivirus یا پاک‌سازی metadata را نمی‌گیرد؛ هیچ resize، recompression یا EXIF stripping انجام نمی‌شود. فیلد altText اختیاری، trim و تا ۵۰۰ کاراکتر است؛ UI باید نوشتن توضیح واقعی را تشویق کند.

احراز هویت و نقش قبل از مصرف stream انجام می‌شود. multipart در سطح parser به یک فایل، یک فیلد متن، دو part و حجم تنظیم‌شده محدود است. فایل بزرگ و تعداد فایل بیش از مجاز 413، فرمت نامعتبر 415، نبود فایل/فیلد نامعتبر 400 است. همهٔ partها پیش از persistence اعتبارسنجی می‌شوند. فایل‌ها در حافظه تا سقف تنظیم‌شده buffer می‌شوند؛ برای production محدودیت request/concurrency و نرخ در ingress لازم است.

فایل‌ها با نام تصادفی و write موقت/rename منتشر می‌شوند. شکست معمول درج DB باعث پاک‌سازی فایل می‌شود. حذف از marker خصوصی `.pending-delete` استفاده می‌کند؛ تا commit، فایل قابل‌خواندن است. خطای پاک‌سازی دیسک 500 می‌دهد، نه موفقیت کاذب؛ در startup بعدی، وضعیت DB برای تکمیل حذف بررسی می‌شود. خطای DB هنگام recovery باعث توقف startup می‌شود. crash میان ساخت فایل و درج DB هنوز ممکن است فایل یتیم ایجاد کند؛ قبل از پاک‌سازی دوره‌ای باید URLهای جدول Media با فایل‌ها تطبیق داده شوند، نه حذف کورکورانه. پشتیبان و پایش فضای دیسک ضروری‌اند.

تصاویر عمومی یک ساعت قابل cache هستند؛ حذف فایل از origin نسخهٔ cache‌شده را از مرورگر/CDN پس نمی‌گیرد. اخبار و SEO no-store هستند. Robots ابزار کنترل دسترسی نیست. JSON-LD پاسخ JSON است؛ هنگام درج در script باید `JSON.stringify(data).replace(/</g, '\\u003c')` استفاده شود، نه الحاق مستقیم متن. نویسندهٔ عمومی فقط displayName دارد. publishedAt تهی در دادهٔ قدیمی جعل نمی‌شود و در JSON-LD null می‌ماند؛ چنین داده‌ای باید پیش از بررسی Rich Results اصلاح شود.

## راهنماها

- [Media/SEO، نمونهٔ curl و قرارداد فرانت‌اند](docs/MEDIA-SEO.md)
- [تست و چک‌لیست تأیید نهایی](docs/TESTING.md)
- [گزارش تحویل](docs/DELIVERY.md)
- [API قبلی Auth/News/Category](docs/API.md)
- [README تاریخی مرحلهٔ ۴](docs/STAGE-4-README.md) و [راهنمای Auth](docs/AUTH-STAGE-3.md)

Railway: build=`npm run build`، pre-deploy=`npm run prisma:migrate:deploy`، start=`npm start` و health=`/health`. devDependencies و Prisma CLI باید در مرحلهٔ build در دسترس باشند. این نسخه تا اجرای تست‌های کامل، تأییدشده برای production محسوب نمی‌شود.
