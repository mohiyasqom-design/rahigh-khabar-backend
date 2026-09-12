import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImage } from '../src/modules/media/media.signature.js';
import { ApiError } from '../src/utils/api-error.js';
import { jpeg, png, webp } from './media-fixtures.js';
const denied = (error: unknown) => error instanceof ApiError && error.statusCode === 415;
test('structural signatures accept real JPEG, PNG and WebP fixtures', () => {
  for (const [data, mime, ext] of [[jpeg, 'image/jpeg', 'jpg'], [png, 'image/png', 'png'], [webp, 'image/webp', 'webp']] as const) {
    assert.deepEqual(detectImage(data, mime), { extension: ext, mimeType: mime });
  }
});
test('structural checks reject truncated, appended, forged and non-image content', () => {
  for (const [data, mime] of [[jpeg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp']] as const) {
    assert.throws(() => detectImage(data.subarray(0, -1), mime), denied);
    assert.throws(() => detectImage(Buffer.concat([data, Buffer.from('<script/>')]), mime), denied);
    assert.throws(() => detectImage(data, 'text/html'), denied);
  }
  for (const data of [Buffer.alloc(0), Buffer.from('<script/>'), Buffer.from('<svg/>'), Buffer.from('GIF89a'), png.subarray(0, 24)]) {
    assert.throws(() => detectImage(data, 'image/png'), denied);
  }
  const bogusChunk = Buffer.from(png); bogusChunk.writeUInt32BE(0xffffffff, 8);
  assert.throws(() => detectImage(bogusChunk, 'image/png'), denied);
});
