import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, makeUser, signedTestCookie } from './helpers.js';

test('correctly signed tokens still need a valid userId and known role', async (t) => {
  const user = await makeUser();
  const { app } = await harness([user]); t.after(() => app.close());
  const exp = Math.floor(Date.now() / 1000) + 3600;
  for (const claims of [{ userId: '', role: 'ADMIN' }, { userId: user.id, role: 'READER' },
    { userId: 123, role: 'ADMIN' }, { role: 'ADMIN' }]) {
    const result = await app.inject({ url: '/auth/me', headers: { cookie: signedTestCookie({ ...claims, exp }) } });
    assert.equal(result.statusCode, 401);
  }
});

test('logout is browser cookie removal, not server-side JWT revocation', async (t) => {
  const user = await makeUser();
  const { app, session } = await harness([user]); t.after(() => app.close());
  const headers = { cookie: session(user) };
  assert.equal((await app.inject({ method: 'POST', url: '/auth/logout', headers })).statusCode, 204);
  // An attacker replaying an already-copied token can still use it until expiry.
  // This test documents the stateless limitation instead of implying revocation.
  assert.equal((await app.inject({ url: '/auth/me', headers })).statusCode, 200);
});
