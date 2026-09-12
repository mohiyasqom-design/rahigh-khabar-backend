# مرحلهٔ ۵

اصلاح نوع allowed در policy بدون تغییر انتقال‌ها؛ اضافه‌شدن Media/SEO؛ بدون تغییر schema، Auth یا Category. شرح و محدودیت اجرا در DELIVERY.md و README فعلی.

---

# فهرست تغییرات مرحلهٔ ۴

## فایل‌های موجود تغییرکرده

- `README.md`
- `docs/DELIVERY.md`
- `docs/STATIC-CHECKS.txt`
- `docs/TESTING.md`
- `package.json`
- `src/app.ts`
- `src/modules/auth/auth.routes.ts`
- `src/modules/categories/index.ts`
- `src/modules/news/index.ts`
- `src/plugins/cors.plugin.ts`
- `src/utils/error-handlers.ts`

## فایل‌های افزوده‌شده

- `docs/API.md`
- `docs/AUTH-STAGE-3.md`
- `docs/MARHALE-4.md`
- `src/modules/categories/categories.routes.ts`
- `src/modules/categories/categories.schema.ts`
- `src/modules/categories/categories.service.ts`
- `src/modules/news/news.admin.routes.ts`
- `src/modules/news/news.policy.ts`
- `src/modules/news/news.public.routes.ts`
- `src/modules/news/news.schema.ts`
- `src/modules/news/news.service.ts`
- `src/utils/api-error.ts`
- `src/utils/database.ts`
- `src/utils/http-schemas.ts`
- `src/utils/validation.ts`
- `tests/integration/news-postgres.test.ts`
- `tests/news-policy.test.ts`
- `tests/news-routes.test.ts`
- `tests/news-validation.test.ts`

`FILES.sha256` نیز برای کل تحویل دوباره تولید شده است. این گزارش خود یک فایل افزوده‌شده است. فایل اصلی پروژه و هیچ دادهٔ زنده‌ای تغییر نکرده‌اند.
