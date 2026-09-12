import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieFrom, harness, makeUser, testPassword } from './helpers.js';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/auth.cookie.js';

test('valid login sets an httpOnly cookie and returns only public fields', async (t) => {
  const user = await makeUser();
  const { app, login } = await harness([user]); t.after(() => app.close());
  const result = await login();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), { id: user.id, email: user.email, displayName: user.displayName, role: user.role });
  const header = String(result.headers['set-cookie']);
  assert.match(header, /HttpOnly/i); assert.match(header, /SameSite=Lax/i);
  assert.match(header, /Path=\//); assert.match(header, /Max-Age=3600/);
  assert.doesNotMatch(header, /; Secure/i); assert.doesNotMatch(header, /Domain=/i);
  assert.equal(result.headers['cache-control'], 'no-store');
  const cookie = cookieFrom(result.headers);
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const claims = app.jwt.verify<Record<string, unknown>>(token);
  assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'role', 'userId']);
  assert.equal(claims.userId, user.id);
  assert.equal(Number(claims.exp) - Number(claims.iat), 3600);
  assert.ok(!result.body.includes(user.passwordHash)); assert.ok(!result.body.includes(testPassword));
  const me = await app.inject({ url: '/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200); assert.deepEqual(me.json(), result.json());
});

test('wrong password, missing user and inactive user get the same generic 401', async (t) => {
  const { app, login } = await harness([
    await makeUser(), await makeUser({ id: 'inactive', email: 'inactive@example.com', isActive: false }),
  ]); t.after(() => app.close());
  const responses = [await login('incorrect'), await login(testPassword, 'missing@example.com'),
    await login(testPassword, 'inactive@example.com')];
  for (const response of responses) {
    assert.equal(response.statusCode, 401); assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(response.json(), { code: 'INVALID_CREDENTIALS', message: 'ایمیل یا رمز عبور نادرست است' });
  }
});

test('email normalization matches the CLI; passwords are not trimmed', async (t) => {
  const { app, login } = await harness([await makeUser()]); t.after(() => app.close());
  assert.equal((await login(testPassword, ' ADMIN@EXAMPLE.COM ')).statusCode, 200);
  assert.equal((await login(` ${testPassword} `)).statusCode, 401);
});

test('invalid payloads return 400 without exposing input', async (t) => {
  const { app } = await harness(); t.after(() => app.close());
  for (const payload of [{ email: 'not-an-email', password: 'secret-input' },
    { email: 'a@example.com' }, { email: 'a@example.com', password: '' },
    { email: 'a@example.com', password: 'secret-input', role: 'SUPER_ADMIN' }]) {
    const result = await app.inject({ method: 'POST', url: '/auth/login', payload });
    assert.equal(result.statusCode, 400); assert.ok(!result.body.includes('secret-input'));
  }
});

test('missing, malformed, wrong-signature and expired cookies fail closed', async (t) => {
  const user = await makeUser();
  const { app, session } = await harness([user]); t.after(() => app.close());
  assert.equal((await app.inject('/auth/me')).statusCode, 401);
  assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: `${AUTH_COOKIE_NAME}=garbage` } })).statusCode, 401);
  const token = session(user);
  const parts = token.split('.');
  parts[2] = `${parts[2]?.startsWith('A') ? 'B' : 'A'}${parts[2]?.slice(1)}`;
  assert.equal((await app.inject({ url: '/auth/me', headers: { cookie: parts.join('.') } })).statusCode, 401);
  const expired = await app.inject({ url: '/auth/me', headers: { cookie: session(user, { expiresIn: -1 }) } });
  assert.equal(expired.statusCode, 401); assert.equal(expired.json().code, 'TOKEN_EXPIRED');
});

