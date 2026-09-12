import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt in only for cookie/logger/CLI tests. The fail-fast tests below deliberately
// keep using child() without these defaults so missing variables stay missing.
const validBaseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test_db_placeholder',
  JWT_SECRET: 'a'.repeat(32),
  CORS_ORIGIN: 'http://localhost:3001',
  PUBLIC_SITE_URL: 'http://localhost:3001',
  PUBLIC_API_URL: 'http://localhost:3000',
};

function child(script: string, overrides: Record<string, string | undefined> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'rk-env-test-'));
  const env = { ...process.env, ...overrides };
  // Do not read a developer's real .env file.
  try {
    return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', script],
      { cwd, env, encoding: 'utf8', timeout: 20_000 });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
const envUrl = new URL('../src/config/env.ts', import.meta.url).href;

// create-admin.ts calls parseArgs() without an explicit `args`, so Node derives the arguments
// from its own main-args offset. Under `--eval` that offset shifts by one, which means an
// `--eval` script cannot fake CLI arguments by assigning to process.argv: the fake script name
// leaks through as a positional and trips `allowPositionals: false` before any other check runs.
// The CLI test therefore spawns the real script file with real command line arguments.
const createAdminScript = fileURLToPath(new URL('../scripts/create-admin.ts', import.meta.url));

function createAdmin(args: string[], overrides: Record<string, string | undefined> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'rk-env-test-'));
  const env = { ...process.env, ...overrides };
  // Do not read a developer's real .env file. stdio stays piped, so stdin/stdout are not TTYs.
  try {
    return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), createAdminScript, ...args],
      { cwd, env, encoding: 'utf8', timeout: 20_000, stdio: ['pipe', 'pipe', 'pipe'] });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('missing/short JWT secret fails fast without echoing its value', () => {
  for (const secret of [undefined, 'private-short-secret']) {
    const result = child(`await import(${JSON.stringify(envUrl)});`, { JWT_SECRET: secret });
    assert.equal(result.status, 1); assert.match(result.stderr, /JWT_SECRET/);
    assert.ok(!result.stderr.includes('private-short-secret'));
  }
});

test('missing DATABASE_URL, invalid lifetime and unsafe proxy config fail fast', () => {
  for (const overrides of [{ DATABASE_URL: undefined }, { JWT_EXPIRES_IN: '3600' },
    { TRUST_PROXY: 'true' }, { TRUST_PROXY: '0.0.0.0/0' }]) {
    const result = child(`await import(${JSON.stringify(envUrl)});`, overrides);
    assert.equal(result.status, 1); assert.match(result.stderr, /Configuration error/);
  }
});

test('production cookie is Secure, httpOnly, host-only with __Host- prefix', () => {
  const url = new URL('../src/modules/auth/auth.cookie.ts', import.meta.url).href;
  const result = child(`const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify([m.AUTH_COOKIE_NAME, m.authCookieOptions]));`,
    { ...validBaseEnv, NODE_ENV: 'production' });
  assert.equal(result.status, 0);
  const [name, options] = JSON.parse(result.stdout.trim());
  assert.equal(name, '__Host-rk_auth');
  assert.deepEqual(options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
});

test('logger redacts secrets and omits raw request and error details', () => {
  const url = new URL('../src/utils/logger.ts', import.meta.url).href;
  const result = child(`
    const { createLogger } = await import(${JSON.stringify(url)});
    const log = createLogger(); const value = 'DO_NOT_LOG_THIS_VALUE';
    log.info({password:value,passwordHash:value,JWT_SECRET:value,token:value,
      headers:{authorization:value,cookie:value,'set-cookie':value},
      req:{id:'1',method:'POST',body:{password:value},headers:{cookie:value}},
      err:new Error(value)}, 'Redaction test');
  `, { ...validBaseEnv, NODE_ENV: 'production' });
  assert.equal(result.status, 0); assert.ok(result.stdout.includes('Redaction test'));
  assert.ok(!result.stdout.includes('DO_NOT_LOG_THIS_VALUE'));
});

test('CLI rejects password arguments safely and requires an interactive terminal', () => {
  // A --password option must be refused, and the value must never be echoed back.
  const argument = createAdmin(['--email', 'admin@example.com', '--password', 'PRIVATE_ARG'], validBaseEnv);
  assert.equal(argument.status, 1); assert.match(argument.stderr, /Invalid arguments/);
  assert.ok(!argument.stderr.includes('PRIVATE_ARG'));
  assert.ok(!argument.stdout.includes('PRIVATE_ARG'));
  // Valid options on purpose: this half must reach the TTY check, not the argument check.
  const nonTty = createAdmin(['--email', 'admin@example.com', '--display-name', 'Test Admin'], validBaseEnv);
  assert.equal(nonTty.status, 1); assert.match(nonTty.stderr, /interactive terminal/);
});
