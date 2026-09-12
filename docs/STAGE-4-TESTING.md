# تست و تأیید نهایی مرحلهٔ ۴

## پیش‌نیاز و دستورات

در محیط دارای اینترنت نصب بسته، Node سازگار و npm:

```sh
npm install
npm run typecheck
npm run build
npm test
# فقط تست‌های جدید مستقل + HTTP مرحلهٔ چهار:
npm run test:news
```

typecheck شامل src، scripts و تمام tests با strict/exactOptionalPropertyTypes فعال است. build فقط src را در dist قرار می‌دهد. اجرای هر دستور تست ابتدا Prisma client واقعی را تولید می‌کند. HTTP tests از Fastify inject و mock دیتابیس استفاده می‌کنند؛ نتیجهٔ آن‌ها جای تست PostgreSQL را نمی‌گیرد. تست‌های قبلی Auth حفظ شده‌اند.

## تست واقعی PostgreSQL

**فقط دیتابیس موقت و جداگانه. هرگز production یا دیتابیس مشترک مهم را معرفی نکنید.** این مجموعه کاربر، دسته‌بندی، Media و خبر آزمایشی ایجاد/ویرایش/حذف می‌کند. تست‌ها شناسه‌های تصادفی دارند و cleanup انجام می‌دهند؛ در صورت قطع ناگهانی فرایند، دیتابیس موقت را حذف کنید.

```sh
export TEST_DATABASE_URL='postgresql://test:test@localhost:5432/rahigh_disposable'
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:migrate:deploy
npm run test:integration
```

setup تست مقدار DATABASE_URL را از TEST_DATABASE_URL می‌گیرد. نبود TEST_DATABASE_URL باعث توقف suite یکپارچه می‌شود. schema جدید نیست و فقط migration اصلی موجود اعمال می‌شود.

## پوشش تست‌های جدید

`news-validation.test.ts`: پنج تست، شامل فیلدهای اجباری، mass assignment، PATCH خالی/nullable، categoryIds خالی/تکراری، slug، pagination نامعتبر و status سخت‌گیرانه.

`news-policy.test.ts`: دو تست، شامل محدودیت مالکیت، تمام عملیات و وضعیت‌ها، scope لیست و تمام ۲۵ ترکیب state machine.

`news-routes.test.ts`: پنج تست HTTP، شامل ۴۰۱ تمام ۱۰ route ادمین، محدودیت Super Admin، ۴۰۳ مالکیت، allowlist response عمومی، فیلتر PUBLISHED در لیست/count، ۴۰۴ یکسان و CORS متدهای جدید.

`integration/news-postgres.test.ts`: سناریوی PostgreSQL با create/update/delete دسته‌بندی و خبر، یکتایی slug، شناسهٔ رابطهٔ ناموجود، جایگزینی اتمیک دسته‌بندی، مالکیت، فیلتر و pagination، گردش انتشار، دو انتشار هم‌زمان، حفظ publishedAt در انتشار مجدد، حذف دسته‌بندی خبر منتشرشده و حذف فیزیکی خبر. همراه suite اصلی Auth اجرا می‌شود.

## بررسی‌های واقعاً اجراشده در محیط ساخت

Node 22.23.1 موجود بود، ولی npm، Fastify، Prisma client، tsx و @types/node پروژه موجود نبودند؛ نصب از داخل محیط ساخت ممکن نیست چون اینترنت ندارد. TypeScript سراسری 5.6.3 و Zod 3.25.76 موجود بودند.

- syntax transpilation همهٔ ۴۴ فایل TS با TypeScript 5.6.3: بدون diagnostic نحوی.
- اجرای نسخهٔ JS حاصل از transpile فقط دو فایل news-validation و news-policy با node --test: هر ۷ تست موفق.
- تلاش برای tsc کامل پیش از تحلیل پروژه در نبود @types/node متوقف شد. این قبولی typecheck نیست.
- آزمون‌های HTTP/Auth/PostgreSQL، Prisma generate، npm run build و npm run typecheck واقعی اجرا نشدند.

خروجی JS بررسی، dependency mock ساختگی یا dist آزمایشی داخل تحویل قرار نگرفته است. تمام معیارهای وابسته به runtime واقعی و TypeScript 5.9.2 تا اجرای دستورات بالا تأییدنشده‌اند.