test('Authorization bearer tokens cannot replace the cookie', async (t) => {
  const user = await makeUser();
  const { app } = await harness([user]); t.after(() => app.close());
  const token = app.jwt.sign({ userId: user.id, role: user.role });
  assert.equal((await app.inject({ url: '/auth/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
});

test('inactive and deleted accounts lose access before JWT expiry', async (t) => {
  const user = await makeUser();
  const { app, state, session } = await harness([user]); t.after(() => app.close());
  const headers = { cookie: session(user) };
  user.isActive = false;
  assert.equal((await app.inject({ url: '/auth/me', headers })).statusCode, 401);
  state.users = [];
  assert.equal((await app.inject({ url: '/auth/me', headers })).statusCode, 401);
});

test('RBAC allows Super Admin, rejects Admin and honors demotion immediately', async (t) => {
  const user = await makeUser();
  const { app, session } = await harness([user]); t.after(() => app.close());
  const headers = { cookie: session(user) };
  assert.equal((await app.inject({ url: '/test/admin', headers })).statusCode, 200);
  user.role = 'ADMIN';
  assert.equal((await app.inject({ url: '/test/admin', headers })).statusCode, 403);
  const me = await app.inject({ url: '/auth/me', headers });
  assert.equal(me.json().role, 'ADMIN');
  assert.equal((await app.inject('/test/admin')).statusCode, 401);
  assert.equal((await app.inject('/test/rbac-only')).statusCode, 401);
});

test('logout clears the same cookie and is idempotent', async (t) => {
  const { app } = await harness(); t.after(() => app.close());
  for (let i = 0; i < 2; i++) {
    const result = await app.inject({ method: 'POST', url: '/auth/logout' });
    assert.equal(result.statusCode, 204); assert.equal(result.body, '');
    const cookie = String(result.headers['set-cookie']);
    assert.ok(cookie.startsWith(`${AUTH_COOKIE_NAME}=`));
    assert.match(cookie, /Expires=Thu, 01 Jan 1970/i); assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Path=\//); assert.match(cookie, /SameSite=Lax/i);
  }
  assert.equal((await app.inject('/auth/me')).statusCode, 401);
});

test('sixth login attempt is 429 per IP; forwarded headers cannot bypass it', async (t) => {
  const { app, login, state } = await harness(); t.after(() => app.close());
  for (let i = 0; i < 5; i++) assert.equal((await login()).statusCode, 401);
  const calls = state.calls;
  const result = await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'a@example.com', password: 'bad' }, headers: { 'x-forwarded-for': '203.0.113.5' } });
  assert.equal(result.statusCode, 429); assert.equal(result.json().code, 'TOO_MANY_REQUESTS');
  assert.ok(result.headers['retry-after']); assert.equal(state.calls, calls);
  assert.equal((await login('bad', 'a@example.com', '203.0.113.10')).statusCode, 401);
});

test('login rejects non-JSON, oversized and malformed JSON bodies', async (t) => {
  const { app } = await harness(); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/auth/login',
    headers: { 'content-type': 'text/plain' }, payload: '{}' })).statusCode, 415);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/login',
    payload: { email: 'a@example.com', password: 'a'.repeat(9000) } })).statusCode, 413);
  const malformed = await app.inject({ method: 'POST', url: '/auth/login',
    headers: { 'content-type': 'application/json' }, payload: '{"password":"private-input",' });
  assert.equal(malformed.statusCode, 400); assert.ok(!malformed.body.includes('private-input'));
});

test('foreign origins and cross-site writes are blocked, configured origin is allowed', async (t) => {
  const { app, state } = await harness([await makeUser()]); t.after(() => app.close());
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    const result = await app.inject({ method: 'POST', url: '/auth/login', headers,
      payload: { email: 'admin@example.com', password: testPassword } });
    assert.equal(result.statusCode, 403);
  }
  assert.equal(state.calls, 0);
  const allowed = await app.inject({ method: 'POST', url: '/auth/login',
    headers: { origin: 'http://localhost:3001', 'sec-fetch-site': 'same-site' },
    payload: { email: 'admin@example.com', password: testPassword } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:3001');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  assert.equal((await app.inject({ method: 'POST', url: '/auth/logout',
    headers: { origin: 'https://evil.example' } })).statusCode, 403);
});

test('CORS preflight allows credentialed POST only for the configured origin', async (t) => {
  const { app } = await harness(); t.after(() => app.close());
  const result = await app.inject({ method: 'OPTIONS', url: '/auth/login', headers: {
    origin: 'http://localhost:3001', 'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  } });
  assert.equal(result.statusCode, 204);
  assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:3001');
  assert.match(String(result.headers['access-control-allow-methods']), /POST/);
  const foreign = await app.inject({ url: '/auth/me', headers: { origin: 'https://evil.example' } });
  assert.notEqual(foreign.headers['access-control-allow-origin'], '*');
  assert.notEqual(foreign.headers['access-control-allow-origin'], 'https://evil.example');
});

test('database failures are sanitized 500 responses, not invalid credentials', async (t) => {
  const user = await makeUser();
  const { app, state, login, session } = await harness([user]); t.after(() => app.close());
  state.failQueries = true;
  for (const response of [await login(), await app.inject({ url: '/auth/me', headers: { cookie: session(user) } })]) {
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { error: 'Internal Server Error' });
    assert.ok(!response.body.includes('PRIVATE'));
  }
});

test('no public registration endpoint exists', async (t) => {
  const { app } = await harness(); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/auth/register', payload: {} })).statusCode, 404);
});
