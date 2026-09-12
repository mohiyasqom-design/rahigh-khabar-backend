# تصمیم‌های مرحلهٔ ۴ و اصلاح Auth

## A.1: پاسخ‌های غیر۲۰۰ Auth

در `auth.routes.ts` فقط response schema توسعه یافته است. success schema موجود حفظ شده و schema خطای مشترک برای statusهای 400/401/403/404/409/413/415/429/500 اضافه شده است. این باعث می‌شود reply.code برای پاسخ‌های غیر۲۰۰ خارج از قرارداد استنباط‌شده نباشد. schema مشترک علاوه بر `{ code, message }`، شکل قبلی `{ error }` را هم می‌پذیرد تا خطای malformed JSON و محدودیت اندازه باعث خطای serialization یا تغییر رفتار Auth نشود. منطق login/logout/me، متن پاسخ‌ها و سیاست کوکی بازنویسی نشده‌اند.

## A.2: logger و ثبت plugin

فایل واقعی پیوست در خط ۱۸ `configureErrorHandlers(app)` داشت، نه `app.register(helmet)` که در شرح مسئله آمده بود. امضای خطای گزارش‌شده نیز به تفاوت `FastifyBaseLogger` و Pino `Logger<never, boolean>` در `childLoggerFactory` اشاره می‌کند. سازندهٔ Fastify قبلاً نوع تخصصی Pino را از `loggerInstance` استنباط می‌کرد، در حالی که helperها و pluginها از قرارداد پیش‌فرض FastifyBaseLogger استفاده می‌کنند.

اصلاح در ریشه انجام شده است: پارامتر generic مربوط به Logger در factory صریحاً `FastifyBaseLogger` است. نه cast سراسری وجود دارد، نه `any` در کد اجرایی جدید، نه `@ts-ignore` و نه کاهش strict/exactOptionalPropertyTypes. خود Logger همان خروجی createLogger و لاگ و Helmet همان رفتار runtime را دارند. ثبت Helmet بدون cast نگه داشته شده است. این رویکرد از cast خطی که اصلاً منشأ خطای فایل پیوست نبود دقیق‌تر است؛ تأیید نهایی با نسخه‌های واقعی وابستگی‌ها همچنان لازم است.

در بررسی عمومی ۸ سپتامبر ۲۰۲۶، صفحهٔ npm نسخهٔ 13.1.1 را نشان می‌داد و نسخهٔ جدیدترِ تأییدشده‌ای پیدا نشد. جدول سازگاری پروژه، Helmet >=12 را برای Fastify ^5 معرفی می‌کند. وابستگی Helmet روی 13.1.1 پین شده است؛ ادعای انتشار upstream fix نداریم و نصب این نسخه در محیط ساخت اجرا نشده است.

منابع بررسی:
- https://www.npmjs.com/package/@fastify/helmet
- https://github.com/fastify/fastify-helmet/blob/master/README.md
- https://newreleases.io/project/npm/@fastify/helmet/release/13.1.1

## دسترسی و قرارداد ورودی

`news.policy.ts` یک policy مشترک برای scope لیست و بررسی مالکیت/عملیات دارد؛ routeها مسئول احراز هویت و نقش پایه‌اند، serviceها مسئول بررسی همان policy روی رکورد هدف. ADMIN در ARCHIVED هم حق ویرایش ندارد، حتی اگر خبر هیچ‌وقت منتشر نشده باشد. SUPER_ADMIN محدودیت مالکیت یا وضعیت برای PATCH ندارد.

تمام bodyها strict هستند؛ فیلد اضافی مثل status/authorId/publishedAt در ساخت یا PATCH، خطای 400 دارد. ارسال `null` فیلدهای اختیاری nullable را پاک می‌کند؛ حذف فیلد از PATCH به معنی حفظ مقدار قبلی است. PATCH خالی و categoryIds خالی/تکراری رد می‌شوند. slug خبر و دسته‌بندی لاتین کوچک با عدد و خط تیره است. شناسه‌ها opaque string هستند؛ اعتبار وجود رابطه در دیتابیس بررسی می‌شود، نه با حدس فرمت cuid.

## جدول کامل گردش انتشار

| وضعیت فعلی | وضعیت‌های بعدی مجاز |
| --- | --- |
| DRAFT | IN_REVIEW, PUBLISHED, REJECTED, ARCHIVED |
| IN_REVIEW | PUBLISHED, REJECTED, ARCHIVED |
| PUBLISHED | ARCHIVED |
| REJECTED | DRAFT |
| ARCHIVED | PUBLISHED |

DRAFT به IN_REVIEW برای قابل‌استفاده‌بودن وضعیت بازبینی اضافه شده است. ARCHIVED به PUBLISHED برای انتشار مجدد لازم است. هر دو فقط توسط SUPER_ADMIN ممکن‌اند. تکرار همان وضعیت نیز 400 است، نه عملیات idempotent. در اولین انتشار، publishedAt تنظیم می‌شود و پس از archive/republish تغییر نمی‌کند. ARCHIVED از خبر منتشرنشده هم در انتشار اول timestamp می‌گیرد. تغییر به هیچ وضعیت دیگری timestamp را پاک نمی‌کند.

## تراکنش و روابط

خواندن وضعیت/مالکیت و write مربوط به خبر در یک Serializable transaction است. P2034 تا سه تلاش انجام می‌شود؛ سپس پاسخ عمومی 409 است. در رقابت PATCH یک Admin با انتشار Super Admin، بررسی وضعیت بعد از serialization retry دوباره انجام می‌شود. جایگزینی categoryIds، بررسی Media و write خبر اتمیک‌اند. خطاهای یکتایی و FK به پاسخ امن 409/400 تبدیل می‌شوند؛ متن خام Prisma بیرون نمی‌رود.

لیست و count در تراکنش RepeatableRead هستند تا pagination یک snapshot منسجم داشته باشد؛ این snapshot بین دو درخواست جدا حفظ نمی‌شود. مرتب‌سازی عمومی publishedAt نزولی، nullها آخر و id نزولی برای tie-break است. حد pageSize برابر 100 و page برابر 100000 است.

حذف Category عمداً مجاز است حتی اگر به خبر منتشرشده وصل باشد. Cascade فقط NewsCategory را حذف می‌کند؛ خود خبر باقی می‌ماند و حتی ممکن است دیگر هیچ دسته‌بندی نداشته باشد. این استثنای آگاهانه با الزام دسته‌بندی غیرخالی در create یا PATCH دارای categoryIds تناقض اجرایی ندارد. تغییر دسته‌بندی عمومی پس از حذف فوری است؛ Media حذف نمی‌شود.

## موارد خارج از محدوده

schema، migrationها، auth.plugin، prisma.plugin، ماژول users و منطق Auth دست‌نخورده‌اند؛ تنها auth.routes برای A.1 تغییر کرده است. هیچ AI، آپلود، frontend، audit-log model، تاریخ‌سازی publishedAt یا soft-delete اضافه نشده است. endpoint وضعیت یک عملیات آگاهانه است، ولی تاریخچهٔ کامل ممیزی ذخیره نمی‌کند؛ schema فعلی مدل آن را ندارد. Rate limiting قبلی login حفظ شده؛ write limiter جدید اضافه نشده است. فیلد محرمانهٔ جدیدی وارد سیستم نشده و تنظیمات redact فعلی حفظ شده‌اند. محتوای ورودی خبر در لاگ ثبت نمی‌شود.
