# گزارش تحویل مرحلهٔ ۴

تاریخ: 2026-09-08. ورودی: ZIP بک‌اند مرحلهٔ ۳ و مشخصات News/Category CRUD.

تحویل شامل کل backend است، نه فقط patch. فایل‌های قبلی که نیاز به تغییر نداشتند بایت‌به‌بایت حفظ شده‌اند. schema و migrations، auth.plugin، prisma.plugin، users، media، auth.service/schema/cookie/password، server، env، logger، CLI و تست‌های قبلی حفظ شده‌اند. README قبلی برای رجوع تاریخی در AUTH-STAGE-3.md نیز آمده است.

پیاده‌سازی‌شده: اصلاح A.1، اصلاح استنباط Logger برای A.2، ۵ endpoint دسته‌بندی، ۶ endpoint خبر admin، ۲ endpoint خبر عمومی، validation سخت‌گیرانه، policy مشترک، state machine، تراکنش و retry کنترل‌شده، response allowlist، CORS متدهای جدید، تست‌ها و مستندات.

**تأییدشده در محیط ساخت:** syntax ۴۴ فایل، ۷ تست مستقل و بررسی importهای محلی/حفظ فایل‌های حساس. اعداد و خروجی دقیق در STATIC-CHECKS.txt.

**تأییدنشده:** نصب وابستگی‌های واقعی، Prisma generate، typecheck کامل TypeScript 5.9.2، build، regression tests Auth، HTTP Fastify و integration PostgreSQL. نبود اینترنت در محیط ساخت و نبود npm/dependencyهای لازم اجازهٔ اجرای این بخش‌ها را نداد. بنابراین ادعای تمام‌شدن acceptance criteria مرتبط با build/runtime نداریم.

نسخهٔ Helmet 13.1.1 بر اساس بررسی عمومی پین شده؛ نسخهٔ جدیدترِ تأییدشده‌ای برای حل logger mismatch یافت نشد. هیچ تنظیم سخت‌گیرانهٔ TS خاموش نشده است. تغییر Logger در factory مستند است و cast به any وجود ندارد.

پیش از انتشار: npm install، migrate روی دیتابیس موقت، typecheck، build، npm test، test:integration و سپس تولید/ثبت lockfile واقعی. تنظیمات دامنهٔ same-site، HTTPS، پراکسی قابل اعتماد و secret قوی را جدا بررسی کنید. این فایل ادعای تأیید production نیست.
