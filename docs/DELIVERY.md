# گزارش تحویل مرحلهٔ ۵

تحویل: کل backend بر پایهٔ ZIP کاربر، به‌همراه اصلاح مستقل مرحلهٔ ۴ در بستهٔ جدا. فقط news.policy.ts در بستهٔ اصلاح مستقل وجود دارد؛ allowedTransitions و تست اصلی policy و تنظیمات strict بدون تغییرند.

پیاده‌سازی: upload تک‌تصویر JPEG/PNG/WebP با MIME و signature و structural check، image-size برای ابعاد، سقف multipart، filename تصادفی، adapter local، فایل استاتیک allowlist، pagination، حذف Super Admin و SetNull ارجاعات، marker خصوصی recovery، Sitemap با child map برای رشد، robots و NewsArticle، normalization متادیتا، env fail-fast، تست‌ها و مستندات.

**تأییدشده:** ۱۷ تست مستقل، XML نمونه و index معتبر، syntax فایل‌های TypeScript، حفظ schema/migrations/tsconfig/Auth/Category و news-policy.test اصلی.

**تأییدنشده:** نصب نسخه‌های package.json، Prisma generate، typecheck کامل با TypeScript پروژه، npm build، تست‌های Fastify/image-size، PostgreSQL، URL مرورگر، Railway، frontend rewrite، rich-results خارجی. محیط ساخت اینترنت و npm و dependencyهای لازم ندارد. dist یا lockfile جعلی تولید نشده است. تست‌های مستقل با transpilation بدون typecheck اجرا شده‌اند.

PUBLIC_API_URL علاوه بر PUBLIC_SITE_URL اضافه شد تا URL تصویر از دامنهٔ backend درست باشد و به Host کنترل‌شده توسط کاربر وابسته نباشد. getPublicNews فقط updatedAt لازم برای JSON-LD و null کردن متادیتای سفید/خالی را تغییر می‌دهد؛ validateReferences دست‌نخورده است. حافظهٔ upload به سقف env محدود است؛ ذخیرهٔ local و پشتیبانی یک instance تصمیم این فاز است، نه معماری نهایی چند replica.

محدودیت مهم: file/DB تراکنش اتمیک مشترک ندارند. شکست متعارف create cleanup می‌شود؛ crash بین ذخیره و درج DB می‌تواند orphan بگذارد. حذف نیمه‌تمام با marker و DB lookup در startup بازیابی می‌شود. قبل از production باید استوریج پایدار، تست کامل، پایش، پشتیبان و رسیدگی به orphanها فراهم باشد.

README و گزارش‌های مرحلهٔ ۴ در docs/STAGE-4-* به‌عنوان تاریخچه نگهداری شده‌اند. مرجع وضعیت این تحویل، README فعلی و این گزارش است، نه ادعاهای شمارش مرحله‌های قدیمی.
