import test from 'node:test';
import assert from 'node:assert/strict';
import { loginSchema, createAdminSchema } from '../src/modules/auth/auth.schema.js';
import { parseTokenLifetime } from '../src/config/token-lifetime.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';

test('token lifetime parsing has explicit units and bounds', () => {
  for (const [input, expected] of [['60s', 60], ['15m', 900], ['1h', 3600], ['7d', 604800]] as const)
    assert.equal(parseTokenLifetime(input), expected);
  for (const input of ['3600', '0s', '-1h', '1ms', '59s', '8d', '1.5h', ' 1h', 'Infinity', '9999999999999999999d'])
    assert.equal(parseTokenLifetime(input), null);
});

test('bootstrap validation enforces a stronger password minimum than login', () => {
  const input = { email: ' ADMIN@example.com ', password: 'long-password-123', displayName: ' مدیر ' };
  const valid = createAdminSchema.parse(input);
  assert.equal(valid.email, 'admin@example.com'); assert.equal(valid.displayName, 'مدیر');
  assert.equal(createAdminSchema.safeParse({ ...input, password: 'short' }).success, false);
  assert.equal(loginSchema.safeParse({ email: 'a@example.com', password: 'short' }).success, true);
  assert.equal(loginSchema.safeParse({ email: 'a@example.com', password: 'ر'.repeat(600) }).success, false);
});

test('Argon2id salts each hash and safely rejects wrong passwords or corrupt hashes', async () => {
  const password = 'sensitive-test-password';
  const one = await hashPassword(password); const two = await hashPassword(password);
  assert.match(one, /^\$argon2id\$/); assert.notEqual(one, two);
  assert.equal(await verifyPassword(one, password), true);
  assert.equal(await verifyPassword(one, 'wrong'), false);
  assert.equal(await verifyPassword('broken-hash', password), false);
});
