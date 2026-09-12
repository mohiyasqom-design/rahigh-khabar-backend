# Media و SEO مرحلهٔ ۵

## نمونهٔ استفاده

از session cookie حاصل از login موجود استفاده کنید. رمز را در تاریخچهٔ shell نگذارید. نمونه‌ها local هستند؛ origin و مسیر API را در محیط واقعی عوض کنید.

```sh
# cookies.txt باید با login موجود ایجاد شده باشد.
curl -i -b cookies.txt -F 'file=@./cover.png;type=image/png' \
  -F 'altText=تصویر محل رویداد' http://localhost:3000/admin/media
curl -b cookies.txt 'http://localhost:3000/admin/media?page=1&pageSize=20'
# مقدار id را از پاسخ upload بگیرید؛ این فرمان نیازمند Super Admin است.
curl -i -b cookies.txt -X DELETE http://localhost:3000/admin/media/MEDIA_ID
curl -i http://localhost:3000/sitemap.xml
curl -i http://localhost:3000/robots.txt
curl -i http://localhost:3000/news/PUBLISHED_SLUG/structured-data
curl --path-as-is -i 'http://localhost:3000/uploads/../../../etc/passwd'
```

کلید فایل دقیقاً file است. altText می‌تواند قبل یا بعد از آن باشد. ترتیب مهم نیست. پاسخ موفق شامل id، url مطلق API، altText، width، height، sizeBytes، mimeType و createdAt است. فیلدهای مسیر دیسک یا نام فایل ورودی برگردانده نمی‌شوند. id را برای coverImageId در CRUD موجود خبر استفاده کنید.

## تفکیک originها

PUBLIC_SITE_URL برای canonical، loc نقشهٔ سایت، mainEntityOfPage و آدرس sitemap در robots است. PUBLIC_API_URL برای تصاویر استفاده می‌شود. اتکا به Host یا X-Forwarded-Host کاربر وجود ندارد. در آینده هر سه مسیر robots، sitemap اصلی و sitemapهای فرزند باید روی frontend rewrite شوند. مسیرهای عمومی frontend برای دسته و خبر به‌ترتیب /categories/:slug و /news/:slug هستند.

## persistence و جایگزینی adapter

MediaStorage در storage.ts قرارداد save/remove/prepareRemoval را تعریف می‌کند. جزئیات مسیر و فایل به route نشت نکرده است. برای مهاجرت به S3، adapter تازه و روش public serving را در media/index.ts جایگزین کنید؛ سرویس و route قرارداد ثابتی دارند. URLهای قبلی را در مهاجرت هماهنگ اصلاح کنید. adapter محلی از path ذخیره‌شده برای حذف استفاده می‌کند تا تغییر origin مانع حذف نشود؛ URLهای خارج از namespace محلی 409 می‌گیرند و فایل خارجی حذف نمی‌شود.

حذف، ابتدا media و شمار ارجاعات را می‌خواند ولی به‌دلیل وجود ارجاع منع نمی‌شود؛ FK موجود onDelete:SetNull مسئول همهٔ روابط است. عملیات DB در writeTransaction با Serializable/retry انجام می‌شود؛ عملیات filesystem بیرون callback قابل retry است. intent خصوصی با hard link روی همان filesystem ایجاد می‌شود، فایل پس از commit پاک می‌شود و recovery در startup intentهای نیمه‌کاره را بر اساس وجود رکورد DB تکمیل می‌کند. یک نمونهٔ فعال با یک upload root فرض شده است. filesystem باید hard link را پشتیبانی کند.

## تفاوت‌های News با مرحلهٔ قبل

فقط news.policy.ts برای fallback محلی allowed و news.service.ts برای updatedAt در select عمومی داخلی و normalization خروجی متادیتا تغییر کرده‌اند. news.schema.ts، news.public.routes.ts، validateReferences و state machine بدون تغییرند. endpoint JSON-LD در ماژول seo ثبت شده و getPublicNews را مستقیم فراخوانی می‌کند. schema.prisma و migration تغییری ندارند.

## نکات frontend

برای script از serialization امن JSON و escape کاراکتر < استفاده کنید. HTML متن خبر همچنان ورودی ذخیره‌شده است، نه HTML sanitize‌شده. image dimensions را روی عنصر تصویر قرار دهید. altText null را با متن توصیفی مناسب editorial رفع کنید، نه نام فایل تصادفی. fallback seoTitle باید در frontend به title باشد. datePublished تهی برای رکورد legacy به تاریخ ساخت تبدیل نمی‌شود؛ دادهٔ ناسالم را اصلاح کنید.
