import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('public origins and upload limits fail fast, without disclosing input values', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'rk-media-env-'));
  try {
    for (const overrides of [{ PUBLIC_SITE_URL: undefined }, { PUBLIC_API_URL: undefined },
      { PUBLIC_SITE_URL: 'javascript:PRIVATE_VALUE' }, { PUBLIC_SITE_URL: 'https://site.invalid/' },
      { PUBLIC_API_URL: 'https://user:PRIVATE_VALUE@api.invalid' }, { MAX_UPLOAD_SIZE_BYTES: '0' },
      { MAX_UPLOAD_SIZE_BYTES: '52428801' }, { UPLOAD_DIR: '   ' }]) {
      const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '--eval',
        `await import(${JSON.stringify(new URL('../src/config/env.ts', import.meta.url).href)});`],
      { cwd, env: { ...process.env, ...overrides }, encoding: 'utf8', timeout: 20_000 });
      assert.equal(result.status, 1); assert.match(result.stderr, /Configuration error/);
      assert.doesNotMatch(result.stderr, /PRIVATE_VALUE/);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
