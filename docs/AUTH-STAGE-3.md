# رحیق خبر | Backend مرحلهٔ ۳: احراز هویت مدیران

بک‌اند مستقل Fastify 5 + TypeScript + Prisma 6 + PostgreSQL، بر پایهٔ فایل پروژهٔ پیوست. این تحویل فقط احراز هویت پنل مدیریت را اضافه می‌کند؛ فرانت‌اند Next.js، ثبت‌نام عمومی، OAuth، هوش مصنوعی و API مدیریت کاربران در این مرحله نیستند.

**وضعیت تحویل:** کد و تست‌ها نوشته شده‌اند. بررسی syntax، مسیر importها و چند تست مستقلِ اعتبارسنجی اجرا شده‌اند؛ نصب وابستگی‌ها، typecheck کامل، build و تست‌های HTTP/PostgreSQL در محیط تحویل اجرا نشده‌اند. جزئیات در `docs/DELIVERY.md` است. این نسخه هنوز تأیید آماده‌بودن برای production نیست.

## راه‌اندازی

نیازمندی‌ها: Node.js از نسخهٔ 22.12 به بعد در شاخهٔ 22، یا شاخهٔ 24؛ npm؛ PostgreSQL قابل دسترس. برای دریافت بسته‌ها و Prisma Engine، محیط نصب باید اینترنت داشته باشد. Argon2 از ماژول native استفاده می‌کند؛ اگر باینری آماده برای سیستم‌عامل موجود نباشد، ابزار build بومی مثل Python و کامپایلر C/C++ لازم می‌شود.

```sh
cd backend
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# خروجی را فقط در JWT_SECRET داخل .env یا secret محیط استقرار قرار دهید.
# DATABASE_URL و CORS_ORIGIN را نیز تنظیم کنید.
npm install
npm run prisma:migrate:deploy
npm run typecheck
npm run build
npm run create-admin -- --email admin@example.com --display-name "مدیر کل"
npm start
```

برای توسعه به جای `npm start` از `npm run dev` استفاده کنید. پورت پیش‌فرض backend برابر 3000 است. مسیر production همچنان `dist/server.js` است. `typecheck` سورس، اسکریپت CLI و تست‌ها را بررسی می‌کند؛ `build` فقط سورس اجرایی را به `dist` می‌برد.

هیچ فایل lock ساختگی اضافه نشده است. پس از نصب موفق و بازبینی، `package-lock.json` را commit کنید و در نصب‌های بعدی `npm ci` به کار ببرید. نسخهٔ Fastify و Prisma از پروژهٔ اولیه حفظ شده‌اند؛ بازبینی آسیب‌پذیری وابستگی‌ها پیش از انتشار لازم است.

## متغیرهای محیطی

| متغیر | رفتار |
| --- | --- |
| `DATABASE_URL` | الزامی؛ URL معتبر PostgreSQL با نام دیتابیس |
| `CORS_ORIGIN` | الزامی؛ یک origin کامل HTTP(S)، بدون مسیر و اسلش پایانی |
| `JWT_SECRET` | الزامی؛ حداقل ۳۲ کاراکتر غیرصرفاً whitespace؛ یک مقدار تصادفی قوی تولید کنید |
| `JWT_EXPIRES_IN` | پیش‌فرض `1h`؛ عدد صحیح همراه `s`، `m`، `h` یا `d`؛ از ۶۰ ثانیه تا ۷ روز |
| `AUTH_RATE_LIMIT_MAX` | پیش‌فرض ۵ تلاش ورود به ازای هر IP؛ بازهٔ تنظیم ۱ تا ۱۰۰ |
| `AUTH_RATE_LIMIT_WINDOW_MS` | پیش‌فرض ۹۰۰۰۰۰، یعنی ۱۵ دقیقه؛ بازهٔ تنظیم ۱ ثانیه تا ۱ روز |
| `TRUST_PROXY` | پیش‌فرض خالی؛ فقط IP یا CIDR پراکسی‌های واقعاً قابل اعتماد، جداشده با ویرگول |
| `NODE_ENV` | `development`، `test` یا `production` |
| `PORT` | پیش‌فرض 3000؛ عدد صحیح ۱ تا ۶۵۵۳۵ |

ورودی مبهم مثل `JWT_EXPIRES_IN=3600` پذیرفته نمی‌شود؛ `3600s` معتبر است. secret ضعیف و قابل حدس را نمی‌توان صرفاً با بررسی طول امن کرد؛ مسئولیت تولید مقدار تصادفی با اپراتور است. `.env.example` عمداً secret معتبر ندارد و پیش از تنظیم اجرا متوقف می‌شود.

