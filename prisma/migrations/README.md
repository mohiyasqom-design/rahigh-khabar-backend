# مرحله ۲: مدل داده و migration اولیه

این تحویل بر پایه ZIP اصلاح‌شده مرحله ۱ است. تنها فایل موجود که تغییر کرده `prisma/schema.prisma` است؛ این پوشه migration جدید است. کد اجرایی، وابستگی‌ها، README اصلی و اصلاح FastifyError دست‌نخورده‌اند. توضیحات «بدون مدل» در README اصلی مربوط به مرحله ۱ است؛ برای حفظ محدودیت تغییر فایل‌ها، آن متن ویرایش نشده است.

## وضعیت واقعی تحویل

`20260908125500_init_core_models/migration.sql` **دستی نوشته شده** و خروجی اجرای `prisma migrate dev` نیست. هیچ migration روی دیتابیس اعمال نشده است. محیط ساخت اینترنت، Prisma نصب‌شده و PostgreSQL آماده نداشته؛ `prisma validate`، تولید Client، type-check و build اجرا نشده‌اند. بررسی‌های انجام‌شده ایستا هستند و جای تأیید Prisma یا PostgreSQL را نمی‌گیرند.

## مدل‌ها و تصمیم‌ها

پنج مدل User، News، Category، Media و NewsCategory و دو enum Role و NewsStatus ساخته شده‌اند. نام جدول‌ها snake_case است؛ نام ستون‌ها مطابق فیلدهای camelCase باقی می‌ماند. شناسه‌ها با `cuid()` در Prisma Client ساخته می‌شوند؛ `updatedAt` نیز در لایه Prisma مدیریت می‌شود، نه با trigger دیتابیس.

رابطه خبر و دسته‌بندی از جدول واسط با کلید اصلی ترکیبی استفاده می‌کند. حذف هر طرف فقط رکوردهای واسطش را حذف می‌کند. حذف نویسنده دارای خبر با Restrict رد می‌شود؛ حذف تصویر شاخص فقط ارجاع اختیاری آن را با SetNull خالی می‌کند. این تصمیم‌ها در schema کامنت دارند.

ایندکس‌های status، publishedAt، ترکیبی آن دو و slug یکتا وجود دارند. ایندکس authorId، coverImageId و categoryId جدول واسط نیز برای جست‌وجوی معکوس و بررسی روابط اضافه شده‌اند؛ کلید اصلی واسط، newsId را پوشش می‌دهد.

هیچ seed، API یا منطق انتشار اضافه نشده است. تنظیم publishedAt، اعتبارسنجی slug لاتین دسته‌بندی، هش‌کردن رمز، جلوگیری از بازگرداندن passwordHash و تشویق altText وظیفه لایه‌های بعدی هستند؛ schema به‌تنهایی این رفتارها را اجرا نمی‌کند.

## بررسی و تولید واقعی migration

فقط روی محیط توسعه با PostgreSQL آزمایشی و دورریختنی کار کنید، نه دیتابیس production. ابتدا از ریشه backend با تنظیم متغیرهای محیطی معتبر اجرا کنید:

```sh
npm install
npx prisma validate
npm run prisma:generate
npm run typecheck
npm run build
```

برای مقایسه SQL هدف با خروجی واقعی Prisma 6.19.0 بدون اعمال آن به دیتابیس:

```sh
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/init_core_models.generated.sql
```

فایل تولیدی را با SQL این پوشه مقایسه معنایی کنید؛ ترتیب ایجاد جدول‌ها یا کامنت‌ها ممکن است متفاوت باشد. این فرمان جای اجرای migration را نمی‌گیرد.

برای تأمین شرط اصلی «تولید با migrate dev»، در یک **کپی آزمایشی تازه** از پروژه، SQL دستی را بیرون از `prisma/migrations` نگه دارید و زیرپوشه migration دستی را از آن کپی کنار بگذارید. `DATABASE_URL` را به دیتابیس توسعه خالی اختصاصی اشاره دهید و سپس اجرا کنید:

```sh
npm run prisma:migrate -- --name init_core_models
npm run prisma:generate
```

این فرمان دیتابیس آزمایشی را تغییر می‌دهد و برای shadow database به مجوز مناسب نیاز دارد. SQL و lock تولیدشده واقعی را بررسی کنید و پیش از اولین استقرار جایگزین نسخه دستی کنید. migration اعمال‌شده در محیط مشترک را بازنویسی نکنید. پوشه تولیدشده timestamp واقعی اجرای شما را خواهد داشت.

سپس در دیتابیس آزمایشی، یکتایی email و slug، جلوگیری از تکرار زوج خبر/دسته، Restrict نویسنده، SetNull تصویر و Cascade محدود به واسط را بررسی کنید. بدون این اجرای واقعی، معیارهای validate، generate و migration اجراشده هنوز تأییدشده نیستند.
