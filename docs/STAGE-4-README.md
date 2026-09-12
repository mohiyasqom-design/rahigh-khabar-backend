# رحیق خبر | Backend مرحلهٔ ۴

نسخهٔ کامل بک‌اند بر پایهٔ ZIP مرحلهٔ ۳: رفع تایپ Auth، مدیریت دستی خبر و دسته‌بندی، کنترل نقش و مالکیت، گردش انتشار و API عمومی فقط برای اخبار منتشرشده. فرانت‌اند، AI، آپلود فایل و مدیریت کاربران در این مرحله اضافه نشده‌اند.

**وضعیت بررسی:** بررسی نحوی ۴۴ فایل TypeScript و ۷ تست مستقل اعتبارسنجی/دسترسی/انتقال وضعیت موفق بودند. نصب وابستگی‌ها، Prisma generate، typecheck کامل، build، تست HTTP و PostgreSQL انجام نشده‌اند. محیط ساخت اینترنت نصب بسته ندارد؛ npm و وابستگی‌های Fastify/Prisma نیز موجود نبودند. خروجی `dist` یا lockfile ساختگی تحویل داده نشده است. این محدودیت به معنی تأیید قبولی build نیست.

## اجرای محلی

Node.js نسخهٔ 22.12 به بعد در شاخهٔ 22 یا شاخهٔ 24، npm و PostgreSQL لازم است.

```sh
cd backend
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# خروجی را در JWT_SECRET قرار دهید؛ DATABASE_URL و CORS_ORIGIN را تنظیم کنید.
npm install
npm run prisma:migrate:deploy
npm run typecheck
npm run build
npm test
npm run create-admin -- --email admin@example.com --display-name "مدیر کل"
npm start
```

`npm run dev` حالت توسعه است. رمز مدیر فقط در TTY امن پرسیده می‌شود، نه آرگومان خط فرمان. migration و schema قبلی بدون تغییر مانده‌اند؛ migration جدید لازم نیست. پس از نصب موفق، `package-lock.json` واقعی را ثبت کنید و سپس برای نصب تکرارپذیر `npm ci` بزنید.

## راهنماها

- [قرارداد کامل API و نمونه‌های curl](docs/API.md)
- [تصمیم‌ها و اصلاح دو باگ مرحلهٔ قبل](docs/MARHALE-4.md)
- [تست‌ها و مراحل تأیید نهایی](docs/TESTING.md)
- [گزارش تحویل](docs/DELIVERY.md) و [بررسی‌های اجراشده](docs/STATIC-CHECKS.txt)
- [راهنمای اصلی Auth مرحلهٔ ۳، برای جزئیات نشست و استقرار](docs/AUTH-STAGE-3.md)؛ توضیحات محدودهٔ پروژه در آن تاریخی است.

## تنظیمات و استقرار

متغیرهای قبلی حفظ شده‌اند: `NODE_ENV`, `PORT`, `DATABASE_URL`, `CORS_ORIGIN`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`, `TRUST_PROXY`. `.env.example` عمداً secret معتبر ندارد. نبود مقدار الزامی یا شکست اتصال دیتابیس در startup باعث توقف می‌شود؛ جزئیات حساس لاگ نمی‌شوند.

Railway: سرویس backend مجزا، build برابر `npm run build`، pre-deploy برابر `npm run prisma:migrate:deploy`، start برابر `npm start`، health برابر `/health` و `NODE_ENV=production`. ابزارهای dev و Prisma CLI باید در مرحلهٔ build/migration در دسترس باشند.

برای ارتباط مرورگر، دامنه‌های frontend و backend باید same-site باشند و HTTPS داشته باشند. کوکی `SameSite=Lax`، `httpOnly` و در production `Secure` است. `credentials: 'include'` را در fetch فعال کنید؛ توکن در localStorage ذخیره نشود. CORS فقط یک origin را می‌پذیرد و حالا `PUT`, `PATCH`, `DELETE` هم مجازند؛ این به معنی وجود endpoint از نوع PUT نیست. hook قبلی Origin/Fetch-Metadata بدون تغییر روی تمام عملیات نوشتن فعال است. `TRUST_PROXY` را فقط برای پراکسی واقعاً قابل اعتماد تنظیم کنید.

## خلاصهٔ دسترسی

ADMIN خبر را فقط با هویت خودش و وضعیت DRAFT می‌سازد، فقط خبرهای خودش را می‌بیند و فقط در DRAFT/IN_REVIEW/REJECTED ویرایش می‌کند. SUPER_ADMIN به همهٔ خبرها دسترسی دارد و تنها نقش مجاز برای انتشار، تغییر وضعیت و حذف خبر/دسته‌بندی است. دسته‌بندی را هر دو نقش می‌سازند و ویرایش می‌کنند. API عمومی همیشه فقط PUBLISHED را می‌خواند؛ ARCHIVED عمومی نیست.

تمام مسیرهای جدید admin دارای authenticate و requireRole به ترتیب صحیح‌اند. اطلاعات داخلی نویسنده با allowlist دیتابیس و response serializer از پاسخ عمومی حذف می‌شوند. تغییرات هم‌زمان با تراکنش Serializable کنترل می‌شوند. داده‌های خبر متن ذخیره‌شده‌اند، نه HTML امن تأییدشده: فرانت‌اند نباید بدون sanitization آن‌ها را با dangerouslySetInnerHTML نمایش دهد.
