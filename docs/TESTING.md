# تأیید نسخهٔ مرحلهٔ ۵

## اجراهای واقعی در محیط ساخت

۱۷ تست مستقل با Node 22.23.1 و transpilation نحوی TypeScript 5.6.3 پاس شدند: دو تست policy موجود (شامل هر ۲۵ انتقال و RBAC)، هشت تست storage، دو تست signature و پنج تست قالب SEO. هیچ وابستگی ساختگی برای Fastify/Prisma/image-size جایگزین نشده است. loader موقت فقط import نسبی .js را به منبع .ts وصل و نوع‌ها را حذف کرده است؛ این کار typecheck نیست. XML نمونه و index با parser استاندارد Python اعتبارسنجی شدند. جزئیات در STATIC-CHECKS.txt.

## پیش‌نیازهای اجرای کامل

npm، نسخه‌های واقعی package.json، Prisma Client تولیدشده و یک PostgreSQL موقت migrate‌شده لازم‌اند. محیط ساخت اینترنت ندارد؛ وابستگی‌ها نصب و دستورات npm اجرا نشده‌اند. TypeScript حاضر 5.6.3 است، نه نسخهٔ ~5.9.2 پروژه. اقدام مستقیم برای typecheck در همان ابتدا به نبود @types/node متوقف شد. این خطا تأیید یا رد سایر typeهای پروژه نیست.

```sh
npm install
npm run prisma:generate
npm run typecheck
npm run build
npm test
npm run test:media-seo
# فقط پایگاه آزمایشی دورریختنی، نه production:
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/rahigh_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:migrate:deploy
npm run test:integration
```

TEST_DATABASE_URL را پیش از فرمان migration export کنید؛ مقدار نمونه را با اتصال واقعی جایگزین کنید. تست‌های یکپارچه fail-fast می‌شوند اگر TEST_DATABASE_URL تنظیم نباشد. integration به‌صورت sequential اجرا می‌شود تا چند فرآیند به upload root مشترک دست نزنند. تست media/SEO پوشهٔ موقت اختصاصی دارد و داده‌های خودش را پاک می‌کند.

## پوشش نوشته‌شده ولی اجرا‌نشده

media-image: ابعاد واقعی هر سه فرمت با image-size، MIME نامعتبر و header جعلی.
media-routes: نشست/نقش زنده، upload و altText، صفحه‌بندی، فایل بزرگ، فرم خالی، فایل دوم، ورودی نامعتبر، cleanup شکست DB، delete rollback، سرو عمومی و path traversal.
seo-routes: Content-Typeها، sitemap کوچک/بزرگ/خالی، فیلتر PUBLISHED و select محدود، robots، JSON-LD، 404 یکسان و normalization متادیتا.
seo-environment: نبود/نامعتبر بودن originها و محدودیت upload، پیام fail-fast بدون افشای مقدار.
integration/media-seo-postgres: آپلود واقعی HTTP، ساخت پنج وضعیت خبر روی PostgreSQL، عدم افشای غیرعمومی، حذف Media متصل به پنج خبر، SetNull همهٔ ارجاعات و حذف فایل فیزیکی.
تمام تست‌های قبلی Auth/News/Category نیز باید اجرا شوند.

## Gate پیش از استقرار

- نصب و ثبت lockfile واقعی، typecheck و build بدون خطا.
- regression و تست‌های HTTP/integration موفق روی نسخه‌های واقعی.
- curl واقعی فایل از url بازگشتی، نه فقط inject.
- بررسی مسیرهای encoded traversal و dotfile با curl --path-as-is؛ خارج از uploads هیچ فایل نباید سرو شود.
- اتصال volume پایدار، پشتیبان، ظرفیت دیسک و یک replica؛ آزمون redeploy بدون از دست رفتن تصویر.
- proxy همهٔ مسیرهای sitemap و robots روی origin frontend و بررسی URLهای canonical.
- بررسی HTTPS، same-site cookie، CORS، Origin/Fetch-Metadata و rate/concurrency در ingress.
- بررسی NewsArticle در validator خارجی و Google Rich Results؛ این تست‌های اینترنتی در محیط ساخت اجرا نشده‌اند.

## تکرار زیرمجموعهٔ مستقل پس از نصب tsx

```sh
node --import tsx --test tests/news-policy.test.ts tests/media-storage.test.ts tests/media-signature.test.ts tests/seo-format.test.ts
```

این زیرمجموعه نیازی به DB یا env ندارد. نصب tsx و وابستگی‌های واقعی پروژه باید در محیط دارای دسترسی اینترنت انجام شود.
