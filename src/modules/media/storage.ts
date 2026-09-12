import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, link, lstat, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ApiError } from '../../utils/api-error.js';
import type { ImageExtension } from './media.image.js';
export const storedFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
export interface PendingRemoval { commit(): Promise<void>; rollback(): Promise<void>; }
export interface MediaStorage {
  save(data: Buffer, extension: ImageExtension): Promise<string>;
  remove(url: string): Promise<void>;
  prepareRemoval(id: string, url: string): Promise<PendingRemoval>;
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
async function unlinkIfPresent(path: string): Promise<void> {
  try { await unlink(path); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
}
function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
/** Single-instance local adapter; DB and disk cannot share an atomic transaction. */
export class LocalMediaStorage implements MediaStorage {
  readonly root: string;
  private readonly pending: string;
  private readonly active = new Set<string>();
  constructor(directory: string, private readonly apiOrigin: string) {
    this.root = resolve(directory);
    const cwd = process.cwd();
    if (inside(this.root, cwd) || ['src', 'dist', 'prisma', 'node_modules', '.git']
      .some((name) => inside(resolve(cwd, name), this.root))) {
      throw new Error('UPLOAD_DIR must be a dedicated data directory outside source/build directories.');
    }
    this.pending = join(this.root, '.pending-delete');
  }
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(this.pending, { recursive: true, mode: 0o700 });
    for (const directory of [this.root, this.pending]) {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('Upload directories must not be symbolic links.');
      await access(directory, constants.R_OK | constants.W_OK);
    }
    // Partial writes are never published or referenced by a DB record.
    for (const name of await readdir(this.root)) {
      if (name.endsWith('.partial') && storedFilenamePattern.test(name.slice(0, -8))) {
        await unlinkIfPresent(join(this.root, name));
      }
    }
  }
  private filename(url: string): string {
    // Path-only mapping keeps old records deletable after public-origin changes.
    const parsed = new URL(url, this.apiOrigin);
    const name = parsed.pathname.slice('/uploads/'.length);
    if (!parsed.pathname.startsWith('/uploads/') || !storedFilenamePattern.test(name) ||
        parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new ApiError(409, 'UNMANAGED_MEDIA', 'این رسانه متعلق به فضای ذخیره‌سازی محلی نیست.');
    }
    return name;
  }
  async save(data: Buffer, extension: ImageExtension): Promise<string> {
    const filename = `${randomUUID()}.${extension}`;
    const path = join(this.root, filename);
    const temporary = `${path}.partial`;
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } catch (error) { await unlinkIfPresent(temporary); throw error; }
    return `${this.apiOrigin}/uploads/${filename}`;
  }
  async remove(url: string): Promise<void> {
    await unlinkIfPresent(join(this.root, this.filename(url)));
  }
  async prepareRemoval(id: string, url: string): Promise<PendingRemoval> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new ApiError(400, 'INVALID_MEDIA_ID', 'شناسهٔ رسانه نامعتبر است.');
    const filename = this.filename(url);
    if (this.active.has(filename)) throw new ApiError(409, 'MEDIA_BUSY', 'حذف این رسانه در حال انجام است.');
    this.active.add(filename);
    const path = join(this.root, filename);
    const marker = join(this.pending, `${id}__${filename}`);
    try {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe media file.');
        // Durable intent; live file remains readable until database commit.
        await link(path, marker);
      } catch (error) {
        if (!hasCode(error, 'ENOENT') && !hasCode(error, 'EEXIST')) throw error;
      }
    } catch (error) { this.active.delete(filename); throw error; }
    return {
      commit: async () => {
        try { await unlinkIfPresent(path); await unlinkIfPresent(marker); }
        finally { this.active.delete(filename); }
      },
      rollback: async () => {
        try { await unlinkIfPresent(marker); }
        finally { this.active.delete(filename); }
      },
    };
  }
  async recover(exists: (id: string) => Promise<boolean>): Promise<void> {
    for (const name of await readdir(this.pending)) {
      const split = name.lastIndexOf('__');
      const id = name.slice(0, split);
      const filename = name.slice(split + 2);
      if (split < 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !storedFilenamePattern.test(filename)) {
        throw new Error('Invalid pending media deletion marker; operator review required.');
      }
      if (!(await exists(id))) await unlinkIfPresent(join(this.root, filename));
      await unlinkIfPresent(join(this.pending, name));
    }
  }
}
