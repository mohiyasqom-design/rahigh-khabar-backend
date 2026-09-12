import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImage } from '../src/modules/media/media.image.js';
import { ApiError } from '../src/utils/api-error.js';
import { jpeg, png, webp } from './media-fixtures.js';
const unsupported = (error: unknown) => error instanceof ApiError && error.statusCode === 415;
test('JPEG, PNG and WebP signatures and actual dimensions', () => {
  for (const [data, mime, ext] of [[jpeg, 'image/jpeg', 'jpg'], [png, 'image/png', 'png'], [webp, 'image/webp', 'webp']] as const) {
    assert.deepEqual(inspectImage(data, mime), { extension: ext, mimeType: mime, width: 3, height: 2, sizeBytes: data.length });
  }
});
test('reject forged MIME, script, SVG, GIF, empty and header-only uploads', () => {
  for (const data of [Buffer.from('<script>alert(1)</script>'), Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.alloc(0),
    png.subarray(0, 16), jpeg.subarray(0, 16), webp.subarray(0, 16)]) {
    assert.throws(() => inspectImage(data, 'image/png'), unsupported);
  }
  assert.throws(() => inspectImage(png, 'image/jpeg'), unsupported);
  assert.throws(() => inspectImage(png, 'application/octet-stream'), unsupported);
});
