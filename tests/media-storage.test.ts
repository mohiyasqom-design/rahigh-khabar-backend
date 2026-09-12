import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { LocalMediaStorage, storedFilenamePattern } from '../src/modules/media/storage.js';
const origin = 'http://localhost:3000';
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'rk-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = new LocalMediaStorage(root, origin);
  await storage.initialize();
  return { storage, root };
}
test('local storage uses random safe URLs and preserves bytes', async (t) => {
  const { storage, root } = await setup(t);
  const data = Buffer.from('adapter fixture; image validation belongs to the service');
  const first = await storage.save(data, 'png');
  const second = await storage.save(data, 'png');
  assert.notEqual(first, second);
  assert.ok(storedFilenamePattern.test(basename(first)));
  assert.ok(first.startsWith(`${origin}/uploads/`));
  assert.deepEqual(await readFile(join(root, basename(first))), data);
  assert.ok(!(await readdir(root)).some((name) => name.endsWith('.partial')));
  await storage.remove(first); await storage.remove(first);
  await assert.rejects(readFile(join(root, basename(first))));
});
test('unmanaged URLs and traversal cannot remove outside files', async (t) => {
  const { storage } = await setup(t);
  for (const path of ['/uploads/../../etc/passwd', '/uploads/%2e%2e%2f.env', '/uploads/.env',
    '/uploads/x.jpg', '/other/00000000-0000-4000-8000-000000000000.png']) {
    await assert.rejects(storage.remove(path));
  }
  assert.throws(() => new LocalMediaStorage('.', origin));
  assert.throws(() => new LocalMediaStorage('src/uploads', origin));
  assert.throws(() => new LocalMediaStorage('/', origin));
});
test('delete rollback leaves bytes and removes the private marker', async (t) => {
  const { storage, root } = await setup(t);
  const url = await storage.save(Buffer.from('image'), 'jpg');
  const pending = await storage.prepareRemoval('media1', url);
  assert.equal((await readdir(join(root, '.pending-delete'))).length, 1);
  assert.equal((await readFile(join(root, basename(url)))).toString(), 'image');
  await assert.rejects(storage.prepareRemoval('media1', url));
  await pending.rollback();
  assert.equal((await readdir(join(root, '.pending-delete'))).length, 0);
  assert.equal((await readFile(join(root, basename(url)))).toString(), 'image');
});
test('committed deletion removes both file and marker; missing files are tolerated', async (t) => {
  const { storage, root } = await setup(t);
  const url = await storage.save(Buffer.from('image'), 'webp');
  await (await storage.prepareRemoval('media1', url)).commit();
  await assert.rejects(readFile(join(root, basename(url))));
  assert.deepEqual(await readdir(join(root, '.pending-delete')), []);
  await (await storage.prepareRemoval('media1', url)).commit();
});
test('restart recovery preserves uncommitted files and cleans committed deletion', async (t) => {
  const { storage, root } = await setup(t);
  const a = await storage.save(Buffer.from('a'), 'png');
  const b = await storage.save(Buffer.from('b'), 'png');
  await storage.prepareRemoval('keep', a); await storage.prepareRemoval('remove', b);
  const restart = new LocalMediaStorage(root, origin);
  await restart.initialize();
  const checked: string[] = [];
  await restart.recover(async (id) => { checked.push(id); return id === 'keep'; });
  assert.deepEqual(checked.sort(), ['keep', 'remove']);
  assert.equal((await readFile(join(root, basename(a)))).toString(), 'a');
  await assert.rejects(readFile(join(root, basename(b))));
  assert.deepEqual(await readdir(join(root, '.pending-delete')), []);
});
test('failed recovery keeps deletion intent for the next restart', async (t) => {
  const { storage, root } = await setup(t);
  const url = await storage.save(Buffer.from('a'), 'png');
  await storage.prepareRemoval('media1', url);
  await assert.rejects(storage.recover(async () => { throw new Error('DB unavailable'); }));
  assert.equal((await readdir(join(root, '.pending-delete'))).length, 1);
});
test('initialization removes only adapter partial writes, not arbitrary files', async (t) => {
  const { storage, root } = await setup(t);
  const url = await storage.save(Buffer.from('x'), 'png');
  await writeFile(join(root, `${basename(url)}.partial`), 'incomplete');
  await writeFile(join(root, 'unrelated.partial'), 'keep');
  await storage.initialize();
  assert.ok(!(await readdir(root)).includes(`${basename(url)}.partial`));
  assert.equal((await readFile(join(root, 'unrelated.partial'))).toString(), 'keep');
});
test('symbolic-link upload root is rejected', async (t) => {
  const { root } = await setup(t);
  const path = `${root}-link`;
  await symlink(root, path); t.after(() => rm(path, { force: true }));
  await assert.rejects(new LocalMediaStorage(path, origin).initialize());
});