نبود متغیر الزامی یا مقدار نامعتبر باعث توقف startup می‌شود. پیام فقط نام فیلد را می‌گوید، نه مقدار آن. نبود فایل `.env` در Railway اشکال ندارد، به شرط تعریف متغیرهای لازم در محیط.

## قرارداد API

| مسیر | درخواست | نتیجه |
| --- | --- | --- |
| `POST /auth/login` | JSON شامل `email` و `password` | 200، اطلاعات عمومی کاربر و `Set-Cookie` |
| `POST /auth/logout` | بدون بدنه؛ نیازمند نشست معتبر نیست | 204، پاک‌کردن کوکی با همان نام و path |
| `GET /auth/me` | کوکی معتبر | 200، اطلاعات عمومی کاربر |
| `GET /health` | بدون احراز هویت | 200 یا 503، وضعیت دیتابیس |

پاسخ موفق login و me، بدون wrapper:

```json
{
  "id": "user-id",
  "email": "admin@example.com",
  "displayName": "مدیر کل",
  "role": "SUPER_ADMIN"
}
```

JWT در پاسخ JSON قرار نمی‌گیرد. هیچ‌گاه `passwordHash`، `isActive` یا مشخصات داخلی در پاسخ عمومی نیست. JSON schema پاسخ نیز یک لایهٔ اضافه برای حذف فیلدهای اضافی فراهم می‌کند.

خطاها:

| وضعیت | `code` و معنا |
| --- | --- |
| 400 | `INVALID_INPUT` برای خطاهای اعتبارسنجی Zod؛ خطای parser نیز 400 و بدون متن خام ورودی است |
| 401 | `INVALID_CREDENTIALS` و پیام یکسان «ایمیل یا رمز عبور نادرست است» برای ایمیل ناشناخته، رمز اشتباه و حساب غیرفعال |
| 401 | `UNAUTHORIZED` برای کوکی غایب، خراب، امضای نامعتبر، حساب حذف‌شده یا غیرفعال |
| 401 | `TOKEN_EXPIRED` برای نشست منقضی؛ فرانت‌اند باید ورود مجدد بخواهد |
| 403 | `FORBIDDEN` برای نقش غیرمجاز |
| 403 | `ORIGIN_NOT_ALLOWED` برای درخواست نوشتن با origin نامجاز یا Fetch Metadata از نوع cross-site |
| 413 / 415 | بدنهٔ بیش از حد یا نوع محتوا نامعتبر؛ login فقط JSON می‌پذیرد |
| 429 | `TOO_MANY_REQUESTS`؛ همراه `Retry-After` از rate limiter |
| 500 | پیام عمومی `Internal Server Error`؛ بدون جزئیات دیتابیس یا ورودی |

حساب غیرفعال و ایمیل ناشناخته همچنان یک بار Argon2 verify روی dummy hash انجام می‌دهند. این کار اختلاف آشکار زمان پردازش را کاهش می‌دهد، ولی تضمین زمان کاملاً ثابت برای تمام مسیرهای دیتابیس و شبکه نیست. ایمیل هنگام login و ساخت مدیر trim و lowercase می‌شود؛ رمز هرگز trim یا normalize نمی‌شود. حساب‌های قدیمی با ایمیل دارای حروف بزرگ، اگر خارج از این CLI ساخته شده باشند، باید پیش از استفاده با بررسی تعارض یکتایی توسط اپراتور یکسان‌سازی شوند؛ داده‌های موجود خودکار تغییر نکرده‌اند.

## کوکی، نشست و CSRF

کوکی توسعه `rk_auth` و در production برابر `__Host-rk_auth` است؛ تنظیمات: `httpOnly: true`، `sameSite: lax`، `path: /`، بدون `Domain` و در production با `secure: true`. TTL کوکی و JWT هم‌زمان و پیش‌فرض یک ساعت‌اند. claimهای برنامه فقط `userId` و `role` هستند؛ کتابخانه claimهای استاندارد `iat` و `exp` را اضافه می‌کند. الگوریتم صدور و تأیید HS256 محدود شده است.

**خروج، کوکی مرورگر را پاک می‌کند؛ JWT کپی‌شده را سمت سرور باطل نمی‌کند.** در این معماری stateless، replay توکن سرقت‌شده تا انقضا ممکن است. برای کاهش ریسک، زمان کوتاه، HTTPS و محافظت از cookie مهم‌اند. غیرفعال‌کردن کاربر در دیتابیس دسترسی تمام نشست‌های او را در درخواست بعدی قطع می‌کند؛ تغییر secret تمام توکن‌های قبلی را نامعتبر می‌کند. ابطال اختصاصی هر نشست به session store یا denylist نیاز دارد و برای حفظ schema فعلی اضافه نشده است. refresh token و تغییر رمز هم خارج از این مرحله‌اند.

CORS فقط origin مشخص را با credentials مجاز می‌کند. علاوه بر آن، hook عمومی روی متدهای نوشتن origin غیرمجاز، `Origin: null` و `Sec-Fetch-Site: cross-site` را رد می‌کند. login فقط `application/json` می‌پذیرد و کوکی SameSite=Lax است. درخواست بدون Origin برای کلاینت غیرمرورگری مانند CLI مجاز است. CORS به‌تنهایی کنترل دسترسی یا جایگزین CSRF نیست؛ در آینده endpoint تغییر وضعیت با GET اضافه نکنید.

**استقرار مرورگری این نسخه باید same-site باشد:** مثلاً `https://admin.example.com` و `https://api.example.com` با دامنهٔ مشترک تحت کنترل شما، نه دو دامنهٔ بی‌ارتباط. مجزا بودن دو سرویس مانعی ندارد؛ در تولید از دامنهٔ سفارشی مناسب استفاده کنید. استفاده از دو آدرس پیش‌فرض پلتفرم لزوماً same-site بودن را تضمین نمی‌کند. معماری cross-site نیازمند بازطراحی صریح سیاست cookie و CSRF است؛ صرفاً تغییر SameSite به None کافی نیست.

نمونه برای فرانت‌اند آینده:

```ts
const result = await fetch(`${API_ORIGIN}/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const me = await fetch(`${API_ORIGIN}/auth/me`, { credentials: 'include' });
await fetch(`${API_ORIGIN}/auth/logout`, { method: 'POST', credentials: 'include' });
```

توکن در localStorage ذخیره نمی‌شود و JS نباید مقدار کوکی httpOnly را بخواند. در دستگاه توسعه از یک hostname مشترک، مثلاً localhost روی دو پورت، استفاده کنید؛ localhost و 127.0.0.1 را مخلوط نکنید.

## RBAC قابل استفاده در ماژول‌های آینده

```ts
import type { FastifyPluginAsync } from 'fastify';

const exampleRoutes: FastifyPluginAsync = async (app) => {
  app.get('/restricted', {
    preHandler: [app.authenticate, app.requireRole('SUPER_ADMIN')],
  }, async (request) => ({ user: request.authUser }));
};
export default exampleRoutes;
```

`authenticate` فقط JWT کوکی را می‌پذیرد؛ هدر Authorization fallback نیست. اطلاعات عمومی در `request.authUser` و هویت فعلی در `request.user` قرار می‌گیرد. در هر درخواست معتبر، وضعیت فعال‌بودن و نقش از دیتابیس دوباره خوانده می‌شود؛ تنزل نقش یا غیرفعال‌سازی تا انقضای توکن به تأخیر نمی‌افتد. خطای دیتابیس به 500 عمومی تبدیل می‌شود، نه «رمز اشتباه».

`requireRole` باید بعد از `authenticate` بیاید. برای اجازه به هر دو نقش، `requireRole('ADMIN', 'SUPER_ADMIN')` بنویسید؛ برتری نقش به‌طور ضمنی فرض نمی‌شود. اگر auth اجرا نشده باشد، RBAC با 401 fail-closed می‌شود. مسیرهای `/test/*` فقط داخل test harness تعریف شده‌اند و در اپ production وجود ندارند.

## ساخت اولین Super Admin

```sh
npm run create-admin -- --email admin@example.com --display-name "مدیر کل"
# یا برای پرسیدن ایمیل و نام هم به‌صورت تعاملی:
npm run create-admin
```

رمز و تکرارش در ترمینال واقعی، بدون echo، دریافت می‌شود. حداقل ۱۲ کاراکتر و حداکثر ۱۰۲۴ بایت UTF-8 است. فقط Argon2id با memoryCost=19456 KiB، timeCost=2 و parallelism=1 در دیتابیس ذخیره می‌شود؛ salt را کتابخانه تولید می‌کند. هزینهٔ هش را پیش از افزایش با حافظه و latency سرور واقعی اندازه‌گیری کنید.

آرگومان `--password`، دریافت رمز از environment و حالت stdin غیرتعاملی عمداً وجود ندارد تا رمز در shell history، فهرست پردازش‌ها یا خروجی pipeline نشت نکند. روی سرور یا میزبان مدیریتی قابل اعتماد با TTY و اتصال امن به PostgreSQL اجرا کنید. اجرای تکراری با همان ایمیل پیام روشن می‌دهد، کد خروج ۱ دارد و کاربر موجود را تغییر نمی‌دهد. اگر کلاینت دیتابیس یا migrations آماده نباشند، خطای عمومی امن داده می‌شود.

این ابزار **API endpoint نیست**. داشتن دسترسی CLI و اعتبارنامهٔ دیتابیس در این مدل مرز اعتماد است. ابزار فقط محدود به اولین اجرا نیست و هر بار با ایمیل جدید یک Super Admin می‌سازد؛ دسترسی اجرا و secretهای دیتابیس را محدود کنید. هیچ کاربر واقعی در جریان ساخت این فایل ایجاد نشده است.

## Rate limiting و استقرار Railway

محدودیت روی login و در `onRequest` است، پیش از parse و هش رمز؛ تمام تلاش‌ها، حتی موفق، در سهمیه حساب می‌شوند. پیش‌فرض ۵ تلاش در ۱۵ دقیقه به ازای `request.ip` است. این محدودیت در حافظهٔ همان پردازش نگهداری می‌شود: با restart پاک می‌شود و بین replicaها مشترک نیست. این تحویل برای یک replica طراحی شده؛ پیش از چند-replica شدن، Redis store مشترک برای `@fastify/rate-limit` اضافه کنید. این محدودیت جایگزین کنترل ترافیک لبه یا محافظت DDoS نیست.

`TRUST_PROXY` خالی یعنی هدر جعلی X-Forwarded-For نمی‌تواند IP را عوض کند. پشت پراکسی، اگر مقدار تنظیم نشود ممکن است همهٔ کاربران سهمیهٔ IP پراکسی را شریک شوند. فقط IP/CIDR واقعی پراکسی مجاز را پس از بررسی زنجیرهٔ forwarding تنظیم کنید؛ `true` و CIDR با prefix صفر رد می‌شوند. از محدوده‌های بیش‌ازحد گسترده استفاده نکنید و backend را در معرض مسیر مستقیمِ قابل سوءاستفاده قرار ندهید. رنج‌های Railway حدس زده نشده‌اند؛ تنظیم نهایی باید با توپولوژی واقعی سرویس انجام شود.

دو سرویس backend/frontend جدا باقی می‌مانند. برای backend: build برابر `npm run build`، pre-deploy migration برابر `npm run prisma:migrate:deploy`، start برابر `npm start`، health برابر `/health` و `NODE_ENV=production` است. HTTPS در لبه و دامنه‌های same-site لازم‌اند. ابزارهای dev هنگام build باید نصب باشند. اگر محیط runtime ابزار tsx را حذف می‌کند، CLI را از میزبان مدیریتی با وابستگی‌های کامل اجرا کنید؛ بدون ترمینال امن روش argv برای رمز اضافه نکنید.

## دیتابیس، health و لاگ

`prisma/schema.prisma`، تمام migrations قبلی و ماژول‌های news/categories/media بدون تغییر بایتی حفظ شده‌اند؛ migration جدید لازم نیست. schema اولیه مدل‌ها و enumها را از قبل دارد. اجرای `migrate deploy` migration اولیهٔ موجود را در دیتابیس تازه اعمال می‌کند. `migrate dev` مخصوص توسعه است و روی production اجرا نشود.

پلاگین Prisma اصلی نیز بدون تغییر است: اتصال ناموفق در startup باعث توقف کامل می‌شود. `/health` فقط قطعی پس از startup موفق را با 503 گزارش می‌کند و سرور را نمی‌بندد. app/server همچنان جدا هستند و shutdown قبلی حفظ شده است.

Pino هدرهای حساس، password، passwordHash و JWT_SECRET را redact می‌کند؛ serializer درخواست و خطا، بدنه، query و متن خام error را بیرون نمی‌دهد. در هیچ مسیر جدید secret به لاگ فرستاده نمی‌شود. این سیاست باید در ماژول‌های آینده نیز رعایت شود؛ هیچ redactionای مانع نشت رمز در یک پیام متنیِ ساخته‌شده توسط برنامه‌نویس نمی‌شود.

## تست و فایل‌ها

```sh
npm run typecheck
npm run build
npm test
# فقط با دیتابیس موقت، جدا و migrateشده:
TEST_DATABASE_URL="postgresql://.../rahigh_auth_test" npm run test:integration
```

تست‌های پیش‌فرض از Prisma mock و Fastify inject استفاده می‌کنند و اتصال به دیتابیس ندارند؛ تست integration opt-in، دیتابیس واقعی می‌خواهد و یک کاربر موقت ایجاد و در پایان حذف می‌کند. راهنمای کامل تست و بررسی CLI در `docs/TESTING.md` آمده است.

```text
src/modules/auth/       routes, service, Zod schemas, password hashing, cookie options
src/modules/users/      Prisma queries and explicit public-user projection
src/plugins/auth.plugin.ts   JWT/cookie/rate-limit, authenticate, requireRole, origin guard
src/config/             validated env and token lifetime parser
src/utils/              safe logger and shared sanitized error handlers
scripts/create-admin.ts interactive bootstrap CLI
 tests/                 HTTP, validation, configuration, logging, claims, integration tests
 docs/                  verification status and test instructions
```
